# Changelog

## 1.1.0 — 2026-10-22

- **Google Chat push (new, optional)** — `notifyGoogleChat()` from `@mcailab/mc-feedback/notify`
  posts new comments, replies and resolve/reopen into a Chat space via an incoming webhook,
  one thread per comment. The webhook URL is read from the server secret
  `FEEDBACK_GCHAT_WEBHOOK`; unset means nothing is sent, and a failed push never fails the
  save. Only `chat.googleapis.com` URLs are accepted. The actions template is wired up.
  Card design follows the Maco Reminder bot; `FEEDBACK_GCHAT_EVENTS` picks which events post.
- **Compact Chat card** — title says who did what ("📝 Alex Wong added feedback" / "💬 Sam
  replied" / "✅ … resolved feedback" / "🔄 … reopened feedback"), subtitle = app · page ·
  "22 Oct, 19:46". Body = the text: the feedback (new / resolved / reopened) or the reply.
  One **View feedback** button linking to `?fb=<id>` (the widget opens that feedback; the
  author can add `&fb_edit=1` to land in edit mode). The button needs an absolute base
  (`baseUrl` / `FEEDBACK_APP_URL`, e.g. `https://eip.mcai.dev`; a local dev server gives
  localhost links). Card only — no plain-text line above it.
- **⚙️ Google Chat settings** — gear on the right of "All feedback": the webhook URL in an
  editable field (shows the current one); once a URL is there, "Send when" switches per event
  (New feedback / Reply / Resolved / Reopened) and a **Test** button that posts a "✅ … tested
  the feedback webhook" card to the URL in the box (saved or not). Clearing the field and
  saving stops sending. New optional actions `getChatSettings` / `saveChatSettings` /
  `testChatSettings`; the gear shows only when `getChatSettings` returns non-null, so the
  host gates it (EIP: Super Admin) — it returns the full webhook, so never return it to anyone
  else. `isChatWebhook` and `sendTestChat` are exported from `/notify`.
- **Pointer cursor on every widget button** — always (Tailwind v4 preflight gave buttons the
  arrow), and in feedback mode the forced crosshair
  now skips the widget chrome: FAB, Done, drawer and popover buttons show the hand, text
  boxes the text cursor; pins keep grab and the popover header keeps move.
- **"All feedback" panel can be moved** — drag its header; it becomes a floating card
  (80 vh, kept on screen). Double-click the header to dock it back to the right edge.
- **Pin popover and drawer row share one card layout** — `#N` chip · author / time-ago
  (· replies) · icon actions on the right (✏️ ✓/↺ 🗑, plus ✕ in the popover); text or the edit
  box (Cancel / Save); then a Reply link that opens the reply box (Cancel / Send). Edit now
  happens in place in the popover too; delete (two clicks) is in the drawer row as well; a
  reply to a resolved comment reopens it from either place.
- **Delete needs two clicks** — first click arms a red "Delete?", second deletes; disarms
  after 4 s. Replaces `window.confirm`.
- **Fix: popover Edit opened nothing when the drawer was closed** — it now opens the drawer on
  the comment's tab with the edit box ready.
- **Drawer row button reads "Resolve"** (was "Resolved") — it is an action, and now matches the
  pin popover. Resolved comments still show "Reopen".
- **Pin popover uses icon buttons** — Edit, Resolve/Reopen and Delete are icons (with tooltips)
  in the header, and Close is a ✕ in the top-right corner. Reply stays a labelled button.
- **Pin popover can be moved** — drag it by its header to uncover what it covers. Opening
  another pin starts at that pin's default spot.
- **One icon per status** — open comments show `chat_bubble` in the Users list too (was
  `radio_button_unchecked`), matching the Open tab; resolved stays `check_circle`.
- **One colour per status, same as the pins** — open = amber, resolved = emerald on the tab
  icons (when not selected), the drawer `#N` badge (now a coloured chip) and the popover's
  Resolve/Reopen icon (Reopen was grey).

## 1.0.7 — 2026-10-22

Unsaved text survives a refresh (user report: a refresh lost a half-written comment).

- **New-comment draft is kept** in localStorage (per `appId`) while it has text. Reloading the
  same page brings back the draft pin, the text and feedback mode. It is cleared on save, Cancel,
  Esc, a click outside or the FAB toggle, and when the text is emptied.
- **Replies are kept per comment**, shared by the pin popover and the drawer row, so opening Reply
  again after a refresh shows what was typed. Cleared on send or Cancel.
- Nothing is written to Firestore until Save / Reply, as before. All storage access is guarded, so
  a private window or blocked storage simply keeps the text in memory only.

## 1.0.6 — 2026-10-21

Industry-standard "comment mode" — persistent, keyboard-dismissable.

- **Draft pin shows at the click point** — clicking in feedback mode now drops a visible blue
  pulsing pin exactly where the comment will land, so the reviewer can see the spot. The
  composer opens offset below (via `clampPopoverPosition`) so it never covers the pin.
- **Feedback mode stays on** — saving a comment, cancelling, or clicking outside the box no
  longer exits feedback mode. Reviewers keep dropping pins (one after another) without
  re-enabling. Clicking outside an open draft just dismisses that draft.
- **Exit only on Esc or the FAB toggle** — Esc (capture phase, works from inside the textarea)
  turns feedback mode off and drops any open draft; the bottom-right toggle still works. The
  mode banner button is relabelled "Done".

## 1.0.5 — 2026-10-21

- **Pin is smaller** — 24×24 → 18×18 (user report, pin was too large relative to surrounding
  UI). Font size trimmed to 10px, corner radius tightened to `rounded-md`, active-pin scale
  reduced from 125% to 110%.

## 1.0.4 — 2026-10-21

- **Edit button is grouped on the LEFT in the pin popover** — right after Reply instead of
  being wedged between Resolve and Delete. Mirrors the drawer-row layout.
- **Edit textarea replaces the static text** instead of appearing below it, so the comment
  no longer shows twice while editing.
- Textarea pointer events are stopped so clicks on it don't bubble to the row's navigate
  handler and scroll the page away.

## 1.0.3 — 2026-10-21

- **Author can edit their own comment** — a pencil icon beside Reply (drawer) and beside
  Delete (pin popover). Edit shows an inline textarea with Save/Cancel; the server action
  refuses the write if the caller isn't the original author. New optional `edit` method on
  `FeedbackActions` — safe to add in a point release because it's declared optional (`?`),
  so consumers that don't implement it just don't render the pencil icon.
- **Feedback mode swallows ALL click/pointer actions** — pressing a link or button while
  feedback mode is on used to follow the link or fire the button's handler instead of
  dropping a pin. The capture-phase handler now calls `stopImmediatePropagation()` on every
  `click`, `mousedown`, `pointerdown`, `mouseup`, `pointerup`, and `auxclick` outside the
  widget's own chrome. Only `data-feedback-chrome` elements (FAB, status pill with Cancel,
  drawer, draft bubble, pins) remain interactive — the Cancel/×/escape path is unaffected.
