import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/pixel-canvas';

interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  size: number;
}

export interface ConfettiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const COLORS = ['#ff6ec7', '#f2e947', '#3df285', '#6c5cff', '#b08bff', '#ffffff'];
const PARTICLE_COUNT = 70;

/**
 * 8-bit confetti burst that emanates outward from a card's edges.
 * The canvas is sized to the full viewport so particle coordinates (derived
 * from getBoundingClientRect) line up 1:1 with screen space.
 */
export function ConfettiOverlay({ rect }: { rect: ConfettiRect }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<ConfettiPiece[]>([]);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 70 tumbling particles across the viewport is exactly the large-field
    // motion the preference asks to avoid — skip the burst entirely.
    if (prefersReducedMotion()) return;

    const W = window.innerWidth;
    const H = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const { x, y, width, height } = rect;
    const cx = x + width / 2;
    const cy = y + height / 2;

    const particles: ConfettiPiece[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Spawn along the card's perimeter so the burst reads as coming from the card itself.
      const edge = Math.floor(Math.random() * 4);
      let px: number, py: number;
      if (edge === 0) { px = x + Math.random() * width; py = y; }
      else if (edge === 1) { px = x + width; py = y + Math.random() * height; }
      else if (edge === 2) { px = x + Math.random() * width; py = y + height; }
      else { px = x; py = y + Math.random() * height; }

      const angle = Math.atan2(py - cy, px - cx) + (Math.random() - 0.5) * 0.8;
      const speed = Math.random() * 3.5 + 2;
      particles.push({
        x: px,
        y: py,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - Math.random() * 1.2,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 14,
        size: Math.random() * 4 + 3,
      });
    }
    particlesRef.current = particles;

    const animate = () => {
      ctx.clearRect(0, 0, W, H);

      const list = particlesRef.current;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.14; // gravity
        p.vx *= 0.99; // slight air drag
        p.rotation += p.rotationSpeed;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();

        if (p.y > H + 20 || p.x < -20 || p.x > W + 20) {
          list.splice(i, 1);
        }
      }

      if (list.length > 0) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
      }
    };

    animate();

    // The burst only lasts ~2s, but a rotation or URL-bar collapse mid-burst
    // stretches the fixed buffer and smears the particles — end it early.
    const stop = () => {
      particlesRef.current = [];
      ctx.clearRect(0, 0, W, H);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
    window.addEventListener('resize', stop);
    window.addEventListener('orientationchange', stop);

    return () => {
      window.removeEventListener('resize', stop);
      window.removeEventListener('orientationchange', stop);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [rect]);

  // h-full w-full stretches the dpr-scaled buffer back to viewport CSS size, keeping the 1:1 coordinate mapping
  return <canvas ref={canvasRef} className="fixed inset-0 h-full w-full pointer-events-none z-[100]" />;
}
