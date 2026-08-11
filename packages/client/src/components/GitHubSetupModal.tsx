import { useState, useEffect, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PixelIcon } from '@/components/PixelIcon';
import { api } from '@/lib/api';
import { isCoarsePointer } from '@/lib/utils';

interface GitHubStatus {
  configured: boolean;
  tokenSource: 'env' | 'config' | null;
  username?: string | null;
  name?: string | null;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

const DISMISSED_KEY = 'agentboard:github-setup-dismissed';

interface GitHubSetupModalProps {
  /** Called after repos are successfully imported so the parent can refresh projects. */
  onImported: () => void;
}

export function GitHubSetupModal({ onImported }: GitHubSetupModalProps) {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [phase, setPhase] = useState<'input' | 'importing' | 'done'>('input');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [username, setUsername] = useState<string | null>(null);

  // On mount: check GitHub status, decide whether to show the modal
  useEffect(() => {
    const dismissed = localStorage.getItem(DISMISSED_KEY);
    // If user dismissed before, don't auto-show again (they can trigger from Settings)
    if (dismissed === '1') return;

    api.getGithubStatus().then((s) => {
      setStatus(s);
      if (!s.configured) {
        setOpen(true);
      }
    }).catch(() => {
      // If the status check fails, don't show the modal
    });
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, '1');
    setOpen(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setError('Please enter a GitHub Personal Access Token');
      return;
    }
    setError('');
    setPhase('importing');

    try {
      // Save the token and validate it
      const saved = await api.saveGithubToken(trimmed);
      setUsername(saved.username);

      // Trigger repo import
      const importResult = await api.importGithubRepos(trimmed);
      setResult(importResult);
      setPhase('done');
      onImported();
    } catch (err: unknown) {
      setPhase('input');
      setError(err instanceof Error ? err.message : 'Failed to connect to GitHub');
    }
  }

  async function handleImportOnly() {
    // When token is already configured (env or config), just trigger import
    setPhase('importing');
    setError('');
    try {
      const importResult = await api.importGithubRepos();
      setResult(importResult);
      setPhase('done');
      onImported();
    } catch (err: unknown) {
      setPhase('input');
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  }

  function handleDone() {
    localStorage.setItem(DISMISSED_KEY, '1');
    setOpen(false);
  }

  if (!open) return null;

  const isEnvConfigured = status?.configured && status.tokenSource === 'env';

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
            onClick={dismiss}
          />

          {/* Modal */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Connect GitHub"
            initial={{ opacity: 0, y: 24, scale: 0.92, rotate: -1 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, y: 24, scale: 0.92, rotate: -1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className="sticker panel-neon panel-neon-glow fixed left-1/2 top-6 z-[85] max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 translate-y-0 overflow-y-auto rounded-[1.75rem] bg-popover p-6 sm:top-1/2 sm:-translate-y-1/2"
            style={{ '--panel': 'var(--color-neon-green)' } as React.CSSProperties}
          >
            {/* Header */}
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="sticker-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: 'var(--color-neon-green)', color: 'var(--color-ink)' }}
                >
                  <PixelIcon name="global-public" className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-xl text-foreground [text-transform:lowercase]">connect github</h2>
                  <p className="font-pixel text-[10px] text-muted-foreground lowercase">auto-load your repos as projects</p>
                </div>
              </div>
              <button
                onClick={dismiss}
                className="sticker-sm sticker-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-border bg-card font-pixel text-sm text-foreground/70 hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11"
                aria-label="Skip for now"
              >
                ✕
              </button>
            </div>

            {/* Content based on phase */}
            {phase === 'done' && result ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <div
                    className="sticker-sm flex h-14 w-14 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: 'var(--color-neon-green)', color: 'var(--color-ink)' }}
                  >
                    <PixelIcon name="rating-star-1" className="h-7 w-7" />
                  </div>
                  {username && (
                    <p className="text-sm font-medium text-foreground">
                      Connected as <span className="text-neon-green">@{username}</span>
                    </p>
                  )}
                  <div className="text-sm text-muted-foreground">
                    {result.imported > 0 ? (
                      <p>
                        <span className="font-semibold text-neon-green">{result.imported}</span> repo{result.imported !== 1 ? 's' : ''} imported
                        {result.skipped > 0 && `, ${result.skipped} already existed`}
                        {result.errors > 0 && `, ${result.errors} failed`}.
                      </p>
                    ) : (
                      <p>All your repos are already loaded{result.skipped > 0 ? ` (${result.skipped} found)` : ''}.</p>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleDone}
                  className="sticker-sm sticker-press flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 font-display text-sm text-primary-foreground [text-transform:lowercase]"
                >
                  done
                </button>
              </div>
            ) : phase === 'importing' ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <PixelIcon name="loading-circle-1" className="h-8 w-8 animate-px-spin-fast text-neon-green" />
                <p className="font-pixel text-[11px] text-muted-foreground lowercase">fetching your repositories…</p>
              </div>
            ) : isEnvConfigured ? (
              /* Token already set via env var — just show import button */
              <div className="space-y-4">
                <div className="sticker-sm rounded-xl border-2 border-border bg-card p-3 text-sm text-neon-green">
                  <p className="font-medium">GitHub token detected from environment</p>
                  {status?.username && (
                    <p className="mt-0.5 font-pixel text-[10px] text-muted-foreground lowercase">signed in as @{status.username}</p>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Import all your personal (non-fork) GitHub repositories as projects.
                </p>
                {error && (
                  <div className="sticker-sm rounded-xl border-2 border-destructive bg-card px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={dismiss}
                    className="h-11 flex-1 rounded-xl border-2 border-border bg-card font-pixel text-[11px] text-foreground/80 lowercase transition-colors hover:border-foreground/40 hover:text-foreground"
                  >
                    skip for now
                  </button>
                  <button
                    onClick={handleImportOnly}
                    className="sticker-sm sticker-press flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 font-display text-sm text-primary-foreground [text-transform:lowercase]"
                  >
                    <PixelIcon name="recycle" className="h-4 w-4" />
                    import repos
                  </button>
                </div>
              </div>
            ) : (
              /* No token — show token input form */
              <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Provide a GitHub Personal Access Token to automatically load all your
                  repositories as projects.
                </p>

                <div>
                  <label htmlFor="github-token-input" className="mb-1.5 block font-pixel text-[10px] text-muted-foreground lowercase">
                    personal access token
                  </label>
                  <div className="relative">
                    <PixelIcon name="key" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      id="github-token-input"
                      type="password"
                      value={token}
                      onChange={(e) => { setToken(e.target.value); setError(''); }}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      autoFocus={!isCoarsePointer()}
                      autoComplete="off"
                      className="h-11 w-full rounded-xl border-2 border-border bg-card pl-9 pr-3 font-pixel text-[11px] placeholder:text-muted-foreground focus:border-neon-pink focus:outline-none transition-colors"
                    />
                  </div>
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo&description=AgentBoard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1 font-pixel text-[10px] text-neon-green lowercase hover:text-neon-pink"
                  >
                    <PixelIcon name="hyperlink" className="h-3 w-3" />
                    create a token on github (needs <code className="font-pixel">repo</code> scope)
                  </a>
                </div>

                {error && (
                  <div className="sticker-sm rounded-xl border-2 border-destructive bg-card px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={dismiss}
                    className="h-11 flex-1 rounded-xl border-2 border-border bg-card font-pixel text-[11px] text-foreground/80 lowercase transition-colors hover:border-foreground/40 hover:text-foreground"
                  >
                    skip for now
                  </button>
                  <button
                    type="submit"
                    className="sticker-sm sticker-press flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 font-display text-sm text-primary-foreground [text-transform:lowercase]"
                  >
                    <PixelIcon name="global-public" className="h-4 w-4" />
                    connect &amp; import
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Imperative helper to re-open the GitHub setup modal (e.g. from Settings).
 * Clears the dismissed flag so the modal shows on next mount.
 */
export function resetGithubSetupDismissed(): void {
  localStorage.removeItem(DISMISSED_KEY);
}
