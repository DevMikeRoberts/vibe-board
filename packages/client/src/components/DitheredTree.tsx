import { useRef, useEffect, useCallback } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { prefersReducedMotion } from '@/lib/pixel-canvas';

interface Pixel {
  x: number;
  y: number;
  color: string;
  targetOpacity: number;
  currentOpacity: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export function DitheredTree() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const pixelsRef = useRef<Pixel[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const timeRef = useRef(0);
  const { theme } = useTheme();

  const generateTreePixels = useCallback((width: number, height: number): Pixel[] => {
    const pixels: Pixel[] = [];
    const centerX = width / 2;
    const trunkBottom = height * 0.85;
    const trunkTop = height * 0.55;
    const trunkWidth = width * 0.04;

    // Neon colors matching the theme
    const greenColors = theme === 'dark'
      ? ['#3df285', '#12b564', '#0a8a42', '#3df28580', '#12b56480']
      : ['#12b564', '#0a8a42', '#076a30', '#12b56480', '#0a8a4280'];
    const pinkColors = theme === 'dark'
      ? ['#ff6ec7', '#e8368f', '#ff6ec780', '#e8368f80']
      : ['#e8368f', '#c42975', '#e8368f80', '#c4297580'];
    const trunkColors = theme === 'dark'
      ? ['#4a3728', '#3d2d1f', '#2d2015']
      : ['#6b5240', '#5a4535', '#4a3728'];

    // Draw trunk with dithering
    for (let y = trunkTop; y < trunkBottom; y++) {
      const progress = (y - trunkTop) / (trunkBottom - trunkTop);
      const currentWidth = trunkWidth * (0.6 + progress * 0.4);
      for (let x = centerX - currentWidth; x <= centerX + currentWidth; x++) {
        // Dithering pattern - checkerboard with noise
        const dither = ((Math.floor(x) + Math.floor(y)) % 2 === 0) ||
          (Math.random() > 0.7);
        if (dither) {
          const color = trunkColors[Math.floor(Math.random() * trunkColors.length)];
          pixels.push({
            x: Math.floor(x),
            y: Math.floor(y),
            color,
            targetOpacity: 0.8 + Math.random() * 0.2,
            currentOpacity: 0,
          });
        }
      }
    }

    // Draw branches and leaves (triangle shape with dithering)
    const branchLevels = 5;
    for (let level = 0; level < branchLevels; level++) {
      const levelProgress = level / branchLevels;
      const yCenter = trunkTop - level * (height * 0.08);
      const spread = (width * 0.35) * (1 - levelProgress * 0.6);
      const density = 0.4 + levelProgress * 0.3;

      for (let i = 0; i < 120; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * spread;
        const x = centerX + Math.cos(angle) * radius;
        const y = yCenter + Math.sin(angle) * radius * 0.4;

        // Dithering: more likely to draw pixels near edges
        const distFromCenter = Math.abs(x - centerX) / spread;
        const shouldDraw = Math.random() < density || distFromCenter > 0.7;

        if (shouldDraw && y > 0 && y < trunkTop) {
          const colors = level % 2 === 0 ? greenColors : pinkColors;
          const color = colors[Math.floor(Math.random() * colors.length)];
          pixels.push({
            x: Math.floor(x),
            y: Math.floor(y),
            color,
            targetOpacity: 0.5 + Math.random() * 0.5,
            currentOpacity: 0,
          });
        }
      }
    }

    // Top star/accent
    const starColors = ['#f2e947', '#ff6ec7', '#6c5cff'];
    for (let i = 0; i < 15; i++) {
      const angle = (i / 15) * Math.PI * 2;
      const radius = 4 + Math.random() * 3;
      const x = centerX + Math.cos(angle) * radius;
      const y = trunkTop - branchLevels * (height * 0.08) - 5 + Math.sin(angle) * radius;
      pixels.push({
        x: Math.floor(x),
        y: Math.floor(y),
        color: starColors[Math.floor(Math.random() * starColors.length)],
        targetOpacity: 0.8 + Math.random() * 0.2,
        currentOpacity: 0,
      });
    }

    return pixels;
  }, [theme]);

  const spawnParticle = useCallback((x: number, y: number, color: string) => {
    particlesRef.current.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -Math.random() * 0.3 - 0.1,
      life: 1,
      maxLife: 60 + Math.random() * 60,
      color,
      size: 1 + Math.random() * 2,
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = prefersReducedMotion();
    let w = 0;
    let h = 0;
    let fade = reduced ? 1 : 0; // global fade-in progress, mirrors the pixels' easing
    let resizeTimer: ReturnType<typeof setTimeout>;

    const sizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    };

    const rebuild = () => {
      sizeCanvas();
      pixelsRef.current = generateTreePixels(w, h);
      // Carry the fade progress over so a rebuild doesn't restart the fade-in.
      for (const pixel of pixelsRef.current) {
        pixel.currentOpacity = pixel.targetOpacity * fade;
      }
      particlesRef.current = [];
    };

    const drawSettled = () => {
      ctx.clearRect(0, 0, w, h);
      for (const pixel of pixelsRef.current) {
        ctx.globalAlpha = pixel.targetOpacity;
        ctx.fillStyle = pixel.color;
        ctx.fillRect(pixel.x, pixel.y, 2, 2);
      }
      ctx.globalAlpha = 1;
    };

    rebuild();

    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const rect = canvas.getBoundingClientRect();
        // Height-only deltas (mobile URL-bar chrome) just resize the buffer —
        // regenerating would make the whole tree vanish and re-fade.
        if (Math.abs(rect.width - w) < 2 && Math.abs(rect.height - h) < 14) {
          sizeCanvas();
        } else {
          rebuild();
        }
        if (reduced) drawSettled();
      }, 150);
    };
    window.addEventListener('resize', onResize);

    const animate = () => {
      ctx.clearRect(0, 0, w, h);
      timeRef.current += 0.016;
      fade += (1 - fade) * 0.02;

      // Animate pixels fading in
      for (const pixel of pixelsRef.current) {
        pixel.currentOpacity += (pixel.targetOpacity - pixel.currentOpacity) * 0.02;

        // Gentle breathing effect
        const breathe = Math.sin(timeRef.current * 0.5 + pixel.x * 0.01 + pixel.y * 0.01) * 0.1;
        const opacity = Math.max(0, Math.min(1, pixel.currentOpacity + breathe));

        ctx.globalAlpha = opacity;
        ctx.fillStyle = pixel.color;
        ctx.fillRect(pixel.x, pixel.y, 2, 2);

        // Randomly spawn particles from bright pixels
        if (Math.random() < 0.0005 && pixel.currentOpacity > 0.6) {
          spawnParticle(pixel.x, pixel.y, pixel.color);
        }
      }

      // Update and draw particles
      ctx.globalAlpha = 1;
      particlesRef.current = particlesRef.current.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1 / p.maxLife;

        if (p.life <= 0) return false;

        ctx.globalAlpha = p.life * 0.6;
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.floor(p.x), Math.floor(p.y), Math.ceil(p.size), Math.ceil(p.size));

        return true;
      });

      ctx.globalAlpha = 1;
      animFrameRef.current = requestAnimationFrame(animate);
    };

    if (reduced) {
      drawSettled();
    } else {
      animFrameRef.current = requestAnimationFrame(animate);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(resizeTimer);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [generateTreePixels, spawnParticle]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
