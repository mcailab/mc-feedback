// Public entry for @mcailab/mc-feedback. One import, everything a host project needs:
//
//   import { FeedbackWidget } from '@mcailab/mc-feedback';
//   import type { FeedbackActions, FeedbackFirestore } from '@mcailab/mc-feedback';
//
// Capture helpers are available via '@mcailab/mc-feedback/capture' for host projects that
// want to opportunistically re-anchor older pins to current-page elements (phase E in the
// roadmap).

export { FeedbackWidget } from './widget';
export type {
  FeedbackActions,
  FeedbackComment,
  FeedbackElement,
  FeedbackFirestore,
  FeedbackReply,
} from './types';
export { buildStableSelector, captureElement, resolveElementPosition } from './capture';
