import { useEffect, useId, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PixelIcon } from '@/components/PixelIcon';

interface DeleteConfirmDialogProps {
  open: boolean;
  taskTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  description?: ReactNode;
  confirmLabel?: string;
}

export function DeleteConfirmDialog({
  open,
  taskTitle,
  onCancel,
  onConfirm,
  title = 'Delete task?',
  description,
  confirmLabel = 'Delete',
}: DeleteConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[85] bg-[var(--overlay-bg)] backdrop-blur-sm"
            onClick={onCancel}
          />

          {/* Dialog — scary-cute red sticker: shakes in, glows and pulses while open */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
            initial={{ opacity: 0, scale: 0.92, y: 24, rotate: -1 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: 0, x: [0, -7, 7, -5, 5, -2, 2, 0] }}
            exit={{ opacity: 0, scale: 0.92, y: 24, rotate: -1 }}
            transition={{
              default: { type: 'spring', damping: 25, stiffness: 300 },
              x: { duration: 0.45, delay: 0.05, ease: 'easeInOut' },
            }}
            className="fixed left-1/2 top-1/2 z-[85] max-h-[90dvh] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[1.75rem] p-6"
            style={{
              background: 'color-mix(in srgb, var(--color-destructive) 16%, var(--color-popover))',
              border: '2px solid var(--color-destructive)',
              boxShadow: '4px 4px 0 0 var(--color-ink), 0 0 32px -4px color-mix(in srgb, var(--color-destructive) 70%, transparent)',
            }}
          >
            {/* Pulsing inner glow ring — keeps the danger feel alive while the dialog is open */}
            <motion.div
              aria-hidden="true"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute inset-0 rounded-[1.75rem] pointer-events-none"
              style={{
                boxShadow: 'inset 0 0 26px -4px color-mix(in srgb, var(--color-destructive) 55%, transparent)',
              }}
            />
            {/* Header */}
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <PixelIcon name="bin" className="animate-px-bob h-10 w-10 shrink-0 text-destructive" />
                <h2 id={titleId} className="font-display text-xl leading-tight text-destructive [text-transform:lowercase]">
                  {title}
                </h2>
              </div>
              <button
                onClick={onCancel}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-destructive/50 bg-card font-pixel text-sm text-destructive/80 transition-colors hover:border-destructive hover:text-destructive"
              >
                ✕
              </button>
            </div>

            {description ?? (
              <p className="mb-6 text-sm leading-relaxed" style={{ color: 'color-mix(in srgb, var(--color-destructive) 55%, var(--color-foreground))' }}>
                <span className="font-semibold text-destructive">{taskTitle}</span> will be permanently
                deleted. This action cannot be undone.
              </p>
            )}

            {/* Actions */}
            <div className="flex flex-wrap justify-end gap-2.5">
              <button
                ref={cancelRef}
                onClick={onCancel}
                className="flex h-11 items-center justify-center rounded-xl border-2 border-border bg-card px-4 font-pixel text-[11px] text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="sticker-sm sticker-press flex h-11 items-center gap-2 rounded-full bg-destructive px-5 font-display text-sm text-cream [text-transform:lowercase]"
              >
                <PixelIcon name="bin" className="h-4 w-4" />
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
