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
  /** pixel icon name (see PixelIcon) shown in the state badge */
  icon: string;
  label: string;
  /** corner glyph overlay, '' for none */
  corner: string;
  /** show the animated progress bar */
  working: boolean;
}

export const FC_STATE_META: Record<FcState, FcStateMeta> = {
  idle:   { emoji: '💤', icon: 'alarm-bell-sleep',     label: 'Backlog',           corner: '',   working: false },
  groom:  { emoji: '✏️', icon: 'quill-ink',            label: 'Grooming',          corner: '',   working: true  },
  needs:  { emoji: '🙋', icon: 'question-help-square', label: 'Needs you',         corner: '?',  working: false },
  ready:  { emoji: '📦', icon: 'reward-gift',          label: 'Ready',             corner: '',   working: false },
  build:  { emoji: '🔨', icon: 'hammer-1',             label: 'Building',          corner: '',   working: true  },
  review: { emoji: '🔍', icon: 'iris-scan-approved',   label: 'In review',         corner: '',   working: false },
  fail:   { emoji: '💥', icon: 'alert-triangle-1',     label: 'Couldn’t complete', corner: '!',  working: false },
  done:   { emoji: '🎉', icon: 'rating-star-1',        label: 'Done',              corner: '★', working: false },
};
