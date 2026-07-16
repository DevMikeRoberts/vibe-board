import { useEffect, useRef } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { lerpRgb, prefersReducedMotion, sizePixelCanvas } from '@/lib/pixel-canvas';

type RGB = [number, number, number];

interface Petal {
  x: number;
  y: number;
  size: number; // 1 (far) .. 3 (near)
  speed: number;
  drift: number;
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
  spin: number;
  color: RGB;
  core: RGB;
}

const PIXEL = 4;

// A soft sakura-pink palette (edge → lighter core pairs).
const PALETTE: Array<{ edge: RGB; core: RGB }> = [
  { edge: [255, 150, 200], core: [255, 205, 230] },
  { edge: [255, 128, 185], core: [255, 190, 222] },
  { edge: [250, 175, 215], core: [255, 224, 240] },
  { edge: [255, 200, 224], core: [255, 245, 250] },
];

/**
 * 8-bit sakura blossoms drifting across the light theme.
 *
 * Petals fall in three depth layers (far/slow/faint → near/fast/bold) with a
 * gentle sine sway, each drawn as a small pixel blossom with a lighter core.
 */
export function SakuraLeaves() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (theme !== 'light') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = prefersReducedMotion();
    let raf = 0;
    let resizeTimer: ReturnType<typeof setTimeout>;
    let W = 0;
    let H = 0;
    let petals: Petal[] = [];

    function makePetal(randomY: boolean): Petal {
      const size = 1 + Math.floor(Math.random() * 3); // 1..3
      const depth = size / 3; // near petals fall faster / bolder
      const pair = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      return {
        x: Math.random() * W,
        y: randomY ? Math.random() * H : -3,
        size,
        speed: 0.15 + depth * 0.5 + Math.random() * 0.2,
        drift: (Math.random() - 0.5) * 0.15,
        swayAmp: 0.4 + depth * 0.8 + Math.random() * 0.4,
        swayFreq: 0.01 + Math.random() * 0.03,
        swayPhase: Math.random() * Math.PI * 2,
        spin: Math.random() * Math.PI * 2,
        color: pair.edge,
        core: pair.core,
      };
    }

    function rebuild() {
      const size = sizePixelCanvas(canvas!, PIXEL);
      W = size.w;
      H = size.h;
      const count = Math.max(24, Math.floor((W * H) / 1400));
      petals = [];
      for (let i = 0; i < count; i++) petals.push(makePetal(true));
    }

    /** Draw a small blossom petal; `tilt` in [0,1) rotates its orientation. */
    function drawPetal(p: Petal, tilt: number) {
      const cx = Math.round(p.x);
      const cy = Math.round(p.y);
      const a = 0.45 + (p.size / 3) * 0.4;
      const wide = tilt < 0.5; // alternate between wide and tall orientation
      const rx = wide ? p.size : Math.max(1, p.size - 1);
      const ry = wide ? Math.max(1, p.size - 1) : p.size;

      ctx!.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${a})`;
      for (let y = -ry; y <= ry; y++) {
        for (let x = -rx; x <= rx; x++) {
          if ((x * x) / (rx * rx + 0.4) + (y * y) / (ry * ry + 0.4) > 1) continue;
          // notch at the tip to hint a petal shape
          if (y === -ry && x === 0 && p.size > 1) continue;
          ctx!.fillRect(cx + x, cy + y, 1, 1);
        }
      }
      // lighter core
      if (p.size >= 2) {
        const cc = lerpRgb(p.core, [255, 255, 255], 0.1);
        ctx!.fillStyle = `rgba(${cc[0]},${cc[1]},${cc[2]},${Math.min(1, a + 0.2)})`;
        ctx!.fillRect(cx, cy, 1, 1);
      }
    }

    let t = 0;
    function frame() {
      t += 1;
      ctx!.clearRect(0, 0, W, H);
      for (const p of petals) {
        p.y += p.speed;
        p.x += p.drift + Math.sin(t * p.swayFreq + p.swayPhase) * p.swayAmp * 0.15;
        p.spin += 0.02;
        if (p.y > H + 4) Object.assign(p, makePetal(false));
        if (p.x < -4) p.x = W + 3;
        else if (p.x > W + 4) p.x = -3;
        drawPetal(p, (Math.sin(p.spin) + 1) / 2);
      }
      raf = requestAnimationFrame(frame);
    }

    rebuild();
    if (reduced) {
      for (const p of petals) drawPetal(p, (Math.sin(p.spin) + 1) / 2);
    } else {
      raf = requestAnimationFrame(frame);
    }

    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        rebuild();
        if (reduced) for (const p of petals) drawPetal(p, (Math.sin(p.spin) + 1) / 2);
      }, 150);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1] h-full w-full"
      style={{
        imageRendering: 'pixelated',
        opacity: theme === 'light' ? 0.7 : 0,
        transition: 'opacity 700ms ease',
      }}
    />
  );
}
