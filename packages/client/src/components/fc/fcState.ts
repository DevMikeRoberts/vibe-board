// fcState.ts — the 8 agent card states and their display metadata.
//
// Pure definitions. Mapping an AI Agent Board task to one of these states lives in
// taskToFcState.ts; the visuals live in workshop-cards.css.

export type FcState =
  | 'idle'
  | 'groom'
  | 'needs'
  | 'ready'
  | 'build'
  | 'review'
  | 'fail'
  | 'done';

export interface FcStateMeta {
  emoji: string;
  label: string;
  /** corner glyph overlay, '' for none */
  corner: string;
  /** show the animated progress bar */
  working: boolean;
}

export const FC_STATE_META: Record<FcState, FcStateMeta> = {
  idle:   { emoji: '💤', label: 'Backlog',           corner: '',   working: false },
  groom:  { emoji: '✏️', label: 'Grooming',          corner: '',   working: true  },
  needs:  { emoji: '🙋', label: 'Needs you',         corner: '?',  working: false },
  ready:  { emoji: '📦', label: 'Ready',             corner: '',   working: false },
  build:  { emoji: '🔨', label: 'Building',          corner: '',   working: true  },
  review: { emoji: '🔍', label: 'In review',         corner: '',   working: false },
  fail:   { emoji: '💥', label: 'Couldn’t complete', corner: '!',  working: false },
  done:   { emoji: '🎉', label: 'Done',              corner: '🎉', working: false },
};
