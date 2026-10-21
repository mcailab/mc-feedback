# Changelog

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
