import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PixelIcon } from './PixelIcon';
import type { ProjectConfig } from '@/types';

interface ConfigDialogProps {
  open: boolean;
  config: ProjectConfig | null;
  onClose: () => void;
  onSubmit: (cloneRoot: string) => Promise<unknown>;
}

export function ConfigDialog({ open, config, onClose, onSubmit }: ConfigDialogProps) {
  const [cloneRoot, setCloneRoot] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCloneRoot(config?.cloneRoot ?? '');
    setError('');
    setSubmitting(false);
  }, [open, config]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = cloneRoot.trim();
    if (!trimmed) {
      setError('Clone root is required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await onSubmit(trimmed);
      if (result === undefined) {
        setError('Failed to update clone root');
        return;
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[var(--overlay-bg)] backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            initial={{ opacity: 0, scale: 0.92, y: 24, rotate: -1 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 24 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            className="sticker panel-neon fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] bg-popover p-6"
            style={{ '--panel': 'var(--color-neon-yellow)' } as React.CSSProperties}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="flex items-center gap-2.5 font-display text-xl leading-none [text-transform:lowercase]">
                <span className="sticker-sm flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--color-neon-yellow)', color: 'var(--color-ink)' }}>
                  <PixelIcon name="settings-toggle-horizontal" className="h-5 w-5" />
                </span>
                settings
              </h2>
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-border font-pixel text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="config-clone-root" className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                  clone root
                </label>
                <input
                  id="config-clone-root"
                  value={cloneRoot}
                  onChange={(e) => { setCloneRoot(e.target.value); setError(''); }}
                  placeholder="~/agentboard/projects"
                  autoFocus
                  className="h-11 w-full rounded-xl border-2 border-border bg-card px-3 font-mono text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                />
                <p className="mt-1.5 text-xs text-muted-foreground/70">
                  Repos created from a GitHub URL are cloned into this folder. It is created automatically.
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-xl border-2 border-destructive/40 bg-destructive/10 px-3 py-2.5 font-pixel text-[11px] text-destructive">
                  <PixelIcon name="alert-triangle-1" className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-11 rounded-full border-2 border-border px-4 font-display text-sm text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground [text-transform:lowercase]"
                >
                  cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="sticker-sm sticker-press h-11 rounded-full bg-primary px-5 font-display text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 [text-transform:lowercase]"
                >
                  {submitting ? 'saving…' : 'save'}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
