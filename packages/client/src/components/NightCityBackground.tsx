import { useEffect, useRef } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { bayer, lerpRgb, prefersReducedMotion, sizePixelCanvas } from '@/lib/pixel-canvas';

type RGB = [number, number, number];

interface Star {
  x: number;
  y: number;
  base: number;
  phase: number;
  speed: number;
}

interface Window {
  x: number;
  y: number;
  w: number;
  h: number;
  color: RGB;
  lit: boolean;
  phase: number;
  flicker: number; // 0 = steady, >0 = twinkles
}

interface Sign {
  x: number;
  y: number;
  w: number;
  h: number;
  color: RGB;
  phase: number;
}

interface Streak {
  x: number;
  y: number;
  len: number;
  speed: number;
  color: RGB;
}

const PIXEL = 5;

/**
 * 8-bit dithered night-city skyline for the dark theme.
 *
 * The sky gradient, moon and building silhouettes are dithered once into an
 * offscreen buffer; each frame blits that buffer and animates twinkling stars,
 * lit windows, flickering neon signs and passing street-light streaks on top.
 */
export function NightCityBackground() {
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
    let stars: Star[] = [];
    let windows: Window[] = [];
    let signs: Sign[] = [];
    let streaks: Streak[] = [];
    let streetY = 0;

    // Offscreen buffer for the static parts of the scene.
    const bg = document.createElement('canvas');
    const bgCtx = bg.getContext('2d')!;

    const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

    /** Dither one channel to `levels` bands using the Bayer threshold at (x,y). */
    function ditherCh(v: number, x: number, y: number, levels: number): number {
      const step = 255 / (levels - 1);
      const d = (bayer(x, y) - 0.5) * step;
      return clamp(Math.round((v + d) / step) * step);
    }

    function buildScene() {
      const size = sizePixelCanvas(canvas!, PIXEL);
      W = size.w;
      H = size.h;
      bg.width = W;
      bg.height = H;
      streetY = Math.floor(H * 0.9);

      // ── Dithered sky gradient (indigo → plum → magenta horizon) ──
      const top: RGB = [14, 12, 34];
      const midSky: RGB = [40, 18, 58];
      const horizon: RGB = [96, 32, 78];
      const skyImg = bgCtx.createImageData(W, H);
      const d = skyImg.data;
      const horizonY = H * 0.72;
      for (let y = 0; y < H; y++) {
        const t = Math.min(1, y / horizonY);
        const c = t < 0.6 ? lerpRgb(top, midSky, t / 0.6) : lerpRgb(midSky, horizon, (t - 0.6) / 0.4);
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          d[i] = ditherCh(c[0], x, y, 6);
          d[i + 1] = ditherCh(c[1], x, y, 6);
          d[i + 2] = ditherCh(c[2], x, y, 6);
          d[i + 3] = 255;
        }
      }
      bgCtx.putImageData(skyImg, 0, 0);

      // ── Moon with a soft dithered halo and a couple of craters ──
      const moonX = Math.floor(W * 0.8);
      const moonY = Math.floor(H * 0.2);
      const moonR = Math.max(6, Math.floor(H * 0.075));
      for (let y = -moonR * 2; y <= moonR * 2; y++) {
        for (let x = -moonR * 2; x <= moonR * 2; x++) {
          const dist = Math.hypot(x, y);
          const px = moonX + x;
          const py = moonY + y;
          if (px < 0 || px >= W || py < 0 || py >= H) continue;
          if (dist <= moonR) {
            const shade = 236 - (x + moonR) * 0.6; // subtle left-light
            bgCtx.fillStyle = `rgb(${clamp(shade)},${clamp(shade - 4)},${clamp(shade + 14)})`;
            bgCtx.fillRect(px, py, 1, 1);
          } else if (dist <= moonR * 1.8) {
            // dithered glow ring
            const glow = 1 - (dist - moonR) / (moonR * 0.8);
            if (glow > bayer(px, py)) {
              bgCtx.fillStyle = 'rgba(180,150,220,0.5)';
              bgCtx.fillRect(px, py, 1, 1);
            }
          }
        }
      }
      // craters
      bgCtx.fillStyle = 'rgba(150,150,190,0.5)';
      bgCtx.fillRect(moonX - 3, moonY - 2, 2, 2);
      bgCtx.fillRect(moonX + 2, moonY + 3, 3, 2);
      bgCtx.fillRect(moonX - 1, moonY + 4, 2, 1);

      // ── Stars (dynamic twinkle) ──
      stars = [];
      const starCount = Math.floor((W * H) / 900);
      for (let i = 0; i < starCount; i++) {
        const y = Math.random() * H * 0.6;
        stars.push({
          x: Math.floor(Math.random() * W),
          y: Math.floor(y),
          base: 0.35 + Math.random() * 0.5,
          phase: Math.random() * Math.PI * 2,
          speed: 0.02 + Math.random() * 0.06,
        });
      }

      // ── Parallax skyline: far → mid → near ──
      windows = [];
      signs = [];
      const winWarm: RGB = [255, 210, 120];
      const winCyan: RGB = [130, 230, 255];
      const winPink: RGB = [255, 150, 205];
      const layers = [
        { body: [30, 26, 60] as RGB, base: 0.5, jitter: 0.14, minW: 0.05, maxW: 0.1, winDensity: 0.35, winCol: [winCyan] },
        { body: [18, 15, 42] as RGB, base: 0.62, jitter: 0.18, minW: 0.055, maxW: 0.11, winDensity: 0.5, winCol: [winWarm, winCyan] },
        { body: [7, 6, 16] as RGB, base: 0.78, jitter: 0.24, minW: 0.06, maxW: 0.13, winDensity: 0.6, winCol: [winWarm, winWarm, winCyan, winPink] },
      ];

      layers.forEach((layer, li) => {
        let x = -Math.random() * 20;
        while (x < W) {
          const bw = Math.floor(W * (layer.minW + Math.random() * (layer.maxW - layer.minW)));
          const bh = Math.floor(H * (layer.base - Math.random() * layer.jitter));
          const bx = Math.floor(x);
          const by = H - bh;
          // building body (with a faint vertical shade for depth)
          for (let yy = by; yy < H; yy++) {
            const shade = 1 - (yy - by) / bh * 0.25;
            bgCtx.fillStyle = `rgb(${Math.round(layer.body[0] * shade)},${Math.round(layer.body[1] * shade)},${Math.round(layer.body[2] * shade)})`;
            bgCtx.fillRect(bx, yy, bw, 1);
          }
          // rooftop antenna on some near/mid buildings
          if (li >= 1 && Math.random() < 0.35) {
            const ax = bx + Math.floor(bw / 2);
            const ah = 2 + Math.floor(Math.random() * 4);
            bgCtx.fillStyle = 'rgb(4,4,10)';
            bgCtx.fillRect(ax, by - ah, 1, ah);
            // blinking beacon → a "sign" with tiny size
            signs.push({ x: ax, y: by - ah - 1, w: 1, h: 1, color: [255, 70, 90], phase: Math.random() * Math.PI * 2 });
          }
          // windows grid
          const cols = Math.max(1, Math.floor(bw / 3));
          const rows = Math.max(1, Math.floor(bh / 4));
          for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
              if (Math.random() > layer.winDensity) continue;
              const wx = bx + 1 + c * 3;
              const wy = by + 2 + r * 4;
              if (wx >= bx + bw - 1 || wy >= H - 2) continue;
              const color = layer.winCol[Math.floor(Math.random() * layer.winCol.length)];
              windows.push({
                x: wx,
                y: wy,
                w: 1,
                h: li === 2 ? 2 : 1,
                color,
                lit: Math.random() < 0.8,
                phase: Math.random() * Math.PI * 2,
                flicker: Math.random() < 0.25 ? 0.4 + Math.random() * 0.6 : 0,
              });
            }
          }
          // occasional neon sign band on tall near buildings
          if (li === 2 && bh > H * 0.45 && Math.random() < 0.4) {
            const neon: RGB[] = [
              [255, 110, 199],
              [127, 233, 255],
              [61, 242, 133],
              [176, 139, 255],
            ];
            signs.push({
              x: bx + 2,
              y: by + Math.floor(bh * 0.25),
              w: Math.max(2, bw - 4),
              h: 1,
              color: neon[Math.floor(Math.random() * neon.length)],
              phase: Math.random() * Math.PI * 2,
            });
          }
          x += bw + Math.floor(Math.random() * 4) - 1;
        }
      });

      // ── Street band with a faint neon reflection ──
      for (let yy = streetY; yy < H; yy++) {
        const t = (yy - streetY) / Math.max(1, H - streetY);
        const c = lerpRgb([10, 8, 20], [24, 10, 30], t);
        for (let x = 0; x < W; x++) {
          bgCtx.fillStyle = `rgb(${ditherCh(c[0], x, yy, 4)},${ditherCh(c[1], x, yy, 4)},${ditherCh(c[2], x, yy, 4)})`;
          bgCtx.fillRect(x, yy, 1, 1);
        }
      }

      // ── Moving street-light streaks along the road ──
      streaks = [];
      const streakCount = Math.max(2, Math.floor(W / 90));
      for (let i = 0; i < streakCount; i++) {
        streaks.push(makeStreak(true));
      }
    }

    function makeStreak(randomX: boolean): Streak {
      const toRight = Math.random() < 0.5;
      const len = 3 + Math.floor(Math.random() * 5);
      const palette: RGB[] = [
        [255, 230, 160],
        [255, 120, 120],
        [150, 230, 255],
      ];
      return {
        x: randomX ? Math.random() * W : toRight ? -len : W + len,
        y: streetY + 1 + Math.floor(Math.random() * Math.max(1, H - streetY - 2)),
        len,
        speed: (toRight ? 1 : -1) * (0.4 + Math.random() * 0.9),
        color: palette[Math.floor(Math.random() * palette.length)],
      };
    }

    let t = 0;
    function frame() {
      t += 1;
      ctx!.drawImage(bg, 0, 0);

      // stars
      for (const s of stars) {
        const tw = s.base + Math.sin(t * s.speed + s.phase) * 0.35;
        if (tw <= 0.05) continue;
        ctx!.fillStyle = `rgba(235,240,255,${Math.min(1, tw)})`;
        ctx!.fillRect(s.x, s.y, 1, 1);
      }

      // windows
      for (const w of windows) {
        if (!w.lit) continue;
        let a = 0.85;
        if (w.flicker > 0) a = 0.55 + Math.sin(t * 0.08 + w.phase) * 0.35 * w.flicker;
        ctx!.fillStyle = `rgba(${w.color[0]},${w.color[1]},${w.color[2]},${Math.max(0.15, a)})`;
        ctx!.fillRect(w.x, w.y, w.w, w.h);
      }

      // neon signs / beacons (flicker + soft glow underline)
      for (const s of signs) {
        const pulse = 0.55 + Math.sin(t * 0.12 + s.phase) * 0.45;
        ctx!.fillStyle = `rgba(${s.color[0]},${s.color[1]},${s.color[2]},${pulse})`;
        ctx!.fillRect(s.x, s.y, s.w, s.h);
        if (s.w > 1) {
          ctx!.fillStyle = `rgba(${s.color[0]},${s.color[1]},${s.color[2]},${pulse * 0.25})`;
          ctx!.fillRect(s.x, s.y + 1, s.w, 1);
        }
      }

      // street-light streaks
      for (const st of streaks) {
        st.x += st.speed;
        if (st.speed > 0 ? st.x - st.len > W : st.x + st.len < 0) {
          Object.assign(st, makeStreak(false));
        }
        const x0 = Math.round(st.x);
        for (let k = 0; k < st.len; k++) {
          const a = (1 - k / st.len) * 0.7;
          ctx!.fillStyle = `rgba(${st.color[0]},${st.color[1]},${st.color[2]},${a})`;
          ctx!.fillRect(x0 - (st.speed > 0 ? k : -k), st.y, 1, 1);
        }
      }

      raf = requestAnimationFrame(frame);
    }

    buildScene();
    if (reduced) {
      ctx.drawImage(bg, 0, 0);
      // one static pass so lit windows / signs still show
      for (const w of windows) {
        if (!w.lit) continue;
        ctx.fillStyle = `rgba(${w.color[0]},${w.color[1]},${w.color[2]},0.85)`;
        ctx.fillRect(w.x, w.y, w.w, w.h);
      }
      for (const s of signs) {
        ctx.fillStyle = `rgb(${s.color[0]},${s.color[1]},${s.color[2]})`;
        ctx.fillRect(s.x, s.y, s.w, s.h);
      }
    } else {
      raf = requestAnimationFrame(frame);
    }

    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        buildScene();
        if (reduced) ctx.drawImage(bg, 0, 0);
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
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
