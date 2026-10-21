// Element capture — client-safe. Turns a clicked DOM element into a structured record that
// lets the pin re-anchor on OTHER viewport sizes, in other browsers, and even after a layout
// change. The record ALSO lets a developer reading a comment know exactly what was clicked
// without having to visit the page.
//
// Industry pattern — BugHerd, Marker.io, Pastel, Jam.dev all store element + offset%, not
// just raw page coordinates. Raw coords break the moment the layout flows differently; an
// element-relative pin follows the element wherever it moves.
//
// This file imports nothing React / server-only and runs in the browser only.

export interface FeedbackElement {
  // Primary anchor: a best-effort stable CSS selector. Prefers `#id`, then any `data-*`
  // attribute that looks like a business id (short, non-generated), then `[aria-label=".."]`,
  // then a tag + nth-of-type chain capped at 6 levels. Never a `class="..."` match — classes
  // on this project come from Tailwind utilities and change at every refactor.
  selector: string;
  // Click position inside the element, as a 0..1 fraction of width/height. On render, the
  // pin is placed at `rect.left + rect.width * offsetXPct` so it tracks the element wherever
  // it has moved to.
  offsetXPct: number;
  offsetYPct: number;
  // Context fields — read by a developer in the drawer, searchable in future admin tools.
  tag: string;
  role: string;
  accessibleName: string;
  textContent: string;
  dataAttrs: Record<string, string>;
  // Human-readable path to the element — "Documents tab › Upload button" — built from the
  // nearest labelled ancestors (h1-h3, [aria-labelledby], [role=region], etc).
  landmark: string;
}

// Build a stable CSS selector for `el`. Returns an empty string if the element is detached.
export function buildStableSelector(el: Element | null): string {
  if (!el || el === document.documentElement || el === document.body) return '';
  // Short-circuit on an id — one segment is enough and tolerant of any ancestor change.
  if (el instanceof HTMLElement && el.id && isStableIdLike(el.id)) {
    return `#${cssEscape(el.id)}`;
  }
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (
    current &&
    current !== document.body &&
    current !== document.documentElement &&
    depth < 6
  ) {
    const seg = segmentFor(current);
    parts.unshift(seg);
    // If this segment is a stable anchor by itself (id, data-*), we can stop walking up.
    if (seg.startsWith('#') || seg.includes('[data-')) break;
    current = current.parentElement;
    depth += 1;
  }
  return parts.join(' > ');
}

// Build one path segment for an element. Prefers id, then data-* with a short stable value,
// then aria-label, then tag + nth-of-type.
function segmentFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el instanceof HTMLElement && el.id && isStableIdLike(el.id)) {
    return `#${cssEscape(el.id)}`;
  }
  // Check for data-* attributes with values that look like business ids (short, no spaces).
  for (const attr of Array.from(el.attributes)) {
    if (!attr.name.startsWith('data-')) continue;
    if (attr.name === 'data-feedback-chrome') continue; // the widget's own marker
    const v = attr.value;
    if (!v || v.length > 60 || /\s/.test(v)) continue;
    return `${tag}[${attr.name}="${cssEscape(v)}"]`;
  }
  // aria-label (short labels only).
  const label = el.getAttribute('aria-label');
  if (label && label.length > 0 && label.length <= 80) {
    return `${tag}[aria-label="${cssEscape(label)}"]`;
  }
  // nth-of-type fallback.
  const parent = el.parentElement;
  if (parent) {
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    const i = sameTag.indexOf(el);
    if (sameTag.length > 1 && i >= 0) {
      return `${tag}:nth-of-type(${i + 1})`;
    }
  }
  return tag;
}

// Reject ids that look auto-generated — Next sometimes emits ids like "radix-:r1:" or
// framework-generated hashes that change on every render.
function isStableIdLike(id: string): boolean {
  if (id.length > 100) return false;
  if (id.startsWith(':') || id.endsWith(':')) return false;
  if (/^radix-/i.test(id)) return false;
  if (/^react-aria-/i.test(id)) return false;
  if (/^[0-9]+$/.test(id)) return false; // bare numbers
  return true;
}

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/["\\]/g, '\\$&');
}

