# Changelog

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
