import { useEffect, useRef } from 'react';
import { useTheme } from '@/hooks/useTheme';

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  opacity: number;
}

/**
 * 8-bit pixelated rain falling across the entire viewport.
 * Rendered on a fullscreen canvas with image-rendering: pixelated.
 * Only active in the dark theme.
 */
export function RainAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (theme !== 'dark') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 200;
    const H = 200;
    canvas.width = W;
    canvas.height = H;

    const DROP_COUNT = 60;
    const drops: Drop[] = [];

    for (let i = 0; i < DROP_COUNT; i++) {
      drops.push(makeDrop(W, H, true));
    }

    let raf: number;

    function draw() {
      ctx!.clearRect(0, 0, W, H);

      for (const d of drops) {
        d.y += d.speed;

        if (d.y > H + d.len) {
          Object.assign(d, makeDrop(W, H, false));
        }

        const px = Math.round(d.x);
        const py = Math.round(d.y);
        const s = 1;

        // 8-bit vertical rain streak
        ctx!.fillStyle = `rgba(170, 200, 255, ${d.opacity})`;
        ctx!.fillRect(px, py, s, d.len);

        // Bright pixel head
        ctx!.fillStyle = `rgba(220, 235, 255, ${Math.min(1, d.opacity + 0.2)})`;
        ctx!.fillRect(px, py, s, s);
      }

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1] h-full w-full"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

function makeDrop(maxX: number, maxY: number, randomY: boolean): Drop {
  return {
    x: Math.floor(Math.random() * maxX),
    y: randomY ? Math.random() * maxY : -10,
    len: 3 + Math.floor(Math.random() * 4),
    speed: 1.5 + Math.random() * 2.5,
    opacity: 0.25 + Math.random() * 0.4,
  };
}
