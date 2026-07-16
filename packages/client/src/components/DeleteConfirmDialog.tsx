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
            className="fixed inset-0 z-50 bg-[var(--overlay-bg)] backdrop-blur-sm"
            onClick={onCancel}
          />

          {/* Dialog — small scary-cute sticker with shake + red glow */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
            initial={{ opacity: 0, scale: 0.92, y: 24, rotate: -1 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 24, rotate: -1 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] bg-popover p-6"
            style={{
              border: '2px solid var(--color-destructive)',
              boxShadow: '4px 4px 0 0 var(--color-ink), 0 0 28px -4px color-mix(in srgb, var(--color-destructive) 60%, transparent)',
            }}
          >
            <motion.div
              aria-hidden="true"
              animate={{ x: [0, -3, 3, -2, 2, -1, 1, 0] }}
              transition={{ duration: 0.4, ease: 'easeInOut' }}
              className="absolute inset-0 rounded-[1.75rem] pointer-events-none"
              style={{
                border: '2px solid var(--color-destructive)',
                boxShadow: 'inset 0 0 24px -4px color-mix(in srgb, var(--color-destructive) 40%, transparent)',
              }}
            />
            {/* Header */}
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <PixelIcon name="bin" className="animate-px-bob h-10 w-10 shrink-0 text-destructive" />
                <h2 id={titleId} className="font-display text-xl leading-tight text-foreground [text-transform:lowercase]">
                  {title}
                </h2>
              </div>
              <button
                onClick={onCancel}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-card font-pixel text-sm text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                ✕
              </button>
            </div>

            {description ?? (
              <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">{taskTitle}</span> will be permanently
                deleted. This action cannot be undone.
              </p>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2.5">
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
