// Google Chat push for feedback events. SERVER-ONLY: call it from the host project's
// server actions, never from the browser. The webhook URL carries its own key + token, so
// whoever holds it can post into the space. Keep it in a server env var / secret
// (e.g. FEEDBACK_GCHAT_WEBHOOK), never in a NEXT_PUBLIC_* var.
//
//   import { notifyGoogleChat } from '@mcailab/mc-feedback/notify';
//   await notifyGoogleChat(process.env.FEEDBACK_GCHAT_WEBHOOK, { kind: 'comment', ... }, {
//     appName: 'EIP',
//     events: process.env.FEEDBACK_GCHAT_EVENTS,   // optional, e.g. "comment,reply"
//   });
//
// Card design follows the Maco Reminder bot (Appscript/Maco Reminder, macoCard_): header =
// message type + HKT time + round Maco avatar; body = one bold line with a short emoji status
// underneath, then the detail. Never throws and gives up after a few seconds: a Chat outage
// must not fail the comment save. Messages are threaded per comment (threadKey = comment
// id), so replies and resolve/reopen land under the original comment in the space.

import type { FeedbackChatEventKind } from './types';

export type FeedbackChatKind = FeedbackChatEventKind;

export type FeedbackChatEvent = {
  kind: FeedbackChatKind;
  appId: string;
  commentId: string;
  actorName: string;
  actorEmail: string;
  // The comment (kind 'comment', 'resolved', 'reopened') or the reply (kind 'reply').
  text?: string;
  pageUrl?: string;
  pageTitle?: string;
};

export type FeedbackChatOptions = {
  // Shown in the status line instead of the raw appId (e.g. 'EIP').
  appName?: string;
  // Which events post. Array or comma-separated string; default = all four kinds.
  events?: FeedbackChatKind[] | string;
  // Header avatar; defaults to the Maco mark used by Maco Reminder.
  imageUrl?: string;
  // The app's origin (e.g. 'https://eip.mcai.dev'). Comments store a path ('/announcement'),
  // so without this the card has no View feedback button.
  baseUrl?: string;
};

export const ALL_CHAT_EVENTS: FeedbackChatKind[] = ['comment', 'reply', 'resolved', 'reopened'];

const MACO_LOGO = 'https://masterconcept.ai/wp-content/uploads/2026/05/maco-socialfeed.png';
const TIMEOUT_MS = 4000;

// Header line: "<emoji> <who> <verb>", so the card says who triggered it at a glance.
const VERB: Record<FeedbackChatKind, { emoji: string; verb: string }> = {
  comment: { emoji: '📝', verb: 'added feedback' },
  reply: { emoji: '💬', verb: 'replied' },
  resolved: { emoji: '✅', verb: 'resolved feedback' },
  reopened: { emoji: '🔄', verb: 'reopened feedback' },
};

// Chat card text accepts a small HTML subset, so escape everything the user typed.
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// "22 Oct, 19:32" in Hong Kong time (Maco Reminder's format without the year).
function hkTime(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Hong_Kong',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${parts.month}, ${parts.hour}:${parts.minute}`;
}

export function parseChatEvents(events: FeedbackChatOptions['events']): FeedbackChatKind[] {
  if (!events || (typeof events === 'string' && !events.trim())) return ALL_CHAT_EVENTS;
  const list = typeof events === 'string' ? events.split(',') : events;
  return list
    .map((e) => e.trim().toLowerCase())
    .filter((e): e is FeedbackChatKind => (ALL_CHAT_EVENTS as string[]).includes(e));
}

// Only accept the official incoming-webhook host, so a mistyped env var can't send
// comment text anywhere else.
export function isChatWebhook(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'chat.googleapis.com';
  } catch {
    return false;
  }
}

// Absolute link to the feedback: page URL (resolved against baseUrl) + `?fb=<id>`, which the
// widget reads to open it. null when no absolute http(s) URL can be formed.
export function commentLink(e: FeedbackChatEvent, baseUrl?: string): string | null {
  if (!e.pageUrl) return null;
  try {
    const u = new URL(e.pageUrl, baseUrl);
    // http(s) only. Production passes the public https review host; a local dev server gives
    // localhost links, which open on that developer's machine (fine for testing).
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.searchParams.set('fb', e.commentId);
    return u.toString();
  } catch {
    return null;
  }
}

export function buildChatMessage(
  e: FeedbackChatEvent,
  opts: FeedbackChatOptions = {},
  now: Date = new Date(),
) {
  const { emoji, verb } = VERB[e.kind];
  const actor = e.actorName || e.actorEmail;
  const title = `${emoji} ${actor} ${verb}`;
  // Subtitle carries the context in one line: app · page · time.
  const subtitle = [opts.appName || e.appId, e.pageTitle || e.pageUrl, hkTime(now)]
    .filter(Boolean)
    .join(' · ');

  // Body = the text: the feedback itself (new / resolved / reopened) or the reply. One
  // "View feedback" button that opens it on its page.
  const widgets: Record<string, unknown>[] = [];
  if (e.text) {
    widgets.push({ textParagraph: { text: esc(clip(e.text, 500)) } });
  }
  const link = commentLink(e, opts.baseUrl);
  if (link) {
    widgets.push({
      buttonList: { buttons: [{ text: 'View feedback', onClick: { openLink: { url: link } } }] },
    });
  }

  return {
    thread: { threadKey: `mc-feedback-${e.appId}-${e.commentId}` },
    cardsV2: [
      {
        cardId: `mc-feedback-${e.kind}`,
        card: {
          header: {
            title,
            subtitle,
            imageUrl: opts.imageUrl || MACO_LOGO,
            imageType: 'CIRCLE',
          },
          ...(widgets.length ? { sections: [{ widgets }] } : {}),
        },
      },
    ],
  };
}

export async function notifyGoogleChat(
  webhookUrl: string | undefined | null,
  event: FeedbackChatEvent,
  opts: FeedbackChatOptions = {},
): Promise<boolean> {
  if (!webhookUrl) return false;
  if (!parseChatEvents(opts.events).includes(event.kind)) return false;
  if (!isChatWebhook(webhookUrl)) {
    console.warn('[mc-feedback] Google Chat webhook ignored: not a chat.googleapis.com URL');
    return false;
  }
  const url = new URL(webhookUrl);
  url.searchParams.set('messageReplyOption', 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(buildChatMessage(event, opts)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[mc-feedback] Google Chat push failed: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[mc-feedback] Google Chat push failed:', (err as Error).message);
    return false;
  }
}

// Settings "Test" button: one card, outside any feedback thread, that says who tested it.
export async function sendTestChat(
  webhookUrl: string,
  actorName: string,
  opts: FeedbackChatOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!isChatWebhook(webhookUrl)) {
    return { ok: false, error: 'Not a Google Chat webhook URL (https://chat.googleapis.com/…).' };
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        cardsV2: [
          {
            cardId: 'mc-feedback-test',
            card: {
              header: {
                title: `✅ ${actorName} tested the feedback webhook`,
                subtitle: [opts.appName, hkTime(new Date())].filter(Boolean).join(' · '),
                imageUrl: opts.imageUrl || MACO_LOGO,
                imageType: 'CIRCLE',
              },
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Google Chat said HTTP ${res.status}.` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
