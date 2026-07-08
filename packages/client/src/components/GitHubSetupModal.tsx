import { useState, useEffect, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, Github, Loader2, X, ExternalLink, KeyRound, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

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
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
            onClick={dismiss}
          />

          {/* Modal */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Connect GitHub"
            initial={{ opacity: 0, scale: 0.95, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 24 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/10 bg-card shadow-2xl"
            style={{ backdropFilter: 'blur(20px)' }}
          >
            {/* Top accent line */}
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(249,115,22,0.7) 35%, rgba(251,146,60,0.9) 50%, rgba(249,115,22,0.7) 65%, transparent 100%)' }}
              aria-hidden="true"
            />

            <div className="p-6">
              {/* Header */}
              <div className="mb-5 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.25)' }}
                  >
                    <Github className="h-5 w-5 text-orange-400" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">Connect GitHub</h2>
                    <p className="text-xs text-muted-foreground">Auto-load your repos as projects</p>
                  </div>
                </div>
                <button
                  onClick={dismiss}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-white/8 hover:text-zinc-300"
                  aria-label="Skip for now"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Content based on phase */}
              {phase === 'done' && result ? (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <div
                      className="flex h-14 w-14 items-center justify-center rounded-2xl"
                      style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)' }}
                    >
                      <CheckCircle className="h-7 w-7 text-emerald-400" />
                    </div>
                    {username && (
                      <p className="text-sm font-medium text-foreground">
                        Connected as <span className="text-orange-400">@{username}</span>
                      </p>
                    )}
                    <div className="text-sm text-muted-foreground">
                      {result.imported > 0 ? (
                        <p>
                          <span className="font-semibold text-emerald-400">{result.imported}</span> repo{result.imported !== 1 ? 's' : ''} imported
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
                    className="btn-orange-gradient w-full rounded-xl py-2.5 text-sm font-semibold"
                  >
                    Done
                  </button>
                </div>
              ) : phase === 'importing' ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                  <p className="text-sm text-muted-foreground">Fetching your repositories…</p>
                </div>
              ) : isEnvConfigured ? (
                /* Token already set via env var — just show import button */
                <div className="space-y-4">
                  <div
                    className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-3 text-sm text-emerald-400"
                  >
                    <p className="font-medium">GitHub token detected from environment</p>
                    {status?.username && (
                      <p className="mt-0.5 text-xs text-emerald-400/70">Signed in as @{status.username}</p>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Import all your personal (non-fork) GitHub repositories as projects.
                  </p>
                  {error && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                      {error}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={dismiss}
                      className="flex-1 rounded-xl border border-white/8 bg-white/5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground"
                    >
                      Skip for now
                    </button>
                    <button
                      onClick={handleImportOnly}
                      className="btn-orange-gradient flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Import Repos
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
                    <label htmlFor="github-token-input" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Personal Access Token
                    </label>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                      <input
                        id="github-token-input"
                        type="password"
                        value={token}
                        onChange={(e) => { setToken(e.target.value); setError(''); }}
                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                        autoFocus
                        autoComplete="off"
                        className="w-full rounded-xl border border-white/10 bg-background/80 py-2.5 pl-9 pr-3 font-mono text-sm placeholder:text-muted-foreground/40 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
                      />
                    </div>
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo&description=AgentBoard"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-xs text-orange-500/70 hover:text-orange-400"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Create a token on GitHub (needs <code className="font-mono">repo</code> scope)
                    </a>
                  </div>

                  {error && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                      {error}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={dismiss}
                      className="flex-1 rounded-xl border border-white/8 bg-white/5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground"
                    >
                      Skip for now
                    </button>
                    <button
                      type="submit"
                      className="btn-orange-gradient flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold"
                    >
                      <Github className="h-3.5 w-3.5" />
                      Connect &amp; Import
                    </button>
                  </div>
                </form>
              )}
            </div>
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
