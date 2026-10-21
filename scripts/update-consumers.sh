#!/usr/bin/env bash
#
# Update every known mc-feedback consumer to the latest (or a specified) tag.
#
# Usage:
#   scripts/update-consumers.sh                   # update to the latest tag
#   scripts/update-consumers.sh v1.0.2            # update to a specific tag
#   scripts/update-consumers.sh --dry-run         # show what would change, no writes
#
# What it does, per consumer:
#   1. Sync `src/`, `package.json`, `README.md`, `CHANGELOG.md` into the project's
#      `vendor/mc-feedback/` folder (deleting files that no longer exist in the package).
#   2. Write `vendor/mc-feedback/VENDORED.md` recording the exact commit it took.
#   3. Run the project's install command so lockfiles update.
#   4. Leave the project's git working tree dirty — review + commit in each project.
#
# Consumers are declared below as `consumer <name> <project-root> <install-cmd>`.
# `<project-root>` is where `vendor/mc-feedback/` + `package.json` live. Package.json
# must already carry `"@mcailab/mc-feedback": "file:vendor/mc-feedback"` (or similar).
#
# Adjust the consumer list when a new project adopts the package.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-}"
DRY_RUN=""
if [[ "${VERSION:-}" == "--dry-run" ]]; then
  DRY_RUN="1"
  VERSION=""
fi

cd "$PKG_DIR"
git fetch --tags --quiet

if [[ -z "$VERSION" ]]; then
  VERSION="$(git describe --tags --abbrev=0 2>/dev/null || echo "main")"
fi

echo "📦 mc-feedback $VERSION  (from $PKG_DIR)"

if [[ -n "$DRY_RUN" ]]; then
  echo "   (dry run — no files will change)"
fi

# Check out the target version in a detached state so the sync is clean.
if ! git -c advice.detachedHead=false checkout "$VERSION" >/dev/null 2>&1; then
  echo "❌ cannot check out '$VERSION' — not a tag or branch?"
  exit 1
fi

PKG_COMMIT="$(git rev-parse --short HEAD)"
PKG_FULL_COMMIT="$(git rev-parse HEAD)"

# --- Consumer declarations --------------------------------------------------
# Add a line per project. The first arg is a label; the second is the project root
# (where `vendor/mc-feedback/` lives); the third is the install command run from
# that root.
#
# Note: ATS vendors the files directly inside `src/components/feedback/` rather
# than in a `vendor/` folder, so it's handled separately below.
CONSUMERS=(
  "mc-eip|$HOME/Project/MC/mc-eip|npm install"
  "mcapt|$HOME/Project/MC/mcapt|cd app && pnpm install"
)

sync_vendor() {
  local label="$1" root="$2" install="$3"

  if [[ ! -d "$root" ]]; then
    printf "   ⚠️  %-10s: %s not found, skipped\n" "$label" "$root"
    return
  fi
  local vendor_dir="$root/vendor/mc-feedback"
  printf "   → %-10s %s\n" "$label" "$vendor_dir"

  if [[ -n "$DRY_RUN" ]]; then
    rsync -ani --delete --exclude '.git' "$PKG_DIR/" "$vendor_dir/" | sed 's/^/      /'
    return
  fi

  mkdir -p "$vendor_dir/src"
  rsync -a --delete "$PKG_DIR/src/" "$vendor_dir/src/"
  cp "$PKG_DIR/package.json" "$vendor_dir/package.json"
  [[ -f "$PKG_DIR/README.md" ]] && cp "$PKG_DIR/README.md" "$vendor_dir/README.md"
  [[ -f "$PKG_DIR/CHANGELOG.md" ]] && cp "$PKG_DIR/CHANGELOG.md" "$vendor_dir/CHANGELOG.md"
  if [[ -d "$PKG_DIR/templates" ]]; then
    rsync -a --delete "$PKG_DIR/templates/" "$vendor_dir/templates/"
  fi
  cat > "$vendor_dir/VENDORED.md" <<EOF
# mc-feedback (vendored copy)

Source: https://github.com/mcailab/mc-feedback
Version: $VERSION
Commit:  $PKG_FULL_COMMIT
Updated: $(date -u +'%Y-%m-%dT%H:%M:%SZ')

To update, run \`$PKG_DIR/scripts/update-consumers.sh\` in the mc-feedback repo.
EOF

  # Run the project's install so lockfiles update.
  ( cd "$root" && eval "$install" ) >/dev/null 2>&1 || {
    echo "      ⚠️  install failed in $root — run it by hand"
  }
}

echo ""
echo "🔄 Syncing vendored consumers to $VERSION ($PKG_COMMIT):"
for row in "${CONSUMERS[@]}"; do
  IFS="|" read -r label root install <<<"$row"
  sync_vendor "$label" "$root" "$install"
done

# --- ATS — special-case: vendored files sit inside src/components/feedback/ ---
# ATS keeps project-specific adapter files (actions.ts, store.ts, ats-mount.tsx,
# README.md) in the same folder, so we sync ONLY the two generic files.
ATS_DIR="$HOME/Project/MC/mc-ats/src/components/feedback"
if [[ -d "$ATS_DIR" ]]; then
  printf "   → %-10s %s (widget + capture only)\n" "mc-ats" "$ATS_DIR"
  if [[ -z "$DRY_RUN" ]]; then
    cp "$PKG_DIR/src/widget.tsx" "$ATS_DIR/feedback-widget.tsx"
    cp "$PKG_DIR/src/capture.ts" "$ATS_DIR/capture.ts"
  fi
fi

echo ""
echo "✅ Done. Review the diffs in each project, then commit + push."
echo "   Each project's working tree is dirty — nothing was committed for you."
