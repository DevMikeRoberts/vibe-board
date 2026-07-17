import { useEffect, useRef } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { prefersReducedMotion, sizePixelCanvas } from '@/lib/pixel-canvas';

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  opacity: number;
  depth: number; // 0 far .. 1 near
}

interface Splash {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

const PIXEL = 4;
const WIND = 0.28; // horizontal drift per vertical step

/**
 * 8-bit rain for the dark theme: wind-angled streaks in three depth layers,
 * pixel splashes where they land, and the occasional lightning flash.
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

    const reduced = prefersReducedMotion();
    let raf = 0;
    let resizeTimer: ReturnType<typeof setTimeout>;
    let W = 0;
    let H = 0;
    let drops: Drop[] = [];
    let splashes: Splash[] = [];
    let flash = 0; // 0..1 lightning intensity
    let bolt: Array<{ x: number; y: number }> = [];
    let nextBolt = 240 + Math.random() * 600;

    function makeDrop(randomY: boolean): Drop {
      const depth = Math.random();
      return {
        x: Math.random() * (W + H * WIND) - H * WIND,
        y: randomY ? Math.random() * H : -6,
        len: Math.round(3 + depth * 6),
        speed: 2 + depth * 4,
        opacity: 0.2 + depth * 0.5,
        depth,
      };
    }

    function rebuild() {
      const size = sizePixelCanvas(canvas!, PIXEL);
      W = size.w;
      H = size.h;
      const count = Math.max(40, Math.floor((W * H) / 900));
      drops = [];
      splashes = [];
      for (let i = 0; i < count; i++) drops.push(makeDrop(true));
    }

    function drawFrame(animated: boolean) {
      ctx!.clearRect(0, 0, W, H);

      // lightning flash veil
      if (flash > 0.01) {
        ctx!.fillStyle = `rgba(180,205,255,${flash * 0.12})`;
        ctx!.fillRect(0, 0, W, H);
      }

      for (const d of drops) {
        if (animated) {
          d.y += d.speed;
          d.x += WIND * d.speed;
          if (d.y > H) {
            // land → splash
            if (d.depth > 0.35 && splashes.length < 120) {
              const sx = d.x;
              for (let k = 0; k < 2; k++) {
                splashes.push({
                  x: sx,
                  y: H - 1,
                  vx: (Math.random() - 0.5) * 1.2,
                  vy: -0.6 - Math.random() * 0.8,
                  life: 1,
                });
              }
            }
            Object.assign(d, makeDrop(false));
          }
        }
        const px = Math.round(d.x);
        const py = Math.round(d.y);
        // angled streak
        ctx!.fillStyle = `rgba(170,200,255,${d.opacity})`;
        for (let k = 0; k < d.len; k++) {
          ctx!.fillRect(px - Math.round(k * WIND), py - k, 1, 1);
        }
        // bright head
        ctx!.fillStyle = `rgba(225,238,255,${Math.min(1, d.opacity + 0.3)})`;
        ctx!.fillRect(px, py, 1, 1);
      }

      // splashes
      if (animated) {
        splashes = splashes.filter((s) => {
          s.x += s.vx;
          s.y += s.vy;
          s.vy += 0.12; // gravity
          s.life -= 0.05;
          if (s.life <= 0 || s.y > H) return false;
          ctx!.fillStyle = `rgba(200,222,255,${s.life * 0.6})`;
          ctx!.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
          return true;
        });
      } else {
        for (const s of splashes) {
          ctx!.fillStyle = `rgba(200,222,255,${s.life * 0.6})`;
          ctx!.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
        }
      }

      // lightning bolt on top, fading out with the flash
      if (flash > 0.3 && bolt.length > 1) {
        ctx!.fillStyle = `rgba(230,240,255,${Math.min(1, flash)})`;
        for (let i = 1; i < bolt.length; i++) {
          const a = bolt[i - 1];
          const b = bolt[i];
          const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
          for (let s = 0; s <= steps; s++) {
            ctx!.fillRect(
              Math.round(a.x + ((b.x - a.x) * s) / steps),
              Math.round(a.y + ((b.y - a.y) * s) / steps),
              1,
              1,
            );
          }
        }
      }
    }

    let t = 0;
    function frame() {
      t += 1;
      // lightning scheduling
      if (t >= nextBolt) {
        flash = 1;
        nextBolt = t + 240 + Math.random() * 700;
        bolt = makeBolt();
      }
      if (flash > 0) flash = Math.max(0, flash - 0.05);
      drawFrame(true);
      raf = requestAnimationFrame(frame);
    }

    /** Build a jagged vertical bolt polyline from the top of the viewport. */
    function makeBolt(): Array<{ x: number; y: number }> {
      const pts: Array<{ x: number; y: number }> = [];
      let bx = W * (0.2 + Math.random() * 0.6);
      let by = 0;
      const segs = 6 + Math.floor(Math.random() * 5);
      pts.push({ x: bx, y: by });
      for (let i = 0; i < segs; i++) {
        by += H / segs;
        bx += (Math.random() - 0.5) * (W * 0.08);
        pts.push({ x: bx, y: by });
      }
      return pts;
    }

    rebuild();
    if (reduced) {
      drawFrame(false);
    } else {
      raf = requestAnimationFrame(frame);
    }

    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        rebuild();
        if (reduced) drawFrame(false);
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
        opacity: theme === 'dark' ? 0.7 : 0,
        transition: 'opacity 700ms ease',
      }}
    />
  );
}
