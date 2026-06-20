// FcStateBadge.tsx — the dot + label + corner chrome for a card's agent state.
//
// Render <FcStateBadge state={fcState} /> inside a task card, and add the `fc-card`
// class + `data-fc-state` to the card root so the card-level cues (state tint, the
// "needs you" nudge, the failed shake) attach. Pure markup + CSS, no extra deps.

import { FC_STATE_META, type FcState } from './fcState';
import './workshop-cards.css';

interface Props {
  /** The card's agent state (from taskToFcState). */
  state: FcState;
  /** Hide the text label, show only the dot (for dense boards). */
  compact?: boolean;
}

export function FcStateBadge({ state, compact = false }: Props) {
  const meta = FC_STATE_META[state];

  return (
    <span className="fc-chrome" data-fc-state={state}>
      <span className="fc-badge" title={meta.label}>
        <span className="fc-dot" aria-hidden="true" />
        {!compact && (
          <span className="fc-badge-text">
            {meta.emoji} {meta.label}
          </span>
        )}
      </span>
      {meta.corner && (
        <span className="fc-corner" aria-hidden="true">
          {meta.corner}
        </span>
      )}
    </span>
  );
}
