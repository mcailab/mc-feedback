'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react';

import { usePathname, useRouter } from 'next/navigation';

import { type FeedbackElement, captureElement, resolveElementPosition } from './capture';
import type { FeedbackActions, FeedbackFirestore } from './types';

// Material Symbols icon — a tiny inline span rather than a project-specific `<Icon>` component.
// Expects the host project to load the Material Symbols Outlined font (via the stylesheet
// `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined`, present in every
// current mcailab Next.js project). Projects that don't load that font will see the ligature
// text instead of the glyph; harmless, but worth knowing.
function Icon({
  icon,
  className = '',
}: {
  icon: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined ${className}`}
      translate="no"
      style={{ fontSize: 'inherit', lineHeight: 'inherit' }}
    >
      {icon}
    </span>
  );
}

// Server-action contract the host project provides. Server actions have special Next.js
// FeedbackActions + FeedbackFirestore are the two prop contracts the host project supplies.
// They live in ./types so a project's typed adapter functions can import them directly.
// Shape of a comment as the client cares about it. The server stores more (authorUid,
// authorEmail, ts) but the client only renders what the drawer / pin needs.
interface Comment {
  id: string;
  pageUrl: string;
  // Captured at write time from `document.title`. Pin dropped on the applicant detail reads
  // "Hugo Chen · Application & Integration Lead | Master Concept Careers" — much friendlier
  // than the URL hash. Old pins written before this field existed come back empty and the
  // drawer falls back to the pageUrl.
  pageTitle: string;
  vw: number;
  coords: { x: number; y: number };
  selector: string;
  // Rich click context + offset-percentage anchor (phase 1, 2026-10-21). Lets the pin
  // follow its element across viewports. Null for pins written before this field existed —
  // those keep working via the raw coords fallback.
  element: FeedbackElement | null;
  text: string;
  done: boolean;
  authorName: string;
  authorEmail: string;
  authorUid: string;
  ts: number;
  replies: Array<{
    authorName: string;
    text: string;
    ts: number;
  }>;
}

// A short "N min ago" / "yesterday" / "Mar 3" label for a timestamp. Keeps the drawer compact
// — a full date is noise on something written five minutes ago, and the time is background
// context not the headline. Fallback to an empty string so a missing ts renders nothing.
// Clamp a popover's anchor-centred page position so the box stays inside the viewport. Used
// by both the comment popover and the draft bubble so neither can escape when a reviewer
// clicks near an edge. `boxWidth` is the known rendered width (both use w-72 = 288px);
// `boxHeight` is a conservative upper bound since the popover's real height is content-driven
// and only known after render. Returns `{left, top}` as page coordinates — pair with
// `absolute` positioning and no `-translate-x-1/2`.
function clampPopoverPosition(
  anchorPageX: number,
  anchorPageY: number,
  boxWidth = 288,
  boxHeight = 260,
): { left: number; top: number } {
  const MARGIN = 12;
  const GAP = 20;
  if (typeof window === 'undefined') {
    return { left: anchorPageX - boxWidth / 2, top: anchorPageY + GAP };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sx = window.scrollX;
  const sy = window.scrollY;

  // Horizontal: ideal centred on the anchor, then nudge whichever edge is overflowing until
  // the box fits. If the box is wider than the viewport (narrow mobile) just pin to the left.
  let left = anchorPageX - boxWidth / 2;
  const vpLeft = left - sx;
  if (vpLeft < MARGIN) left = sx + MARGIN;
  else if (vpLeft + boxWidth > vw - MARGIN) left = sx + vw - boxWidth - MARGIN;

  // Vertical: default below the anchor; if that would overflow the bottom, flip above. If
  // neither fits (very short viewport) clamp to the viewport top so at least the top of the
  // box is reachable.
  let top = anchorPageY + GAP;
  const vpTop = top - sy;
  if (vpTop + boxHeight > vh - MARGIN) {
    const flipped = anchorPageY - boxHeight - GAP;
    if (flipped - sy >= MARGIN) top = flipped;
    else top = sy + MARGIN;
  }

  return { left: Math.round(left), top: Math.round(top) };
}

function timeAgo(ts: number): string {
  if (!ts) return '';
  const now = Date.now();
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Derive a human-friendly title from a URL pathname when the stored `document.title` is empty
// or just the site name. Many dashboard pages don't set their own title and inherit the
// template default ('Master Concept Careers'), which read the same for every pin on every page.
// This maps the common ATS routes to a short label; anything unknown falls back to the raw path.
function titleFromUrl(pageUrl: string): string {
  if (!pageUrl || pageUrl === '/') return 'Home';
  const seg = pageUrl.split('?')[0].split('/').filter(Boolean);
  const [a, b, c, d] = seg;
  if (a === 'dashboard') {
    if (!b) return 'Dashboard';
    if (b === 'applicants') return c ? 'Applicant detail' : 'Applicants';
    if (b === 'candidates') {
      if (!c) return 'Candidates';
      if (d === 'edit') return 'Edit candidate';
      return 'Candidate detail';
    }
    if (b === 'jobs') {
      if (!c) return 'Jobs';
      if (c === 'new') return 'New job';
      if (d === 'pipeline') return 'Job pipeline';
      if (d === 'edit') return 'Edit job';
      return 'Job';
    }
    if (b === 'interviews') return 'Interviews';
    if (b === 'talents') return 'Talent Pool';
    if (b === 'analytics') return 'Analytics';
    if (b === 'settings') return c ? `Settings — ${c.replace(/-/g, ' ')}` : 'Settings';
    return b.charAt(0).toUpperCase() + b.slice(1);
  }
  if (a === 'careers' && b) return 'Job page';
  if (a === 'apply' && b) return 'Apply form';
  if (a === 'book' && b) return 'Booking page';
  if (a === 'my-applications') return 'My applications';
  if (a === 'my-account') return 'My account';
  return pageUrl;
}

// Site-only titles that read as noise when they repeat on every row — the template fallback
// Next uses when a page doesn't set its own metadata title.
const SITE_FALLBACK_TITLES = new Set(['Master Concept Careers', 'Master Concept']);

// Pick a drawer-friendly label for a page: prefer the stored document.title (trimmed of our own
// " | Master Concept Careers" suffix if present); when the title is empty OR equals the site
// fallback, derive from the URL path instead. Keeps old pins without a title readable.
function friendlyTitle(pageTitle: string, pageUrl: string): string {
  const t = (pageTitle || '').trim();
  if (!t) return titleFromUrl(pageUrl);
  // Drop a trailing " | <site name>" so a row doesn't read as the same tail everywhere.
  const stripped = t.replace(/\s*\|\s*[^|]+$/, '').trim();
  const candidate = stripped || t;
  // If what's left is only the site name, the page never set its own title — fall back to the
  // URL-derived label so every row says something specific.
  if (SITE_FALLBACK_TITLES.has(candidate)) return titleFromUrl(pageUrl);
  return candidate;
}

// Try to build a lightweight CSS selector for the clicked element — tagName.className + id if
// present, nth-of-type as the fallback. The selector is a HINT, not a lock; coords + viewport
// width are the primary way a pin is replaced on the page. A stale selector just means the
// pin falls back to the raw pixel coords.
function captureSelector(el: Element | null): string {
  if (!el || el === document.documentElement || el === document.body) return '';
  if (el instanceof HTMLElement && el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && depth < 4) {
    const current: Element = node;
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    const siblings: Element[] = parent
      ? Array.from(parent.children).filter((c: Element) => c.tagName === current.tagName)
      : [];
    const index = siblings.indexOf(current) + 1;
    parts.unshift(index > 1 ? `${tag}:nth-of-type(${index})` : tag);
    node = parent;
    depth += 1;
  }
  return parts.join(' > ');
}

// ACTIVATION GATE — HOSTNAME ONLY (2026-10-21, user direction). The widget renders ONLY on
// hostnames listed in `NEXT_PUBLIC_FEEDBACK_HOSTS` (default `careers.mcai.dev`). There is no
// URL override, no per-user toggle, no localStorage flag — the only way to see the FAB is to
// visit the app on the dedicated review hostname. Rationale: careers.masterconcept.ai is the
// production surface HR works on day-to-day and a FAB there was unwanted noise; a reviewer who
// needs to leave comments goes to the review host, which serves the same app and the same data.
//
// Module scope so useSyncExternalStore gets stable identities and the read is computed ONCE per
// session rather than on every render. `getServerSnapshot` returns false so SSR starts off and
// the first client paint already shows the real state.
const FEEDBACK_HOSTS = (process.env.NEXT_PUBLIC_FEEDBACK_HOSTS ?? 'careers.mcai.dev')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

let feedbackEnabledCache: boolean | null = null;
function getEnabledSnapshot(): boolean {
  if (feedbackEnabledCache !== null) return feedbackEnabledCache;
  if (typeof window === 'undefined') {
    feedbackEnabledCache = false;
    return false;
  }
  try {
    const host = window.location.hostname.toLowerCase();
    feedbackEnabledCache = FEEDBACK_HOSTS.includes(host);
  } catch {
    feedbackEnabledCache = false;
  }
  return feedbackEnabledCache;
}
function subscribeEnabled() {
  // The hostname is immutable within a session — a navigation to another origin is a full page
  // load, which remounts the module.
  return () => {};
}
function getServerSnapshot(): boolean {
  return false;
}

// DRAWER STATE STORE — persisted via localStorage so a navigation across layouts (public ↔
// dashboard) or a hard reload keeps the drawer open where the reviewer left it. Soft nav
// within one layout already preserves React state, but relying on that alone made the drawer
// close on cross-layout clicks. Shape mirrors useSyncExternalStore so the lint rule
// `react-hooks/set-state-in-effect` is honoured (no setState in effect).
const DRAWER_STATE_KEY = 'mc-ats:feedback-drawer:v1';
type DrawerStoreState = {
  open: boolean;
  tab: 'open' | 'done' | 'users';
  activeCommentId: string | null;
};
const defaultDrawerState: DrawerStoreState = { open: false, tab: 'open', activeCommentId: null };
let drawerStore: DrawerStoreState = defaultDrawerState;
let drawerStoreHydrated = false;
const drawerListeners = new Set<() => void>();

function hydrateDrawerStore() {
  if (drawerStoreHydrated) return;
  drawerStoreHydrated = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(DRAWER_STATE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<DrawerStoreState>;
    drawerStore = {
      open: !!parsed.open,
      tab:
        parsed.tab === 'done' || parsed.tab === 'users' || parsed.tab === 'open'
          ? parsed.tab
          : 'open',
      activeCommentId: typeof parsed.activeCommentId === 'string' ? parsed.activeCommentId : null,
    };
  } catch {
    // Private mode / cleared data — defaults are fine.
  }
}

function getDrawerSnapshot(): DrawerStoreState {
  hydrateDrawerStore();
  return drawerStore;
}
function getDrawerServerSnapshot(): DrawerStoreState {
  return defaultDrawerState;
}
function subscribeDrawerStore(cb: () => void) {
  drawerListeners.add(cb);
  return () => {
    drawerListeners.delete(cb);
  };
}
function setDrawerStore(patch: Partial<DrawerStoreState>) {
  drawerStore = { ...drawerStore, ...patch };
  try {
    localStorage.setItem(DRAWER_STATE_KEY, JSON.stringify(drawerStore));
  } catch {
    // Nothing to do — the in-memory copy still carries the change for this session.
  }
  drawerListeners.forEach((cb) => cb());
}

export function FeedbackWidget({
  appId,
  uid,
  email,
  name,
  firestore,
  actions,
}: {
  // Which host app these pins belong to. The firestore `feedback` collection is shared across
  // apps so several products can live in one project; a comment left on the ATS must never show
  // up in the ELS drawer or vice versa. Server actions also re-stamp this from the arg (the
  // client is still untrusted) and filter listener queries by it.
  appId: string;
  // Who the comment will be filed as. Passed in from the hosting layout so the client never has
  // to introspect auth state itself; still re-stamped server-side.
  uid: string;
  email: string;
  name: string;
  // Firestore client-SDK handle + collection name — host project provides these so the widget
  // doesn't import a specific firebase project's config. @mcailab/mc-feedback pattern.
  firestore: FeedbackFirestore;
  // Server-action callbacks for create/reply/toggle/move/delete — host project implements
  // these with its own auth check and passes them through. The widget never imports actions
  // directly, so the same code works in every project.
  actions: FeedbackActions;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Hostname check — see FEEDBACK_HOSTS at the top of this file.
  const enabled = useSyncExternalStore(subscribeEnabled, getEnabledSnapshot, getServerSnapshot);
  const [mode, setMode] = useState<'off' | 'on'>('off');
  const [draft, setDraft] = useState<{
    coords: { x: number; y: number };
    selector: string;
    element: FeedbackElement | null;
    text: string;
  } | null>(null);
  // Which user row in the Users tab is currently expanded. One at a time keeps the drawer
  // compact. Not persisted — the Users tab is an inspection view, closing + reopening the
  // drawer should land you back at the collapsed overview.
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  // Drawer state (open flag + active tab + active comment id) is read from a module-scope
  // store that persists to localStorage. That way a navigation across the public/dashboard
  // layout boundary — which unmounts and remounts this widget — rehydrates the drawer in the
  // same state the reviewer left it. See `drawerStore` above.
  const drawerState = useSyncExternalStore(
    subscribeDrawerStore,
    getDrawerSnapshot,
    getDrawerServerSnapshot,
  );
  const { open: drawerOpen, tab: drawerTab, activeCommentId } = drawerState;
  const setDrawerOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(drawerStore.open) : next;
    setDrawerStore({ open: value });
  };
  const setDrawerTab = (next: 'open' | 'done' | 'users') => setDrawerStore({ tab: next });
  const setActiveCommentId = (next: string | null) => setDrawerStore({ activeCommentId: next });
  const [comments, setComments] = useState<Comment[]>([]);
  const [replyText, setReplyText] = useState('');
  // The one drawer row whose inline reply is open. Separate from `activeCommentId` so a
  // reviewer can scroll the drawer, read others, and come back to the one they were replying
  // to without losing the draft. One at a time keeps the drawer compact.
  const [drawerReplyFor, setDrawerReplyFor] = useState<string | null>(null);
  const [drawerReplyText, setDrawerReplyText] = useState('');
  // Which comment is currently being EDITED (via the pencil icon) and the in-progress draft.
  // Author-only — the pencil icon is only shown on rows the current user authored. One at a
  // time, same as the inline-reply pattern, so the drawer stays compact.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  // Drag state for repositioning a pin. The id of the currently-dragging pin, plus a ref that
  // keeps the start coords without re-rendering on every pointermove. `moved` guards the
  // click-vs-drag split: a pointer that never moves past PIN_DRAG_THRESHOLD counts as a click
  // and opens the popover; one that moves farther becomes a drag and never fires the click.
  const [dragId, setDragId] = useState<string | null>(null);
  const dragRef = useRef<{
    startPageX: number;
    startPageY: number;
    pinX: number;
    pinY: number;
    moved: boolean;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  // Live listener on `uxFeedback` ordered by timestamp.One listener for the whole app so a
  // comment dropped on one tab appears on another in realtime. Mounted ONLY when the widget is
  // ENABLED (per the activation gate above) so a user without `?feedback=1` pays nothing — no
  // Firestore reads, no SDK import — and the dashboard that never opens the drawer never
  // subscribes at all. Resubscribes when the gate flips so a mid-session activation works.
  useEffect(() => {
    if (!enabled) return;
    let unsub: (() => void) | null = null;
    (async () => {
      const { collection, onSnapshot, orderBy, query, where } = await import('firebase/firestore');
      // Shared `feedback` collection, scoped to this app. The firestore rule enforces that the
      // signed-in staff may read, and the appId filter keeps the drawer honest when more than
      // one app writes to the same collection. Needs a composite index on (appId, ts).
      const q = query(
        collection(firestore.db, firestore.collectionName),
        where('appId', '==', appId),
        orderBy('ts', 'asc'),
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          const rows: Comment[] = snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              pageUrl: String(data.pageUrl ?? ''),
              pageTitle: String(data.pageTitle ?? ''),
              vw: Number(data.vw ?? 0),
              coords: (data.coords as { x: number; y: number }) ?? { x: 0, y: 0 },
              selector: String(data.selector ?? ''),
              element: (data.element as FeedbackElement | null) ?? null,
              text: String(data.text ?? ''),
              done: !!data.done,
              authorName: String(data.authorName ?? ''),
              authorEmail: String(data.authorEmail ?? ''),
              authorUid: String(data.authorUid ?? ''),
              ts: Number(data.ts ?? 0),
              replies: Array.isArray(data.replies)
                ? (data.replies as Array<{ authorName?: string; text?: string; ts?: number }>).map(
                    (r) => ({
                      authorName: String(r.authorName ?? ''),
                      text: String(r.text ?? ''),
                      ts: Number(r.ts ?? 0),
                    }),
                  )
                : [],
            };
          });
          setComments(rows);
        },
        (err) => {
          // Silent — the widget is best-effort and must not break the dashboard it rides on.
          console.warn('[feedback] firestore listener error', err);
        },
      );
    })();
    return () => {
      if (unsub) unsub();
    };
  }, [enabled]);

  // After a cross-page navigation triggered by clicking a drawer row, scroll to the pin as soon
  // as the destination page's pins have reached us (soft nav keeps the widget mounted but the
  // listener's snapshot catches up a tick later). Runs whenever the active id, pathname or the
  // comments list changes; the pin must be on the current page before we scroll so this is a
  // no-op while the nav is in flight.
  useEffect(() => {
    if (!activeCommentId) return;
    const c = comments.find((x) => x.id === activeCommentId);
    if (!c || c.pageUrl !== pathname) return;
    if (typeof window !== 'undefined') {
      // Element-based position first; falls back to raw coords when the element can't be
      // re-found (older pin without an element record, or layout changed).
      const resolved = resolveElementPosition(c.element) ?? c.coords;
      window.scrollTo({ top: Math.max(0, resolved.y - 100), behavior: 'smooth' });
    }
  }, [activeCommentId, pathname, comments]);

  // Comments pinned to THIS page's URL. The pathname includes dynamic ids
  // (`/dashboard/applicants/<appId>`), so comments drop onto exactly the record they were
  // written against. The on-page list is what the actual PINS render from — a comment left on
  // another URL must not appear on this one.
  const onPage = useMemo(
    () => comments.filter((c) => c.pageUrl === pathname),
    [comments, pathname],
  );

  // The DRAWER (list view) covers EVERY page, grouped by URL (user direction, 2026-10-21).
  // That lets a reviewer see what they have left across the whole app without having to walk
  // back to each page. Current page sorts first; after that groups are ordered by newest
  // activity so the ones that just got a comment or a reply surface at the top.
  const openAll = comments.filter((c) => !c.done);
  const doneAll = comments.filter((c) => c.done);
  // 'users' is a CROSS-CUTTING tab, not a filter on done/open — a reviewer looking at "who
  // has been leaving feedback" wants to see every pin that user has dropped, resolved or not.
  const drawerRows = drawerTab === 'open' ? openAll : drawerTab === 'done' ? doneAll : comments;
  // Distinct users with at least one pin anywhere. Keyed by authorUid (not name/email) because
  // a user who changed their display name is still the same person.
  const userCount = useMemo(() => {
    const seen = new Set<string>();
    for (const c of comments) if (c.authorUid) seen.add(c.authorUid);
    return seen.size;
  }, [comments]);
  const drawerGroups = useMemo(() => {
    const map = new Map<
      string,
      { pageUrl: string; pageTitle: string; rows: Comment[]; latestTs: number }
    >();
    for (const c of drawerRows) {
      const g = map.get(c.pageUrl);
      if (g) {
        g.rows.push(c);
        if (c.ts > g.latestTs) g.latestTs = c.ts;
        // Prefer the NEWEST non-empty title we saw — a page may have been retitled since the
        // earliest pin was dropped, and the latest one reflects what the page currently reads.
        if (c.pageTitle && c.ts >= g.latestTs) g.pageTitle = c.pageTitle;
      } else {
        map.set(c.pageUrl, {
          pageUrl: c.pageUrl,
          pageTitle: c.pageTitle,
          rows: [c],
          latestTs: c.ts,
        });
      }
    }
    // Ordering: oldest group first so the continuous #N numbering accumulates — #1 is the
    // first pin ever dropped, higher numbers are the newer ones. Current-page group is still
    // called out by its amber highlight wherever it falls in the list.
    return Array.from(map.values()).sort((a, b) => a.latestTs - b.latestTs);
  }, [drawerRows]);

  // USERS tab — group every pin by its author. Each group shows the author's name/email once
  // and lists their comments underneath, newest activity first.
  const userGroups = useMemo(() => {
    const map = new Map<
      string,
      { uid: string; name: string; email: string; rows: Comment[]; latestTs: number }
    >();
    for (const c of comments) {
      const key = c.authorUid || c.authorEmail || c.authorName || '(unknown)';
      const g = map.get(key);
      if (g) {
        g.rows.push(c);
        if (c.ts > g.latestTs) g.latestTs = c.ts;
      } else {
        map.set(key, {
          uid: c.authorUid,
          name: c.authorName,
          email: c.authorEmail,
          rows: [c],
          latestTs: c.ts,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.latestTs - a.latestTs);
  }, [comments]);

  // Click-to-add handler. Mounted ONLY while mode === 'on' so the whole dashboard remains
  // untouched when feedback mode is off.
  useEffect(() => {
    if (mode !== 'on') return;
    document.documentElement.classList.add('cursor-crosshair');
    // Force the crosshair cursor on EVERY element while feedback mode is on, overriding
    // link/button `cursor: pointer` rules. Without this, hovering a link flips the cursor to
    // the pointing finger and the reviewer thinks they're about to follow the link rather
    // than drop a pin (bug report, 2026-10-21).
    const cursorStyle = document.createElement('style');
    cursorStyle.setAttribute('data-feedback-cursor', '1');
    cursorStyle.textContent =
      'html.cursor-crosshair, html.cursor-crosshair * { cursor: crosshair !important; }';
    document.head.appendChild(cursorStyle);

    // Capture-phase, pre-handler swallow of EVERY click/pointer/mouse event that lands on
    // page content. Links, form submits, button handlers — all suppressed while feedback
    // mode is on, so the only outcome of a click is dropping a pin.
    //   - `stopImmediatePropagation` is critical. `stopPropagation` only blocks later
    //     elements in the capture/bubble chain; the target's OWN listener in the same
    //     phase still runs. `stopImmediate*` blocks every subsequent listener for this event.
    //   - We also swallow `pointerdown` and `mousedown` because some UI (Radix, Framer, custom
    //     drags) commits actions on pointerdown without waiting for the click.
    function swallow(e: Event) {
      const target = e.target as HTMLElement | null;
      // Widget's own chrome (FAB, drawer, draft bubble, pins) must stay interactive — that
      // includes the Cancel button that gets the reviewer OUT of feedback mode.
      if (target?.closest('[data-feedback-chrome]')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
    }
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-feedback-chrome]')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      const x = Math.round(e.pageX);
      const y = Math.round(e.pageY);
      const selector = captureSelector(target);
      const element = captureElement(target, x, y);
      setDraft({ coords: { x, y }, selector, element, text: '' });
      // Flip mode OFF while a draft is open so a mis-click doesn't spawn a second draft.
      setMode('off');
    }

    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', swallow, true);
    document.addEventListener('pointerdown', swallow, true);
    document.addEventListener('mouseup', swallow, true);
    document.addEventListener('pointerup', swallow, true);
    document.addEventListener('auxclick', swallow, true);
    return () => {
      document.documentElement.classList.remove('cursor-crosshair');
      cursorStyle.remove();
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mousedown', swallow, true);
      document.removeEventListener('pointerdown', swallow, true);
      document.removeEventListener('mouseup', swallow, true);
      document.removeEventListener('pointerup', swallow, true);
      document.removeEventListener('auxclick', swallow, true);
    };
  }, [mode]);

  // Focus the draft textarea when the bubble opens.
  useEffect(() => {
    if (draft) draftRef.current?.focus();
  }, [draft]);

  function saveDraft() {
    if (!draft) return;
    const text = draft.text.trim();
    if (!text) return;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
    // Captured at write time so the drawer can read it later even if the page's title has
    // since changed. document.title is always available in the browser; the ssr-only fallback
    // '' means a very-old pin (none exist in production) shows the url.
    const pageTitle = typeof document !== 'undefined' ? document.title : '';
    startTransition(async () => {
      const r = await actions.create({
        appId,
        pageUrl: pathname,
        pageTitle,
        vw,
        coords: draft.coords,
        selector: draft.selector,
        element: draft.element,
        text,
      });
      if (r.ok) {
        setDraft(null);
        // The listener will push the new row into `comments` on its own; no local update
        // needed. Open the drawer so the user sees their comment land in Open.
        setDrawerOpen(true);
        setDrawerTab('open');
      }
    });
  }

  function toggleDone(id: string, next: boolean) {
    startTransition(async () => {
      await actions.toggleDone(id, next);
    });
  }

  function remove(id: string) {
    if (!confirm('Delete this comment? This cannot be undone.')) return;
    startTransition(async () => {
      await actions.delete(id);
      setActiveCommentId(null);
    });
  }

  function reply(id: string) {
    const t = replyText.trim();
    if (!t) return;
    startTransition(async () => {
      const r = await actions.reply(id, t);
      if (r.ok) setReplyText('');
    });
  }

  // ACTIVATION GATE — render nothing until `?feedback=1` has flipped `enabled` on. All hooks
  // above run unconditionally so React's hooks rule is honoured; the firestore listener itself
  // is gated on `enabled` so a disabled widget costs zero reads.
  if (!enabled) return null;

  return (
    <>
      {/* VIEWPORT OVERLAY — when feedback mode is ON, draw an amber border around the whole
          viewport so there is no doubt the next click will drop a pin instead of doing whatever
          the UI below normally does. Pointer-events-none so clicks pass straight through to the
          page; the status pill in it has its own pointer-events-auto. z-index below the pins
          (9000) is deliberate — the border is wallpaper, the pins and popovers live on top. */}
      {mode === 'on' && (
        <>
          <div
            data-feedback-chrome
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-[8900] animate-pulse ring-4 ring-amber-400 ring-inset"
          />
          <div
            data-feedback-chrome
            className="fixed top-4 left-1/2 z-[9300] flex -translate-x-1/2 items-center gap-3 rounded-full border border-amber-400 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900 shadow-xl dark:bg-amber-950 dark:text-amber-100"
          >
            <Icon icon="ads_click" className="text-[16px]!" />
            <span>Click any part of the page to drop a feedback pin</span>
            <button
              type="button"
              onClick={() => setMode('off')}
              className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-amber-900 hover:bg-amber-100 dark:bg-amber-900 dark:text-amber-100 dark:hover:bg-amber-800"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {/* Pins on this page. Absolute positioning in page space so they scroll with content.
          Also DRAGGABLE: pointer-based so the pin follows the cursor on both mouse and touch,
          with a 4px threshold that keeps a plain click opening the popover. Repositioning is
          optimistic — the local state moves right away, the server write happens in the
          background. */}
      {onPage.map((c, i) => {
        // Effective coords: resolve from the element anchor when it finds its target, else
        // fall back to the stored raw coords. During a drag of THIS pin, raw coords win so
        // the pin follows the cursor instead of snapping back to the (unchanged) element.
        const effective =
          dragId === c.id ? c.coords : (resolveElementPosition(c.element) ?? c.coords);
        return (
          <button
            key={c.id}
            data-feedback-chrome
            type="button"
            onPointerDown={(e) => {
              // Capture so the pointer stream keeps coming even if the cursor leaves the pin.
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              dragRef.current = {
                startPageX: e.nativeEvent.pageX,
                startPageY: e.nativeEvent.pageY,
                pinX: effective.x,
                pinY: effective.y,
                moved: false,
              };
            }}
            onPointerMove={(e) => {
              if (!dragRef.current) return;
              const dx = e.nativeEvent.pageX - dragRef.current.startPageX;
              const dy = e.nativeEvent.pageY - dragRef.current.startPageY;
              if (!dragRef.current.moved && Math.hypot(dx, dy) < 4) return;
              dragRef.current.moved = true;
              setDragId(c.id);
              const nx = dragRef.current.pinX + dx;
              const ny = dragRef.current.pinY + dy;
              // Optimistic local move — the user drags and the pin follows, no server round-trip.
              setComments((prev) =>
                prev.map((p) => (p.id === c.id ? { ...p, coords: { x: nx, y: ny } } : p)),
              );
            }}
            onPointerUp={(e) => {
              const d = dragRef.current;
              dragRef.current = null;
              setDragId(null);
              if (!d?.moved) return; // not a drag — the onClick below handles the pin-click
              const dx = e.nativeEvent.pageX - d.startPageX;
              const dy = e.nativeEvent.pageY - d.startPageY;
              const nx = Math.max(0, d.pinX + dx);
              const ny = Math.max(0, d.pinY + dy);
              const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
              // Prevent the follow-up click event — a drag that lands with the pointer still over
              // the pin would otherwise fire onClick too and reopen the popover we didn't ask for.
              e.preventDefault();
              e.stopPropagation();
              // Re-capture the element the pin was DROPPED on so it re-anchors to the right
              // target. elementFromPoint uses viewport coords; subtract scroll to translate.
              let newElement: FeedbackElement | null = null;
              if (typeof document !== 'undefined') {
                const vx = e.nativeEvent.pageX - window.scrollX;
                const vy = e.nativeEvent.pageY - window.scrollY;
                const target = document.elementFromPoint(vx, vy);
                // Skip the pin itself, the widget's chrome, and anything that would otherwise
                // make the pin anchor to itself.
                const dropTarget =
                  target && !(target as HTMLElement).closest('[data-feedback-chrome]')
                    ? target
                    : null;
                if (dropTarget) newElement = captureElement(dropTarget, nx, ny);
              }
              startTransition(async () => {
                const r = await actions.move(c.id, { x: nx, y: ny }, vw, newElement);
                if (!r.ok) {
                  // On refusal, snap back by re-rendering from the server copy that was already
                  // there (we never cleared it); nothing extra needed because the listener will
                  // overwrite us on the next snapshot. Keep this comment as a note for future me.
                }
              });
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // A click AFTER a drag arrives with dragRef already cleared; the moved flag lives
              // only during the drag, so this branch only runs on a real click.
              setActiveCommentId(c.id === activeCommentId ? null : c.id);
              setMode('off');
            }}
            title={c.text}
            // Larger (28px), two-ring halo and drop-shadow so the pin reads over any background —
            // a 24px marker over a dark navbar had been easy to miss. The ring-2 ring-white gives
            // it a crisp edge against the colour behind it (same trick Google Maps uses on pins).
            // `touch-none` disables browser scroll on touch so a finger drag moves the pin.
            // Pin: chat-bubble shape — rounded three corners + sharp bottom-left so the pin
            // reads as a tag/callout pointing at the anchor underneath it. 18px tall, min
            // 18px wide (shrunk from 24px — user report, 2026-10-21), grows horizontally via
            // `px-1` so 2–3 digit numbers fit without stretching taller. ring-2 ring-white
            // halo for contrast against any background. The anchor sits at the pin's
            // bottom-LEFT (the sharp corner), so -translate-y-full with NO x translate puts
            // the tip exactly on the click point.
            className={`absolute z-[9000] inline-flex h-[18px] min-w-[18px] -translate-y-full touch-none items-center justify-center rounded-tl-md rounded-tr-md rounded-br-md px-1 text-[10px] font-semibold text-white shadow ring-2 ring-white transition-transform select-none hover:scale-110 ${
              c.done ? 'bg-emerald-500' : 'bg-amber-500'
            } ${c.id === activeCommentId ? 'scale-110 shadow-[0_0_24px_rgba(245,158,11,0.8)] ring-4 ring-amber-200' : ''} ${
              dragId === c.id ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            style={{ left: effective.x, top: effective.y }}
          >
            {/* GLOWING RIPPLE around the active pin (user direction, 2026-10-21) — a pulsing
              ring that expands outward and fades, drawing the eye the moment a reviewer lands
              on the destination page. `animate-ping` is Tailwind's built-in expand+fade; the
              inset-0 overlay starts at the pin's own size and grows to 2× before resetting. */}
            {c.id === activeCommentId && (
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 animate-ping rounded-tl-md rounded-tr-md rounded-br-md opacity-75 ${
                  c.done ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
            )}
            <span className="relative">{c.done ? '✓' : i + 1}</span>
          </button>
        );
      })}

      {/* Active comment popover — opens anchored to the pin. */}
      {activeCommentId &&
        (() => {
          const c = onPage.find((x) => x.id === activeCommentId);
          if (!c) return null;
          const canDelete = c.authorUid === uid;
          const effective = resolveElementPosition(c.element) ?? c.coords;
          return (
            <div
              data-feedback-chrome
              className="absolute z-[9001] w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
              style={clampPopoverPosition(effective.x, effective.y)}
            >
              <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="truncate font-medium text-zinc-700 dark:text-zinc-200">
                  {c.authorName || c.authorEmail}
                </span>
                <span className="ml-auto">{new Date(c.ts).toLocaleString()}</span>
              </div>
              <p className="mb-2 text-sm text-zinc-800 dark:text-zinc-100">{c.text}</p>
              {/* ELEMENT CONTEXT — nearest-landmark path from capture. Reads as
                  'Documents tab › Upload button' etc. Hidden when the pin has no element record
                  (older pins) or the landmark is empty. */}
              {c.element?.landmark && (
                <p
                  className="mb-2 truncate rounded bg-zinc-50 px-2 py-1 text-[10px] text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400"
                  title={`${c.element.tag}${c.element.role ? ` [${c.element.role}]` : ''}${c.element.accessibleName ? ` — ${c.element.accessibleName}` : ''}`}
                >
                  <Icon icon="my_location" className="mr-1 inline text-[12px]!" />
                  {c.element.landmark}
                </p>
              )}
              {c.replies.length > 0 && (
                <div className="mb-2 flex flex-col gap-1 rounded border border-zinc-100 bg-zinc-50 p-2 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
                  {c.replies.map((r, i) => (
                    <div key={i}>
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">
                        {r.authorName}
                      </span>{' '}
                      <span className="text-zinc-600 dark:text-zinc-400">{r.text}</span>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                placeholder="Reply…"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                className="mb-2 w-full resize-none rounded border border-zinc-200 p-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                rows={2}
              />
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => reply(c.id)}
                  disabled={!replyText.trim() || pending}
                  className="rounded bg-blue-600 px-2 py-1 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Reply
                </button>
                {canDelete && actions.edit && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(c.id);
                      setEditingText(c.text);
                      setActiveCommentId(null);
                    }}
                    title="Edit this comment"
                    className="inline-flex items-center gap-0.5 rounded border border-zinc-300 px-2 py-1 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <Icon icon="edit" className="text-[12px]!" />
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggleDone(c.id, !c.done)}
                  className="rounded border border-zinc-300 px-2 py-1 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {c.done ? 'Reopen' : 'Resolve'}
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    className="rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400"
                  >
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveCommentId(null)}
                  className="ml-auto text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  Close
                </button>
              </div>
            </div>
          );
        })()}

      {/* Draft bubble — pops up right after the user clicks on a target. */}
      {draft && (
        <div
          data-feedback-chrome
          className="absolute z-[9100] w-72 rounded-lg border border-amber-200 bg-white p-3 shadow-xl dark:border-amber-900 dark:bg-zinc-900"
          style={clampPopoverPosition(draft.coords.x, draft.coords.y)}
        >
          <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Add feedback — as {name || email}
          </p>
          <textarea
            ref={draftRef}
            placeholder="What's wrong, or what should change?"
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            className="mb-2 w-full resize-none rounded border border-zinc-200 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            rows={3}
          />
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={saveDraft}
              disabled={!draft.text.trim() || pending}
              className="rounded bg-blue-600 px-3 py-1 font-medium text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Drawer — fixed to the right side of the viewport. Lists comments ON THIS PAGE only.
          A full admin page (across every URL) is planned next; for now the drawer scopes the
          view to where the reader is standing. */}
      {drawerOpen && (
        <aside
          data-feedback-chrome
          className="fixed top-0 right-0 z-[9050] flex h-full w-80 flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        >
          <header className="flex items-start gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                All feedback
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Close"
            >
              <Icon icon="close" className="text-[16px]! leading-4!" />
            </button>
          </header>
          <div className="flex gap-1 border-b border-zinc-100 p-2 text-xs dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setDrawerTab('open')}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium ${
                drawerTab === 'open'
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              <Icon icon="chat_bubble" className="text-[14px]!" />
              Open ({openAll.length})
            </button>
            <button
              type="button"
              onClick={() => setDrawerTab('done')}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium ${
                drawerTab === 'done'
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              <Icon icon="check_circle" className="text-[14px]!" />
              Resolved ({doneAll.length})
            </button>
            <button
              type="button"
              onClick={() => setDrawerTab('users')}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium ${
                drawerTab === 'users'
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              <Icon icon="group" className="text-[14px]!" />
              Users ({userCount})
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {drawerTab === 'users' ? (
              userGroups.length === 0 ? (
                <p className="p-3 text-xs text-zinc-500 dark:text-zinc-400">No reviewers yet.</p>
              ) : (
                userGroups.map((u) => {
                  const isExpanded = expandedUserId === u.uid;
                  const openCount = u.rows.filter((r) => !r.done).length;
                  return (
                    <section
                      key={u.uid || u.email}
                      className="border-b border-zinc-100 dark:border-zinc-800"
                    >
                      {/* USER SUMMARY ROW — name, email, total count. Click to expand. */}
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedUserId(isExpanded ? null : u.uid || u.email || '')
                        }
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      >
                        <Icon
                          icon={isExpanded ? 'expand_more' : 'chevron_right'}
                          className="shrink-0 text-[16px]! text-zinc-400"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                            {u.name || u.email || '(unknown)'}
                          </div>
                          {u.email && (
                            <div className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                              {u.email}
                            </div>
                          )}
                        </div>
                        <span
                          className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                          title={`${openCount} open, ${u.rows.length - openCount} resolved`}
                        >
                          {u.rows.length}
                        </span>
                      </button>
                      {/* EXPANDED COMMENT LIST — one row per comment, with a status icon on
                          the left, the text as title, time on the right. Clicking a row jumps
                          to that comment in its correct tab (Open or Resolved) and navigates
                          to the destination page. */}
                      {isExpanded && (
                        <ul className="bg-zinc-50 dark:bg-zinc-900/50">
                          {u.rows
                            .slice()
                            .sort((a, b) => b.ts - a.ts)
                            .map((cm) => (
                              <li key={cm.id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    // Jump to this comment in whichever tab it belongs to.
                                    setDrawerTab(cm.done ? 'done' : 'open');
                                    setActiveCommentId(cm.id);
                                    if (cm.pageUrl === pathname) {
                                      if (typeof window !== 'undefined') {
                                        const target =
                                          resolveElementPosition(cm.element) ?? cm.coords;
                                        window.scrollTo({
                                          top: Math.max(0, target.y - 100),
                                          behavior: 'smooth',
                                        });
                                      }
                                    } else {
                                      router.push(cm.pageUrl);
                                    }
                                  }}
                                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 pl-9 text-left text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                >
                                  <Icon
                                    icon={cm.done ? 'check_circle' : 'radio_button_unchecked'}
                                    className={`shrink-0 text-[14px]! ${
                                      cm.done ? 'text-emerald-500' : 'text-amber-500'
                                    }`}
                                  />
                                  <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-100">
                                    {cm.text}
                                  </span>
                                  <span
                                    className="shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400"
                                    title={new Date(cm.ts).toLocaleString()}
                                  >
                                    {timeAgo(cm.ts)}
                                  </span>
                                </button>
                              </li>
                            ))}
                        </ul>
                      )}
                    </section>
                  );
                })
              )
            ) : drawerGroups.length === 0 ? (
              <p className="p-3 text-xs text-zinc-500 dark:text-zinc-400">
                {drawerTab === 'open'
                  ? 'No open comments. Press the floating button → click on the UI to add one.'
                  : 'No resolved comments yet.'}
              </p>
            ) : (
              drawerGroups.map((g, gi) => {
                const isHere = g.pageUrl === pathname;
                // CONTINUOUS NUMBERING across the whole drawer (user direction, 2026-10-21):
                // page A has #1..#2, page B picks up at #3, and so on. Walked in render order
                // (current page always first) so the first row in the drawer is always #1.
                const indexOffset = drawerGroups
                  .slice(0, gi)
                  .reduce((n, prev) => n + prev.rows.length, 0);
                return (
                  <section
                    key={g.pageUrl}
                    className="border-b border-zinc-100 dark:border-zinc-800"
                  >
                    {/* GROUP HEADER — the page URL as a sticky mini-bar, the current page gets a
                        pill marker ("You are here") so reviewers never confuse the group they
                        are STANDING on with the groups below. A page not under the current
                        origin's handling (shouldn't happen, but future-proof) renders the URL
                        as-is instead of a link. */}
                    <div
                      className={`sticky top-0 z-10 border-b px-3 py-2 text-xs ${
                        isHere
                          ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
                          : 'border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/70'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {/* Title line — document.title at write time, falling back to the URL
                            when the pin predates that capture. Truncated so a long title doesn't
                            push the count badge off-screen. The URL below reads as the subtitle
                            and is where the "open this page" affordance lives. */}
                        {isHere ? (
                          <div
                            className="min-w-0 flex-1 truncate font-medium text-amber-900 dark:text-amber-200"
                            title={g.pageTitle || g.pageUrl}
                          >
                            {friendlyTitle(g.pageTitle, g.pageUrl)}
                          </div>
                        ) : (
                          <a
                            href={g.pageUrl}
                            className="min-w-0 flex-1 truncate font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-200"
                            title={`Open ${g.pageUrl}`}
                          >
                            {friendlyTitle(g.pageTitle, g.pageUrl)}
                          </a>
                        )}
                        <span
                          // Just the count — the amber background on current-page groups
                          // already signals "you are here", so a "You · N" prefix read as
                          // "pins by you" and made the other groups look inconsistent (user
                          // report, 2026-10-21). Count label is the same shape for every group
                          // now; the group bg + sticky-first position does the "here" job.
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            isHere
                              ? 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100'
                              : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200'
                          }`}
                          title={isHere ? 'You are here' : undefined}
                        >
                          {g.rows.length}
                        </span>
                      </div>
                      {/* URL subtitle removed on 2026-10-21 (user direction) — the friendly
                          title line already names the page and the raw record-id tail is
                          noise. The pathname is still in the title attribute on the title
                          line so hovering reveals it when a reviewer really needs the id. */}
                    </div>
                    <div className="p-3">
                      {g.rows.map((c, i) => {
                        const openReply = drawerReplyFor === c.id;
                        // The main title area navigates (same page = scroll to pin, other page =
                        // hard nav). The action buttons below have their own click handlers so
                        // the title click stays simple and predictable.
                        const navigate = () => {
                          if (isHere) {
                            setActiveCommentId(c.id);
                            if (typeof window !== 'undefined') {
                              const target = resolveElementPosition(c.element) ?? c.coords;
                              window.scrollTo({
                                top: Math.max(0, target.y - 100),
                                behavior: 'smooth',
                              });
                            }
                          } else {
                            // SOFT nav via Next's router — keeps the drawer open and the
                            // listener subscribed across the hop (user direction, 2026-10-21).
                            // The pin highlight carries over because activeCommentId is set
                            // first and the drawer survives the navigation. If the destination
                            // is on a different layout (public ↔ dashboard) the widget remounts
                            // and this state is lost; nothing persists it today — a known gap.
                            setActiveCommentId(c.id);
                            router.push(c.pageUrl);
                          }
                        };
                        return (
                          <div
                            key={c.id}
                            className="mb-2 rounded border border-zinc-200 bg-white p-2 text-xs transition-colors dark:border-zinc-700 dark:bg-zinc-800"
                          >
                            <button
                              type="button"
                              onClick={navigate}
                              // `cursor-pointer` + hover tint so a reviewer reads the row as
                              // clickable before they discover it (user direction, 2026-10-21).
                              // Tailwind's reset removes the browser's default button cursor,
                              // so this has to be explicit.
                              title={
                                isHere
                                  ? 'Scroll to this pin'
                                  : `Open ${friendlyTitle(c.pageTitle, c.pageUrl)}`
                              }
                              className="-mx-1 block w-full cursor-pointer rounded px-1 py-0.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-700/40"
                            >
                              {/* HEADER LINE — row number + author on the left, timestamp on
                                  the right (user direction, 2026-10-21): the time is background
                                  context, not the headline, and sits where the eye lands last. */}
                              <div className="mb-1 flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                                <span>#{indexOffset + i + 1}</span>
                                <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">
                                  {c.authorName || c.authorEmail}
                                </span>
                                {c.replies.length > 0 && (
                                  <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
                                    {c.replies.length}
                                  </span>
                                )}
                                <span
                                  className="ml-auto shrink-0 text-[10px]"
                                  title={new Date(c.ts).toLocaleString()}
                                >
                                  {timeAgo(c.ts)}
                                </span>
                              </div>
                              {/* While editing, the TEXTAREA takes the place of the static
                                  text — showing both at once was a duplicate (bug report,
                                  2026-10-21). The outer button also stops being clickable so
                                  a stray navigate doesn't fire during edit. */}
                              {editingId === c.id && actions.edit ? (
                                <textarea
                                  value={editingText}
                                  onChange={(e) => setEditingText(e.target.value)}
                                  rows={3}
                                  autoFocus
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-full resize-none rounded border border-zinc-200 p-1.5 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                                />
                              ) : (
                                <p className="line-clamp-3 text-zinc-800 dark:text-zinc-100">
                                  {c.text}
                                </p>
                              )}
                            </button>
                            {/* Inline edit action row (Cancel + Save) — only renders while
                                this row is being edited. */}
                            {editingId === c.id && actions.edit ? (
                              <div className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-700">
                                <div className="mt-1 flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingId(null);
                                      setEditingText('');
                                    }}
                                    className="rounded px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    disabled={pending || !editingText.trim() || editingText.trim() === c.text}
                                    onClick={() => {
                                      const txt = editingText.trim();
                                      if (!txt) return;
                                      startTransition(async () => {
                                        const r = await actions.edit!(c.id, txt);
                                        if (r.ok) {
                                          setEditingId(null);
                                          setEditingText('');
                                        }
                                      });
                                    }}
                                    className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : null}
                            {/* ACTION ROW — Reply, Edit (author-only), Resolve on the right. */}
                            {!openReply && editingId !== c.id && (
                              <div className="mt-2 flex items-center gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-700">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDrawerReplyFor(c.id);
                                    setDrawerReplyText('');
                                  }}
                                  disabled={pending}
                                  className="rounded px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/40 disabled:opacity-50"
                                >
                                  Reply
                                </button>
                                {c.authorUid === uid && actions.edit && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingId(c.id);
                                      setEditingText(c.text);
                                    }}
                                    disabled={pending}
                                    title="Edit this comment"
                                    className="inline-flex items-center gap-0.5 rounded px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                                  >
                                    <Icon icon="edit" className="text-[14px]!" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => toggleDone(c.id, !c.done)}
                                  disabled={pending}
                                  className={`ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
                                    c.done
                                      ? 'text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40'
                                      : 'text-emerald-700 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/40'
                                  } disabled:opacity-50`}
                                >
                                  <Icon
                                    icon={c.done ? 'undo' : 'check_circle'}
                                    className="text-[14px]!"
                                  />
                                  {c.done ? 'Reopen' : 'Resolved'}
                                </button>
                              </div>
                            )}
                            {openReply && (
                              <div className="mt-2">
                                <textarea
                                  value={drawerReplyText}
                                  onChange={(e) => setDrawerReplyText(e.target.value)}
                                  placeholder="Reply…"
                                  rows={2}
                                  autoFocus
                                  className="w-full resize-none rounded border border-zinc-200 p-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                                />
                                <div className="mt-1 flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDrawerReplyFor(null);
                                      setDrawerReplyText('');
                                    }}
                                    className="rounded px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    disabled={pending || !drawerReplyText.trim()}
                                    onClick={() => {
                                      const txt = drawerReplyText.trim();
                                      if (!txt) return;
                                      startTransition(async () => {
                                        const r = await actions.reply(c.id, txt);
                                        if (r.ok) {
                                          setDrawerReplyFor(null);
                                          setDrawerReplyText('');
                                          // A reply to a RESOLVED comment auto-reopens it (user
                                          // direction, 2026-10-21). A reply is new activity, so
                                          // the row shouldn't stay buried under "Resolved".
                                          if (c.done) await actions.toggleDone(c.id, false);
                                        }
                                      });
                                    }}
                                    className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                  >
                                    Send
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        </aside>
      )}

      {/* FAB — single toggle for feedback mode + a secondary button for the drawer. Fixed to
          the bottom-right of the viewport so it is always reachable regardless of page
          content. */}
      <div
        data-feedback-chrome
        // FAB — respects the iOS safe-area-inset-bottom so it never hides behind the home
        // indicator. `calc(1rem + safe-area)` keeps the usual 1rem gap on devices that have
        // no inset (desktop).
        className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[9200] flex flex-col items-end gap-2"
      >
        <button
          type="button"
          onClick={() => setDrawerOpen((v) => !v)}
          // The badge counts OPEN comments across the WHOLE site, not just this page (user
          // direction, 2026-10-21) — the drawer is cross-page and this is how a reviewer
          // sees at a glance how much work is still queued without opening it. The current
          // page's count still sits inside the drawer as the "You · N" pill.
          title={`${openAll.length} open comment${openAll.length === 1 ? '' : 's'} across the whole site${
            onPage.length > 0 ? ` (${onPage.length} on this page)` : ''
          }`}
          // DRAWER BUTTON — solid dark pill in light mode, solid light pill in dark mode. The
          // previous white/zinc-900 pair blended into most page backgrounds and the hover
          // only shifted the border (invisible against light surfaces). Inverted fill per
          // theme + white/dark ring halo guarantees contrast against ANY underlying color.
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white shadow-md ring-2 ring-white/80 transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:ring-zinc-900/40 dark:hover:bg-zinc-200"
        >
          <Icon icon="chat" className="text-[14px]! leading-4!" />
          {openAll.length > 0 && <span>{openAll.length}</span>}
        </button>
        {/* MAIN FAB — solid blue when idle, amber when feedback mode is on. White ring halo
            in both themes so the circle reads over any page color. Hover darkens the fill
            (not just scaling) so the button clearly reacts on busy backgrounds. The package
            uses the generic `blue-600`/`blue-700` palette rather than a project token like
            `brand-blue` so it works out of the box in every consumer. */}
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === 'on' ? 'off' : 'on'));
            setDraft(null);
            setActiveCommentId(null);
          }}
          title={mode === 'on' ? 'Cancel feedback mode' : 'Add feedback — click anywhere on the UI'}
          className={`inline-flex size-12 items-center justify-center rounded-full text-white shadow-lg ring-2 ring-white/80 transition-colors dark:ring-zinc-900/40 ${
            mode === 'on'
              ? 'bg-amber-500 hover:bg-amber-600'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          <Icon
            icon={mode === 'on' ? 'close' : 'add_comment'}
            className="text-[20px]! leading-5!"
          />
        </button>
      </div>
    </>
  );
}
