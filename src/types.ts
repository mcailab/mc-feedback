// Public types for @mcailab/mc-feedback. These are what a host project needs to construct
// the `actions` and `firestore` props on <FeedbackWidget>. Importing them is optional in
// TypeScript projects — TS infers most through the FeedbackWidget prop types — but exported
// here for clarity and for projects that want strongly-typed adapter functions.

import type { Firestore } from 'firebase/firestore';

import type { FeedbackElement } from './capture';

export type { FeedbackElement } from './capture';

// The server-action contract. Each host project implements these five callbacks with its own
// auth check + Firestore Admin SDK writes, then passes them in as the `actions` prop.
// Server actions have special Next.js serialization that lets them cross the server→client
// boundary as props.
export interface FeedbackActions {
  create: (input: {
    appId: string;
    pageUrl: string;
    pageTitle: string;
    vw: number;
    coords: { x: number; y: number };
    selector: string;
    element: FeedbackElement | null;
    text: string;
  }) => Promise<{ ok: boolean; id?: string; error?: string }>;
  reply: (
    commentId: string,
    text: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  toggleDone: (
    commentId: string,
    done: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
  delete: (commentId: string) => Promise<{ ok: boolean; error?: string }>;
  edit?: (
    commentId: string,
    text: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  move: (
    commentId: string,
    coords: { x: number; y: number },
    vw: number,
    element: FeedbackElement | null,
  ) => Promise<{ ok: boolean; error?: string }>;
  // Optional Google Chat settings (the ⚙️ next to "All feedback"). The gear only shows when
  // these are passed AND `getChatSettings` returns non-null, so the host decides who may
  // manage it (admins only — whoever sets the webhook decides where feedback goes).
  getChatSettings?: () => Promise<FeedbackChatSettingsView | null>;
  saveChatSettings?: (input: {
    // A new webhook URL; '' / null removes it; undefined keeps the current one.
    webhook?: string | null;
    events: FeedbackChatEventKind[];
  }) => Promise<{ ok: boolean; error?: string }>;
  // Sends a test card to the given webhook (the one in the settings box, saved or not).
  testChatSettings?: (webhook: string) => Promise<{ ok: boolean; error?: string }>;
}

export type FeedbackChatEventKind = 'comment' | 'reply' | 'resolved' | 'reopened';

// Returned ONLY to viewers the host lets manage settings (EIP: Super Admin). It includes the
// webhook itself (its key + token let anyone post into the space), so never return it to
// anyone else — return null instead, which also hides the gear.
export interface FeedbackChatSettingsView {
  webhook: string;
  // 'settings' = saved via the gear; 'env' = falling back to FEEDBACK_GCHAT_WEBHOOK.
  source: 'settings' | 'env' | 'none';
  events: FeedbackChatEventKind[];
}

// Firestore client-SDK handle + collection name. ATS/APT export `db` as a constant and pass
// it directly; EIP exports `db()` as a factory so its mount wrapper invokes it:
// `firestore={{ db: db(), collectionName: 'feedback' }}`.
export interface FeedbackFirestore {
  db: Firestore;
  collectionName: string;
}

// What a comment looks like on the wire. The widget's listener reads this shape from
// Firestore and the host project's `actions.create` writes it back. Projects that export
// their own types from Admin SDK types can reuse this for the server-side `createFeedbackComment`
// stored shape (minus `id`, which Firestore assigns).
export interface FeedbackComment {
  id: string;
  appId: string;
  pageUrl: string;
  pageTitle: string;
  vw: number;
  coords: { x: number; y: number };
  selector: string;
  element: FeedbackElement | null;
  text: string;
  done: boolean;
  authorUid: string;
  authorEmail: string;
  authorName: string;
  ts: number;
  replies: FeedbackReply[];
}

export interface FeedbackReply {
  authorUid: string;
  authorEmail: string;
  authorName: string;
  text: string;
  ts: number;
}
