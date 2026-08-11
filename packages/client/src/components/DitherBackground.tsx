import { useEffect, useRef } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { prefersReducedMotion } from '@/lib/pixel-canvas';

/**
 * Animated dithering background using a small canvas that renders
 * an ordered Bayer dither pattern with slowly drifting color gradients.
 * The result is a subtle, retro CRT-style grain that breathes over time.
 * Active in both themes.
 */
export function DitherBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const context = ctx;
    const reduced = prefersReducedMotion();

    // Small internal resolution — the CSS stretches it pixelated. 128 on the
    // short axis, long axis scaled by the viewport aspect so the grain stays
    // square instead of streaking on tall phones / wide desktops.
    let W = 128;
    let H = 128;

    function applySize() {
      const SHORT = 128;
      const vw = Math.max(1, window.innerWidth);
      const vh = Math.max(1, window.innerHeight);
      if (vw >= vh) {
        H = SHORT;
        W = Math.max(1, Math.round((SHORT * vw) / vh));
      } else {
        W = SHORT;
        H = Math.max(1, Math.round((SHORT * vh) / vw));
      }
      canvas!.width = W;
      canvas!.height = H;
    }

    // 4×4 Bayer dither matrix
    const bayer = [
      [0,  8,  2, 10],
      [12, 4, 14,  6],
      [3, 11,  1,  9],
      [15, 7, 13,  5],
    ];

    let raf = 0;
    let resizeTimer: ReturnType<typeof setTimeout>;
    let t = 0;

    function draw() {
      const dark = theme === 'dark';

      // Slowly drifting hue offsets for the gradient
      const hueShift = Math.sin(t * 0.7) * 30;
      const hueShift2 = Math.cos(t * 0.5) * 40;

      const imgData = context.createImageData(W, H);
      const data = imgData.data;

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4;

          // Diagonal gradient blends two neon hues
          const nx = x / W;
          const ny = y / H;
          const diag = (nx + ny) / 2;

          // Base hue blends between two accent colors
          const hue1 = dark ? 270 + hueShift : 260 + hueShift;   // purple-blue
          const hue2 = dark ? 330 + hueShift2 : 340 + hueShift2; // pink
          const hue = hue1 + (hue2 - hue1) * diag;

          const sat = dark ? 60 : 40;
          const lightBase = dark ? 12 : 78;
          // Subtle wave across the tile
          const wave = Math.sin(nx * 6.28 + t * 2) * Math.cos(ny * 6.28 - t * 1.3);
          const light = lightBase + wave * (dark ? 4 : 3);

          // Convert HSL to RGB
          const [r, g, b] = hslToRgb(hue, sat, light);

          // Bayer threshold
          const threshold = bayer[y % 4][x % 4] / 16;

          // Quantise: snap to fewer levels for that dithered look
          const levels = dark ? 5 : 4;
          const q = (v: number) => {
            const step = 255 / levels;
            const snapped = Math.round(v / step) * step;
            // Apply dither threshold to push value up or down
            const ditherAmount = step * 0.6;
            return snapped + (threshold - 0.5) * ditherAmount;
          };

          data[idx]     = clamp(q(r));
          data[idx + 1] = clamp(q(g));
          data[idx + 2] = clamp(q(b));
          data[idx + 3] = dark ? 26 : 14; // faint grain over the scene
        }
      }

      context.putImageData(imgData, 0, 0);
    }

    // The drift is glacial — ~10fps is indistinguishable from 60 here, so
    // skip five of every six rAF ticks to save phone CPU/battery.
    let tick = 0;
    function loop() {
      raf = requestAnimationFrame(loop);
      if (++tick % 6 !== 0) return;
      t += 0.018; // 6× the old per-frame step keeps the drift speed
      draw();
    }

    applySize();
    if (reduced) {
      draw();
    } else {
      raf = requestAnimationFrame(loop);
    }

    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        applySize();
        draw();
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
      className="pointer-events-none fixed inset-0 z-[2] h-full w-full"
      style={{
        imageRendering: 'pixelated',
        mixBlendMode: 'screen',
      }}
    />
  );
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** HSL → RGB, all inputs: h [0,360], s [0,100], l [0,100] → [r,g,b] [0,255] */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}
