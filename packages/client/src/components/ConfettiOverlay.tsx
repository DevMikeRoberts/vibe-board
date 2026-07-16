import { useMemo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const COLORS = [
  'var(--color-neon-pink)',
  'var(--color-neon-yellow)',
  'var(--color-neon-green)',
  'var(--color-neon-blue)',
  'var(--color-neon-purple)',
];

const SHAPES = ['square', 'rectangle', 'circle'] as const;

interface Particle {
  id: number;
  color: string;
  shape: string;
  angle: number;
  speed: number;
  size: number;
  rotation: number;
  delay: number;
}

interface ConfettiOverlayProps {
  x: number;
  y: number;
  count?: number;
  onComplete?: () => void;
}

export function ConfettiOverlay({ x, y, count = 24, onComplete }: ConfettiOverlayProps) {
  const [done, setDone] = useState(false);

  const particles = useMemo<Particle[]>(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      color: COLORS[i % COLORS.length],
      shape: SHAPES[i % SHAPES.length],
      angle: (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6,
      speed: 120 + Math.random() * 280,
      size: 5 + Math.random() * 7,
      rotation: Math.random() * 720,
      delay: Math.random() * 0.15,
    })), [count]);

  useEffect(() => {
    const id = setTimeout(() => {
      setDone(true);
      onComplete?.();
    }, 2200);
    return () => clearTimeout(id);
  }, [onComplete]);

  return (
    <AnimatePresence>
      {!done && (
        <div className="fixed inset-0 pointer-events-none z-[90]" aria-hidden="true">
          {particles.map((p) => (
            <motion.div
              key={p.id}
              initial={{
                opacity: 1,
                x: x - p.size / 2,
                y: y - p.size / 2,
                rotate: 0,
                scale: 0,
              }}
              animate={{
                opacity: [1, 1, 0],
                x: x + Math.cos(p.angle) * p.speed,
                y: y + Math.sin(p.angle) * p.speed + 120,
                rotate: p.rotation,
                scale: [0, 1.2, 0.8, 0],
              }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 1.4,
                delay: p.delay,
                ease: [0.25, 0.46, 0.45, 0.94],
              }}
              style={{
                position: 'absolute',
                width: p.size,
                height: p.shape === 'rectangle' ? p.size * 0.5 : p.size,
                backgroundColor: p.color,
                borderRadius: p.shape === 'circle' ? '50%' : '2px',
              }}
            />
          ))}
        </div>
      )}
    </AnimatePresence>
  );
}