- **Cursor is forced crosshair on every element in feedback mode** — a style tag with
  `html.cursor-crosshair * { cursor: crosshair !important; }` overrides the native pointer
  cursor on links and buttons so a reviewer sees exactly where they're going to pin.
- **Popovers never escape the viewport** — the draft bubble and the pin's comment popover
  both run their anchor through `clampPopoverPosition()`, which keeps the 288px-wide box
  entirely on-screen even when the reviewer clicks near a left/right/bottom edge. Flips
  above the anchor when there's no room below.

## 1.0.2 — 2026-10-21

- FAB contrast upgrade — drawer pill and main FAB now use solid dark/light fills in each
  theme with a ring halo, so they stand out against any page background.

## 1.0.1 — 2026-10-21

- Chat-bubble pin shape (rounded three corners, sharp bottom-left anchor).

## 1.0.0 — 2026-10-21

Initial release. Extracted from `mc-ats/src/components/feedback/` as a reusable package.

**What's in `1.0.0`:**

- `<FeedbackWidget>` React component — prop-driven, works for any Next.js + Firebase project
- Drawer: group by page (Open/Resolved) or by author (Users tab)
- Element-relative pin anchoring — pins follow their element across viewports
- Rich click context (selector, offsets, role, accessible name, landmark path)
- Drag pins to reposition — re-captures element context on drop
- Inline reply + resolve + reopen in the drawer
- Soft-nav + localStorage drawer-state persistence across navigations
- Active-pin ripple + glow
- `captureElement()` and `resolveElementPosition()` helpers in `./capture` for future re-anchor work

**Verified against:**

- ATS: Firebase client `^12.15`, admin `^14.1`, Next 16.2, session-cookie auth
- APT: Firebase client `^12.19`, admin `^14.4`, Next 16.3, pnpm monorepo, Google OIDC
- EIP: Firebase client `^13.0`, admin `^14.5`, Next 16.3, grant-based IAM, `db()` factory
