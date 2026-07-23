import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getRandomQuip, getRandomTip } from '@/lib/companion-quips';
import { cn } from '@/lib/utils';

interface CompanionQuipToastProps {
  open: boolean;
  onOpen: () => void;
}

/**
 * A floating toast that appears periodically with a random quip when the
 * companion panel is closed.  Clicking it opens the full panel.
 */
export function CompanionQuipToast({ open, onOpen }: CompanionQuipToastProps) {
  const [quip, setQuip] = useState('');
  const [visible, setVisible] = useState(false);
  const [hasShownOnce, setHasShownOnce] = useState(false);

  const showRandomQuip = useCallback(() => {
    const pool = Math.random() > 0.5 ? getRandomQuip : getRandomTip;
    setQuip(pool());
    setVisible(true);
  }, []);

  // Show the first quip after 4 seconds
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      showRandomQuip();
      setHasShownOnce(true);
    }, 4_000);
    return () => clearTimeout(t);
  }, [open, showRandomQuip, hasShownOnce]);

  // Then show every 30s while panel stays closed
  useEffect(() => {
    if (open || !hasShownOnce) return;
    const interval = setInterval(() => {
      showRandomQuip();
    }, 30_000);
    return () => clearInterval(interval);
  }, [open, hasShownOnce, showRandomQuip]);

  // Hide after 6 seconds
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), 6_000);
    return () => clearTimeout(t);
  }, [visible]);

  if (open) return null;

  return (
    <div className="fixed bottom-20 right-5 z-[60] max-w-[260px]">
      <AnimatePresence>
        {visible && (
          <motion.button
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            onClick={() => {
              setVisible(false);
              onOpen();
            }}
            className={cn(
              'w-full text-left rounded-2xl px-4 py-3',
              'border-2 border-neon-purple/30 bg-card/90 backdrop-blur-sm',
              'font-pixel text-[11px] leading-relaxed text-foreground',
              'shadow-lg shadow-neon-purple/10',
              'hover:border-neon-purple/60 transition-colors cursor-pointer'
            )}
            title="Click to open Libby"
          >
            <span className="mb-1 block text-[9px] text-neon-purple/60 [text-transform:lowercase]">
              libby says:
            </span>
            <span className="whitespace-pre-wrap break-words">{quip}</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
