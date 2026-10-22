# @mcailab/mc-feedback

Click-to-comment UX feedback widget for Next.js + Firebase projects. Drops a pin anywhere on the page, lists pins across the whole app grouped by page or by reviewer, element-relative anchoring so pins follow their target across viewports.

Verified on **mc-ats** (ATS), **mcapt** (APT), **mc-eip** (EIP). Ready for ELS, future projects.

## Install

> ⚠️ **This repo is PRIVATE as of 2026-10-21.** Firebase App Hosting's build
> environment has no GitHub credentials, so `npm install mcailab/mc-feedback`
> **fails at build time** with `Could not read from remote repository`. Use the
> vendored install (option B below) until the repo is made public.

### Option A — direct from GitHub (works only if the repo is public)

```bash
# npm
npm install mcailab/mc-feedback#main
# pnpm
pnpm add github:mcailab/mc-feedback#main
# yarn
yarn add mcailab/mc-feedback#main
```

Pin to a tag for safety:

```bash
npm install mcailab/mc-feedback#v1.0.1
```

In a **monorepo** (mcapt's `app/` layout), run inside the Next.js app folder:

```bash
cd app && pnpm add github:mcailab/mc-feedback#main
```

### Option B — vendor the folder (current workaround while repo is private)

What EIP uses. Copy the package source into a vendor folder beside your app, then reference it with a `file:` path in `package.json`:

```bash
# From your project root:
git clone https://github.com/mcailab/mc-feedback vendor/mc-feedback
# Optional — pin to a tag + strip .git so it travels with your repo:
cd vendor/mc-feedback && git checkout v1.0.1 && rm -rf .git && cd -
```

Then add to `package.json` (or `app/package.json` in a monorepo):

```json
"dependencies": {
  "@mcailab/mc-feedback": "file:vendor/mc-feedback"
  // monorepo like mcapt: "file:../vendor/mc-feedback"
}
```

**Updating the vendored copy** when a new version is pushed to `mcailab/mc-feedback`:

```bash
cd vendor/mc-feedback && git init && git remote add origin https://github.com/mcailab/mc-feedback && git fetch --tags && git checkout v1.0.2 && rm -rf .git && cd -
# then your package manager picks it up automatically on next install
pnpm install   # or npm install
git add vendor/mc-feedback && git commit -m "chore: bump mc-feedback to v1.0.2"
```

Drop a `vendor/mc-feedback/VENDORED.md` beside the files so future contributors understand why the folder is checked in. (See EIP's for an example — it also records which commit was vendored.)

### Enable TS transpilation of the package

Since this package ships source TS/TSX (no build step), Next.js has to transpile it. Add one line to your `next.config.ts`:

```ts
export default {
  transpilePackages: ['@mcailab/mc-feedback'],
  // ... rest of your config
};
```

### Peer dependencies

The package expects the host to already have these:

- `firebase` `>=12.0.0 <14.0.0`
- `firebase-admin` `^14.0.0` (optional — only needed if you call the templates' actions)
- `next` `^16.0.0`
- `react` `^18.0.0 || ^19.0.0`

Verified against Firebase client `12.15–13.0`, admin SDK `14.1–14.5`.

### ⚠️ Styling requirements — Tailwind CSS v4 + Material Symbols

The widget (FAB, pins, popover, drawer) is styled **entirely with Tailwind utility classes**
and its icons are **Material Symbols**. The host app **must** provide both, or the FAB renders
with no styling and is effectively invisible (it's `fixed` + sized purely via Tailwind):

1. **Tailwind v4** — `@import "tailwindcss";` in your global stylesheet, the `@tailwindcss/postcss`
   plugin, and make sure Tailwind **scans the widget's source** so its classes are generated.
   With the vendored install, add:
   ```css
   @source "../../vendor/mc-feedback/src";   /* path relative to the CSS file */
   ```
   (Tailwind v4 auto-detects committed project files, but `@source` makes it explicit.)
   If your app uses a class-based dark mode keep your `@custom-variant dark (…)`; if it follows
   the OS theme, map it: `@custom-variant dark (@media (prefers-color-scheme: dark));`.
2. **Material Symbols** — add the font in your root layout `<head>`:
   ```html
   <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block" />
   ```

## Three-step integration

### 1. Copy `templates/actions.ts.template` to your project

```bash
mkdir -p src/components/feedback
cp node_modules/@mcailab/mc-feedback/templates/actions.ts.template \
   src/components/feedback/actions.ts
```

Open it and rewrite the three `TODO` sections:

- Import your project's auth check + Firestore Admin handle
- Fill in `identity()` with your "is this user allowed to leave feedback" check
- Keep or change the collection name env var

### 2. Copy `templates/mount.tsx.template` to your project

```bash
cp node_modules/@mcailab/mc-feedback/templates/mount.tsx.template \
   src/components/feedback-mount.tsx
```

Open it and swap the two `TODO` imports for your project's Firestore client handle + actions path. Pick a short `appId` (`'ats'`, `'apt'`, `'eip'`, …) — this scopes the drawer to just your app's pins.

Then mount it in your layout once you have the signed-in user:

```tsx
import { MyFeedbackWidget } from '@/components/feedback-mount';

<MyFeedbackWidget uid={user.uid} email={user.email} name={displayName} />
```

### 3. Deploy Firestore rules + index

See `templates/firestore-rules.rules` and `templates/firestore-index.json` for the exact fragments to paste.

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

### 4. Set env vars

In `apphosting.yaml` or `.env.local`:

```yaml
NEXT_PUBLIC_FEEDBACK_HOSTS: review.yourproject.example,review-yourproject.other-tld.example
# optional, defaults to 'feedback':
FEEDBACK_COLLECTION: feedback
```

The widget renders on these hostnames only. Reviewers visit a listed host → the FAB appears. Any other host → the widget renders nothing (and runs zero Firestore reads).

### 5. (Optional) Push feedback to Google Chat

New feedback, replies and resolve/reopen can post into a Google Chat space, one thread per
feedback item so its replies and status changes stack under it.

```
(Maco) 📝 Alex Wong added feedback
       EIP · Announcements · 22 Oct, 19:46
The Other chip is hard to see in dark mode.
[ View feedback ]
```

| Event | Title | Body |
|---|---|---|
| `comment` | 📝 *name* added feedback | the feedback |
| `reply` | 💬 *name* replied | the reply |
| `resolved` | ✅ *name* resolved feedback | the feedback |
| `reopened` | 🔄 *name* reopened feedback | the feedback |

Edit, move and delete never post. **View feedback** opens the page with that feedback's box
and the drawer open (`?fb=<id>`), whatever its status.

**Setup**

1. In the Chat space: **Apps & integrations → Webhooks → Add webhook**, copy the URL.
2. Give the app the webhook, either way (the ⚙️ setting wins over the env var):
   - **⚙️ in the drawer** (next to "All feedback") — paste the URL, pick events, Save. Needs
     the optional `getChatSettings` / `saveChatSettings` actions; the gear shows only when
     `getChatSettings` returns non-null, so return null for anyone who isn't an admin. It
     returns the full webhook, and anyone holding it can post into the space. Store it in a
     doc Firestore rules keep server-only. Reference: `mcailab/mc-eip`,
     `src/app/components/feedback/actions.ts`.
   - **Server secret** `FEEDBACK_GCHAT_WEBHOOK` (never `NEXT_PUBLIC_*`). On App Hosting:

     ```bash
     firebase apphosting:secrets:set FEEDBACK_GCHAT_WEBHOOK --project <project>
     ```

     ```yaml
     # apphosting.yaml
     - variable: FEEDBACK_GCHAT_WEBHOOK
       secret: FEEDBACK_GCHAT_WEBHOOK
       availability: [RUNTIME]
     ```
3. Set `FEEDBACK_APP_URL` to the **review host** (e.g. `https://eip.mcai.dev`) so View feedback
   opens where the widget is enabled. Unset, the template uses the request's host.
4. Optional `FEEDBACK_GCHAT_EVENTS` (comma list, default all four) when not using ⚙️.

The actions template already calls `notifyGoogleChat()` from `@mcailab/mc-feedback/notify`.
No webhook → nothing is sent. A failed push only logs a warning; the save still succeeds.
Only `https://chat.googleapis.com/...` URLs are accepted.

### The two-domain pattern

For this to be useful, you need **two custom domains pointing at the SAME Firebase App Hosting backend** (same code, same data, same auth) and the review one listed in `NEXT_PUBLIC_FEEDBACK_HOSTS`:

| Domain | Purpose | FAB? | Example (any TLD you like) |
|---|---|---|---|
| **Production** | Day-to-day use by real users | Off | `yourapp.company.example` |
| **Review mirror** | Dedicated host for UX feedback sessions | **Auto-on** | `review.yourapp.company.example` or a short host on a different TLD |

**Why two?** The production host should stay clean — a FAB floating over the real UI is unwanted noise for day-to-day users, and persisted enable-states can leak across sessions. The review host serves the SAME code and the SAME data, with the FAB automatically on. Reviewers go there, drop pins, see real records.

**Firebase App Hosting setup (per backend):**
1. Add BOTH custom domains to the same backend in Firebase Console → App Hosting → `<backend>` → Domains
2. Each adds a DNS record (A + TXT + CNAME) to whichever zone owns that hostname
3. Once SSL issues for both, add the REVIEW hostname (lowercase) to `NEXT_PUBLIC_FEEDBACK_HOSTS`
4. Rebuild — reviewers now visit the review host and see the FAB

**Picking the second domain** — any TLD/zone you control works. ATS uses one production TLD + a `.dev` for review (`careers.masterconcept.ai` + `careers.mcai.dev`), but the pattern is just "two custom domains, same backend, different FAB behavior". You could use `review.yourapp.com`, `yourapp-review.your-dev-tld.com`, a subdomain on a staging zone — whatever your DNS reach allows.

**Also valid without a second custom domain:** list a Firebase App Hosting default `.hosted.app` URL as the review host — but only if your backend still has one available (Firebase disables the `.hosted.app` on a backend once a custom domain is attached). On projects where it stays disabled, a second custom domain is the only path.

## Project-support matrix

| Project | Package mgr | Monorepo? | Firebase client | Firebase admin | Auth |
|---|---|---|---|---|---|
| `mc-ats` (ATS) | npm | no | `^12.15` | `^14.1` | Session cookie + flat role claims |
| `mcapt` (APT) | pnpm | yes (`app/`) | `^12.19` | `^14.4` | Google OIDC |
| `mc-eip` (EIP) | npm | no | **`^13.0.0`** | `^14.5` | Session cookie + grant-based IAM |
| `mc-els` (ELS) | — | — | — | — | — (planned) |

### Cross-project differences the widget already tolerates

| Dimension | Observed in | How to cope |
|---|---|---|
| Firebase client major | 12 (ATS/APT) vs **13** (EIP) | Peer-dep `>=12 <14`; the Firestore APIs the widget uses are stable across the jump. |
| Admin SDK import path | `@/lib/firebase/admin → adminDb` (ATS), `@/lib/firestore → db` (APT), `@/server/firebase/admin → db()` (EIP) | Lives entirely in your `actions.ts`. |
| `db` constant vs function | ATS/APT: const. EIP: `db()` factory. | Mount wrapper writes `firestore={{ db: db(), collectionName: 'feedback' }}` on EIP. |
| Auth system | Session cookie + roles, Google OIDC, grant-based IAM | Your `identity()` is the only touchpoint. Return `{ uid, email, name }`. |
| Monorepo | APT's `app/` under pnpm workspace | Install inside the app folder. |

## Updating

### One command for every consumer

Run the bundled updater from this repo — it syncs every registered consumer's vendored copy, runs their install, and leaves each project's working tree dirty for you to review:

```bash
cd ~/Project/MC/mc-feedback
scripts/update-consumers.sh                 # update to latest tag
scripts/update-consumers.sh v1.2.0          # update to a specific tag
scripts/update-consumers.sh --dry-run       # see what would change, no writes
```

Known consumers are declared at the top of the script (`CONSUMERS=(...)` for the vendored ones + an `ATS_DIR` special-case for mc-ats's in-tree folder). Add a line for each new project that adopts the package.

After the sync, review the diff + commit in each consumer:

```bash
cd ~/Project/MC/mc-eip && git diff vendor/mc-feedback && git commit -am "chore: bump mc-feedback" && git push
cd ~/Project/MC/mcapt  && git diff vendor/mc-feedback && git commit -am "chore: bump mc-feedback" && git push
cd ~/Project/MC/mc-ats && git diff src/components/feedback && git commit -am "chore: bump mc-feedback" && git push
```

Firebase App Hosting rebuilds each one, the update is live.

### Per-consumer manual update (if you prefer)

```bash
# npm (when the repo is public)
npm update @mcailab/mc-feedback
# pnpm (incl. mcapt's monorepo — run inside app/)
pnpm update @mcailab/mc-feedback
# or pin to a new tag
npm install mcailab/mc-feedback#v1.2.0

# or re-vendor by hand (while repo is private)
cd vendor/mc-feedback && git init && git remote add origin https://github.com/mcailab/mc-feedback && git fetch --tags && git checkout v1.2.0 && rm -rf .git
```

## Data model

One Firestore collection shared across every app in a Firebase project:

| Field | Type | Notes |
|---|---|---|
| `appId` | string | Scopes the drawer — `'ats'`, `'apt'`, `'eip'`, … |
| `pageUrl` | string | Pathname where the pin was dropped |
| `pageTitle` | string | `document.title` at write time |
| `vw` | number | Viewport width at capture |
| `coords` | `{ x, y }` | Page coords (fallback anchor) |
| `selector` | string | Legacy CSS selector (kept for compat) |
| `element` | `FeedbackElement \| null` | **Primary anchor** — selector + offset% + rich context |
| `text` | string | Comment body (≤ 2000 chars) |
| `done` | boolean | Open vs resolved |
| `authorUid`, `authorEmail`, `authorName` | string | Server-stamped from session |
| `ts` | number | Create timestamp (ms) |
| `replies` | `FeedbackReply[]` | Append-only thread |

## Design choices

- **Hostname-only activation.** No URL params, no toggle. The host decides. Keeps the review surface clean.
- **No anonymous feedback.** Author identity comes from the signed-in session; the server re-stamps on every write.
- **The drawer lists every page.** Pins only render on their own page, but the drawer is cross-page.
- **Reads gated at Firestore rules.** The widget's hostname gate is belt-and-braces — the client SDK can still query the collection directly.
- **No build step.** Package ships source TS/TSX; Next.js transpiles via `transpilePackages`.

## Roadmap

- **Phase A** — prop-driven widget vendored in ATS. ✅ Done
- **Phase B** — this package. ✅ Done (`v1.0.0`)
- **Phase C** — mobile polish (bottom-sheet drawer, 44px tap targets, status pill at bottom, swipe-to-dismiss).
- **Phase D** — admin page (`/dashboard/feedback`) with cross-page filters, bulk resolve, CSV export.
- **Phase E** — opportunistic "re-anchor" for older pins without element context.

## License

Private — internal use within mcailab projects only.
