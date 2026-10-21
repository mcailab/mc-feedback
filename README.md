# @mcailab/mc-feedback

Click-to-comment UX feedback widget for Next.js + Firebase projects. Drops a pin anywhere on the page, lists pins across the whole app grouped by page or by reviewer, element-relative anchoring so pins follow their target across viewports.

Verified on **mc-ats** (ATS), **mcapt** (APT), **mc-eip** (EIP). Ready for ELS, future projects.

## Install

### Direct from GitHub (recommended)

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
npm install mcailab/mc-feedback#v1.0.0
```

In a **monorepo** (mcapt's `app/` layout), run inside the Next.js app folder:

```bash
cd app && pnpm add github:mcailab/mc-feedback#main
```

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
NEXT_PUBLIC_FEEDBACK_HOSTS: review.yourproject.com,yourproject-review.mcai.dev
# optional, defaults to 'feedback':
FEEDBACK_COLLECTION: feedback
```

The widget renders on these hostnames only. Reviewers visit a listed host → the FAB appears. Any other host → the widget renders nothing (and runs zero Firestore reads).

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

```bash
# Push changes to github.com/mcailab/mc-feedback (bump CHANGELOG + tag)
# Then in each consuming project:
npm update @mcailab/mc-feedback
# or:  npm install mcailab/mc-feedback#v1.2.0
git commit -am "chore: bump mc-feedback"
git push
```

Firebase App Hosting rebuilds, the update is live.

**One push to this repo + one `npm update` per consumer** = every project in sync.

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
