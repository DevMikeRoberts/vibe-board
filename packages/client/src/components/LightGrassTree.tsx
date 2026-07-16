import { useEffect, useRef } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { bayer, lerpRgb, prefersReducedMotion, sizePixelCanvas } from '@/lib/pixel-canvas';

type RGB = [number, number, number];

interface Cloud {
  x: number;
  y: number;
  scale: number;
  speed: number;
}

interface Blade {
  x: number;
  h: number;
  phase: number;
  color: RGB;
}

interface Butterfly {
  x: number;
  y: number;
  t: number;
  vx: number;
  color: RGB;
}

const PIXEL = 5;

/**
 * 8-bit dithered grassy meadow for the light theme.
 *
 * A warm dithered sky, sun, rolling hills, distant trees and wildflowers are
 * baked once into an offscreen buffer; each frame blits that buffer and
 * animates drifting clouds, swaying foreground grass and a wandering butterfly.
 */
export function LightGrassTree() {
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
    let clouds: Cloud[] = [];
    let blades: Blade[] = [];
    let butterflies: Butterfly[] = [];

    const bg = document.createElement('canvas');
    const bgCtx = bg.getContext('2d')!;
    const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

    function ditherCh(v: number, x: number, y: number, levels: number): number {
      const step = 255 / (levels - 1);
      const d = (bayer(x, y) - 0.5) * step;
      return clamp(Math.round((v + d) / step) * step);
    }

    /** Fill a column span with a vertical dithered gradient between two colors. */
    function ditherColumn(x: number, y0: number, y1: number, top: RGB, bot: RGB) {
      const span = Math.max(1, y1 - y0);
      for (let y = y0; y < y1; y++) {
        const c = lerpRgb(top, bot, (y - y0) / span);
        bgCtx.fillStyle = `rgb(${ditherCh(c[0], x, y, 5)},${ditherCh(c[1], x, y, 5)},${ditherCh(c[2], x, y, 5)})`;
        bgCtx.fillRect(x, y, 1, 1);
      }
    }

    function tree(x: number, groundY: number, scale: number, leaf: RGB) {
      const th = Math.floor(6 * scale);
      const tw = Math.max(1, Math.floor(1.5 * scale));
      bgCtx.fillStyle = 'rgb(120,86,54)';
      bgCtx.fillRect(x, groundY - th, tw, th);
      const cr = Math.floor(4 * scale);
      for (let dy = -cr; dy <= cr; dy++) {
        for (let dx = -cr; dx <= cr; dx++) {
          if (dx * dx + dy * dy > cr * cr) continue;
          const px = x + dx;
          const py = groundY - th - cr + dy;
          if (px < 0 || px >= W || py < 0) continue;
          const shade = 1 - (dy + cr) / (cr * 2) * 0.3;
          bgCtx.fillStyle = `rgb(${Math.round(leaf[0] * shade)},${Math.round(leaf[1] * shade)},${Math.round(leaf[2] * shade)})`;
          bgCtx.fillRect(px, py, 1, 1);
        }
      }
    }

    function buildScene() {
      const size = sizePixelCanvas(canvas!, PIXEL);
      W = size.w;
      H = size.h;
      bg.width = W;
      bg.height = H;

      // ── Dithered sky (soft blue → warm cream horizon) ──
      const skyTop: RGB = [150, 206, 227];
      const skyMid: RGB = [196, 226, 220];
      const skyHorizon: RGB = [226, 232, 196];
      const img = bgCtx.createImageData(W, H);
      const d = img.data;
      const horizonY = H * 0.62;
      for (let y = 0; y < H; y++) {
        const t = Math.min(1, y / horizonY);
        const c = t < 0.6 ? lerpRgb(skyTop, skyMid, t / 0.6) : lerpRgb(skyMid, skyHorizon, (t - 0.6) / 0.4);
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          d[i] = ditherCh(c[0], x, y, 6);
          d[i + 1] = ditherCh(c[1], x, y, 6);
          d[i + 2] = ditherCh(c[2], x, y, 6);
          d[i + 3] = 255;
        }
      }
      bgCtx.putImageData(img, 0, 0);

      // ── Sun with dithered glow ──
      const sunX = Math.floor(W * 0.2);
      const sunY = Math.floor(H * 0.2);
      const sunR = Math.max(5, Math.floor(H * 0.07));
      for (let y = -sunR * 3; y <= sunR * 3; y++) {
        for (let x = -sunR * 3; x <= sunR * 3; x++) {
          const dist = Math.hypot(x, y);
          const px = sunX + x;
          const py = sunY + y;
          if (px < 0 || px >= W || py < 0 || py >= H) continue;
          if (dist <= sunR) {
            bgCtx.fillStyle = 'rgb(255,240,150)';
            bgCtx.fillRect(px, py, 1, 1);
          } else if (dist <= sunR * 2.6) {
            const glow = 1 - (dist - sunR) / (sunR * 1.6);
            if (glow > bayer(px, py)) {
              bgCtx.fillStyle = 'rgba(255,236,160,0.55)';
              bgCtx.fillRect(px, py, 1, 1);
            }
          }
        }
      }

      // ── Rolling hills (far → near), each a dithered vertical gradient ──
      const hillDefs = [
        { crest: 0.56, amp: 0.05, freq: 1.3, phase: 0.4, top: [168, 206, 150] as RGB, bot: [140, 190, 128] as RGB },
        { crest: 0.68, amp: 0.06, freq: 1.8, phase: 2.1, top: [128, 194, 104] as RGB, bot: [96, 168, 84] as RGB },
        { crest: 0.8, amp: 0.05, freq: 2.4, phase: 4.2, top: [96, 178, 74] as RGB, bot: [64, 146, 56] as RGB },
      ];
      for (const hd of hillDefs) {
        for (let x = 0; x < W; x++) {
          const nx = x / W;
          const crestY = Math.floor(
            H * hd.crest - Math.sin(nx * Math.PI * hd.freq + hd.phase) * H * hd.amp,
          );
          ditherColumn(x, crestY, H, hd.top, hd.bot);
        }
      }

      // distant trees on the mid hill
      const treeCount = Math.max(2, Math.floor(W / 90));
      for (let i = 0; i < treeCount; i++) {
        const tx = Math.floor((i + 0.5) * (W / treeCount) + (Math.random() - 0.5) * 12);
        const gy = Math.floor(
          H * 0.68 - Math.sin((tx / W) * Math.PI * 1.8 + 2.1) * H * 0.06,
        );
        tree(tx, gy, 0.8 + Math.random() * 0.5, [72, 150, 66]);
      }

      // ── Foreground meadow band + wildflowers ──
      const grassTop: RGB = [78, 162, 58];
      const grassBot: RGB = [46, 120, 44];
      const meadowY = Math.floor(H * 0.82);
      for (let x = 0; x < W; x++) {
        ditherColumn(x, meadowY, H, grassTop, grassBot);
      }
      const flowerColors: RGB[] = [
        [232, 54, 143],
        [231, 201, 0],
        [138, 92, 240],
        [250, 250, 250],
      ];
      const flowerCount = Math.floor(W / 6);
      for (let i = 0; i < flowerCount; i++) {
        const fx = Math.floor(Math.random() * W);
        const fy = meadowY + 2 + Math.floor(Math.random() * (H - meadowY - 2));
        const col = flowerColors[Math.floor(Math.random() * flowerColors.length)];
        bgCtx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        bgCtx.fillRect(fx, fy, 1, 1);
        bgCtx.fillStyle = 'rgb(231,201,0)';
        if (Math.random() < 0.5) bgCtx.fillRect(fx, fy - 1, 1, 1);
      }

      // ── Dynamic layers ──
      clouds = [];
      const cloudCount = Math.max(3, Math.floor(W / 70));
      for (let i = 0; i < cloudCount; i++) {
        clouds.push({
          x: Math.random() * W,
          y: Math.floor(H * (0.08 + Math.random() * 0.28)),
          scale: 0.7 + Math.random() * 1.1,
          speed: 0.05 + Math.random() * 0.08,
        });
      }

      blades = [];
      const bladeCount = Math.floor(W / 2);
      for (let i = 0; i < bladeCount; i++) {
        const x = Math.floor(Math.random() * W);
        blades.push({
          x,
          h: 3 + Math.floor(Math.random() * 6),
          phase: Math.random() * Math.PI * 2,
          color: lerpRgb([54, 132, 46], [92, 176, 66], Math.random()),
        });
      }

      butterflies = [];
      const flyCount = Math.max(1, Math.floor(W / 200));
      const flyColors: RGB[] = [
        [232, 54, 143],
        [138, 92, 240],
        [231, 160, 0],
      ];
      for (let i = 0; i < flyCount; i++) {
        butterflies.push({
          x: Math.random() * W,
          y: H * (0.4 + Math.random() * 0.3),
          t: Math.random() * 100,
          vx: 0.25 + Math.random() * 0.25,
          color: flyColors[Math.floor(Math.random() * flyColors.length)],
        });
      }
    }

    function drawCloud(c: Cloud) {
      const puffs = [
        [0, 0, 3],
        [3, -1, 2.4],
        [-3, 0, 2.2],
        [1, 1, 2],
      ];
      for (const [ox, oy, r0] of puffs) {
        const r = Math.round(r0 * c.scale);
        for (let y = -r; y <= r; y++) {
          for (let x = -r; x <= r; x++) {
            if (x * x + y * y > r * r) continue;
            const px = Math.round(c.x + ox * c.scale + x);
            const py = Math.round(c.y + oy * c.scale + y);
            if (px < 0 || px >= W || py < 0) continue;
            // dithered soft underside
            const a = y > r * 0.3 ? 0.75 : 1;
            if (a >= 1 || bayer(px, py) < a) {
              ctx!.fillStyle = y > r * 0.4 ? 'rgb(214,224,224)' : 'rgb(250,252,250)';
              ctx!.fillRect(px, py, 1, 1);
            }
          }
        }
      }
    }

    let t = 0;
    function frame() {
      t += 1;
      ctx!.drawImage(bg, 0, 0);

      // clouds drift
      for (const c of clouds) {
        c.x += c.speed;
        if (c.x - 8 * c.scale > W) c.x = -8 * c.scale;
        drawCloud(c);
      }

      // swaying foreground grass
      for (const b of blades) {
        const sway = Math.sin(t * 0.04 + b.phase) * 1.6;
        ctx!.fillStyle = `rgb(${b.color[0]},${b.color[1]},${b.color[2]})`;
        for (let k = 0; k < b.h; k++) {
          const off = Math.round((k / b.h) * sway);
          ctx!.fillRect(b.x + off, H - 1 - k, 1, 1);
        }
      }

      // butterflies
      for (const f of butterflies) {
        f.x += f.vx;
        f.t += 0.15;
        if (f.x > W + 4) {
          f.x = -4;
          f.y = H * (0.4 + Math.random() * 0.3);
        }
        const y = Math.round(f.y + Math.sin(f.t) * 6);
        const flap = Math.floor(f.t * 2) % 2 === 0;
        ctx!.fillStyle = `rgb(${f.color[0]},${f.color[1]},${f.color[2]})`;
        const wx = Math.round(f.x);
        ctx!.fillRect(wx, y, 1, 1); // body
        if (flap) {
          ctx!.fillRect(wx - 1, y - 1, 1, 1);
          ctx!.fillRect(wx + 1, y - 1, 1, 1);
        } else {
          ctx!.fillRect(wx - 1, y, 1, 1);
          ctx!.fillRect(wx + 1, y, 1, 1);
        }
      }

      raf = requestAnimationFrame(frame);
    }

    buildScene();
    if (reduced) {
      ctx.drawImage(bg, 0, 0);
      for (const c of clouds) drawCloud(c);
    } else {
      raf = requestAnimationFrame(frame);
    }

    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        buildScene();
        if (reduced) {
          ctx.drawImage(bg, 0, 0);
          for (const c of clouds) drawCloud(c);
        }
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
