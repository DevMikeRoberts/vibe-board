import { useEffect, useRef } from 'react';

interface Petal {
  x: number;
  y: number;
  size: number;
  speed: number;
  wobbleAmp: number;
  wobbleFreq: number;
  wobblePhase: number;
  rotation: number;
  rotSpeed: number;
  opacity: number;
  hue: number;
}

/**
 * 8-bit pixelated sakura petals falling across the entire viewport.
 * Rendered on a fullscreen canvas with image-rendering: pixelated.
 */
export function SakuraLeaves() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 200;
    const H = 200;
    canvas.width = W;
    canvas.height = H;

    const isDark = () => document.documentElement.classList.contains('dark');
    const PETAL_COUNT = 24;
    const petals: Petal[] = [];

    for (let i = 0; i < PETAL_COUNT; i++) {
      petals.push(makePetal(W, H, true));
    }

    let raf: number;

    function draw() {
      ctx!.clearRect(0, 0, W, H);
      const dark = isDark();

      for (const p of petals) {
        p.y += p.speed;
        p.x += Math.sin(p.wobblePhase) * p.wobbleAmp;
        p.wobblePhase += p.wobbleFreq;
        p.rotation += p.rotSpeed;

        // Reset when off-screen
        if (p.y > H + 10) {
          Object.assign(p, makePetal(W, H, false));
        }

        // Draw pixelated petal (5-pixel cross shape)
        const px = Math.round(p.x);
        const py = Math.round(p.y);
        const s = Math.round(p.size);
        const alpha = dark ? p.opacity : p.opacity * 0.7;
        ctx!.fillStyle = `hsla(${p.hue}, 80%, 75%, ${alpha})`;

        // Cross pattern for pixel petal
        ctx!.fillRect(px, py, s, s);
        ctx!.fillRect(px - s, py, s, s);
        ctx!.fillRect(px + s, py, s, s);
        ctx!.fillRect(px, py - s, s, s);
        ctx!.fillRect(px, py + s, s, s);

        // Center highlight
        ctx!.fillStyle = `hsla(${p.hue + 20}, 90%, 85%, ${alpha * 0.8})`;
        ctx!.fillRect(px, py, s, s);
      }

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[-1] h-full w-full"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

function makePetal(maxX: number, maxY: number, randomY: boolean): Petal {
  return {
    x: Math.random() * maxX,
    y: randomY ? Math.random() * maxY : -5,
    size: 1 + Math.floor(Math.random() * 2),
    speed: 0.15 + Math.random() * 0.25,
    wobbleAmp: 0.2 + Math.random() * 0.4,
    wobbleFreq: 0.02 + Math.random() * 0.03,
    wobblePhase: Math.random() * Math.PI * 2,
    rotation: Math.random() * 360,
    rotSpeed: (Math.random() - 0.5) * 0.02,
    opacity: 0.3 + Math.random() * 0.4,
    hue: 330 + Math.random() * 30, // pink range
  };
}