// Capture the richer context record. `pageX`/`pageY` are the click coords; the element is the
// click target (or an ancestor if the click target was a widget's own chrome).
export function captureElement(
  target: Element | null,
  pageX: number,
  pageY: number,
): FeedbackElement {
  if (!target || !(target instanceof HTMLElement)) {
    return {
      selector: '',
      offsetXPct: 0,
      offsetYPct: 0,
      tag: '',
      role: '',
      accessibleName: '',
      textContent: '',
      dataAttrs: {},
      landmark: '',
    };
  }
  const rect = target.getBoundingClientRect();
  // page coords - element rect translated to page space (rect.left is viewport-relative).
  const elX = rect.left + window.scrollX;
  const elY = rect.top + window.scrollY;
  const offsetXPct = rect.width > 0 ? clamp01((pageX - elX) / rect.width) : 0;
  const offsetYPct = rect.height > 0 ? clamp01((pageY - elY) / rect.height) : 0;

  const dataAttrs: Record<string, string> = {};
  for (const a of Array.from(target.attributes)) {
    if (!a.name.startsWith('data-')) continue;
    if (a.name === 'data-feedback-chrome') continue;
    if (!a.value || a.value.length > 120) continue;
    dataAttrs[a.name] = a.value;
    if (Object.keys(dataAttrs).length >= 6) break;
  }

  return {
    selector: buildStableSelector(target),
    offsetXPct,
    offsetYPct,
    tag: target.tagName.toLowerCase(),
    role: target.getAttribute('role') || '',
    accessibleName: readAccessibleName(target).slice(0, 120),
    textContent: (target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    dataAttrs,
    landmark: buildLandmark(target).slice(0, 200),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// aria-label > aria-labelledby target text > title > visible text (first 120 chars).
function readAccessibleName(el: HTMLElement): string {
  const label = el.getAttribute('aria-label');
  if (label) return label;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    const parts = ids
      .map((id) => document.getElementById(id)?.textContent?.trim() || '')
      .filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }
  const title = el.getAttribute('title');
  if (title) return title;
  return (el.textContent || '').trim();
}

// Walk up looking for labelled landmarks and concatenate them: nearest heading, nearest
// labelled region, nearest tab panel. Produces strings like
//   "Documents tab › Upload button"
// Keeps the hierarchy short — 3 segments max.
function buildLandmark(el: HTMLElement): string {
  const parts: string[] = [];
  let node: HTMLElement | null = el;
  let depth = 0;
  while (node && node !== document.body && depth < 20) {
    depth += 1;
    const label = node.getAttribute('aria-label');
    const role = node.getAttribute('role');
    const tag = node.tagName.toLowerCase();

    if (label && label.length <= 60) {
      parts.unshift(label);
    } else if (role && (role === 'region' || role === 'tab' || role === 'tabpanel')) {
      const name = readAccessibleName(node);
      if (name) parts.unshift(name.slice(0, 60));
    } else if (/^h[1-3]$/.test(tag) && node.textContent) {
      parts.unshift(node.textContent.trim().slice(0, 60));
    }
    if (parts.length >= 3) break;
    node = node.parentElement;
  }
  return parts.join(' › ');
}

// Resolve a stored FeedbackElement back to a live page position. Returns the page coords
// (window scroll + element rect + offset%). Returns null if the element cannot be found; the
// caller then falls back to the raw stored coords.
export function resolveElementPosition(
  element: FeedbackElement | null | undefined,
): { x: number; y: number } | null {
  if (!element || !element.selector) return null;
  try {
    const el = document.querySelector(element.selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.left + window.scrollX + rect.width * (element.offsetXPct || 0)),
      y: Math.round(rect.top + window.scrollY + rect.height * (element.offsetYPct || 0)),
    };
  } catch {
    return null;
  }
}
