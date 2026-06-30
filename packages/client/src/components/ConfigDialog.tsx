import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { ProjectConfig } from '@/types';

interface ConfigDialogProps {
  open: boolean;
  config: ProjectConfig | null;
  onClose: () => void;
  onSubmit: (patch: Partial<ProjectConfig>) => Promise<unknown>;
}

const DEFAULT_FALLBACK_MINUTES = 60;

function Toggle({ checked, onChange, id }: { checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function ConfigDialog({ open, config, onClose, onSubmit }: ConfigDialogProps) {
  const [cloneRoot, setCloneRoot] = useState('');
  const [autoPickup, setAutoPickup] = useState(false);
  const [tokenRetry, setTokenRetry] = useState(false);
  const [fallbackMinutes, setFallbackMinutes] = useState(String(DEFAULT_FALLBACK_MINUTES));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCloneRoot(config?.cloneRoot ?? '');
    setAutoPickup(config?.autoPickupEnabled ?? false);
    setTokenRetry(config?.tokenLimitRetryEnabled ?? false);
    setFallbackMinutes(String(config?.tokenLimitFallbackMinutes ?? DEFAULT_FALLBACK_MINUTES));
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
    const minutes = Number(fallbackMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setError('Retry fallback must be a positive number of minutes');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await onSubmit({
        cloneRoot: trimmed,
        autoPickupEnabled: autoPickup,
        tokenLimitRetryEnabled: tokenRetry,
        tokenLimitFallbackMinutes: Math.round(minutes),
      });
      if (result === undefined) {
        setError('Failed to update settings');
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
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-2xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold">Settings</h2>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="config-clone-root" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Clone Root
                </label>
                <input
                  id="config-clone-root"
                  value={cloneRoot}
                  onChange={(e) => { setCloneRoot(e.target.value); setError(''); }}
                  placeholder="~/agentboard/projects"
                  autoFocus
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Repos created from a GitHub URL are cloned into this folder. It is created automatically.
                </p>
              </div>

              {/* Automation settings */}
              <div className="space-y-4 rounded-lg border border-border bg-background/50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <label htmlFor="config-auto-pickup" className="block text-sm font-medium">
                      Auto-pickup backlog
                    </label>
                    <p className="mt-0.5 text-xs text-muted-foreground/70">
                      Automatically start the next backlog task, one at a time per project, as a slot frees up.
                    </p>
                  </div>
                  <Toggle id="config-auto-pickup" checked={autoPickup} onChange={setAutoPickup} />
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <label htmlFor="config-token-retry" className="block text-sm font-medium">
                      Retry on token limit
                    </label>
                    <p className="mt-0.5 text-xs text-muted-foreground/70">
                      When an agent hits a token/usage limit, re-run the task around the time the limit resets.
                    </p>
                  </div>
                  <Toggle id="config-token-retry" checked={tokenRetry} onChange={setTokenRetry} />
                </div>

                {tokenRetry && (
                  <div>
                    <label htmlFor="config-fallback-minutes" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Fallback retry delay (minutes)
                    </label>
                    <input
                      id="config-fallback-minutes"
                      type="number"
                      min={1}
                      max={1440}
                      value={fallbackMinutes}
                      onChange={(e) => { setFallbackMinutes(e.target.value); setError(''); }}
                      className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <p className="mt-1 text-xs text-muted-foreground/60">
                      Used when no reset time can be parsed from the error.
                    </p>
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
