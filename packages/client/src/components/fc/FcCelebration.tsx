// FcCelebration.tsx — a brief green "Completed!" glow + confetti burst, rendered
// over a card the moment its task finishes. Pure markup + CSS (workshop-cards.css);
// no libraries. Mounted transiently by TaskCard and auto-removed after the animation.

import type { CSSProperties } from 'react';
import './workshop-cards.css';

const PIECES = Array.from({ length: 16 }, (_, i) => i);

export function FcCelebration() {
  return (
    <div className="fc-celebrate" aria-hidden="true">
      <div className="fc-confetti">
        {PIECES.map((i) => (
          <i key={i} style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
      <span className="fc-celebrate-box">★ done!!</span>
    </div>
  );
}
