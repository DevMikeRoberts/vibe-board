import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PixelIcon } from './PixelIcon';
import type { ProjectConfig } from '@/types';
import { api } from '@/lib/api';
import { isCoarsePointer } from '@/lib/utils';
import { resetGithubSetupDismissed } from './GitHubSetupModal';

interface ConfigDialogProps {
  open: boolean;
  config: ProjectConfig | null;
  onClose: () => void;
  onSubmit: (patch: Partial<ProjectConfig>) => Promise<unknown>;
  onProjectsImported?: () => void;
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
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-neon-pink/50 pointer-coarse:h-7 pointer-coarse:w-12 pointer-coarse:before:absolute pointer-coarse:before:-inset-2 ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform pointer-coarse:h-6 pointer-coarse:w-6 ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function ConfigDialog({ open, config, onClose, onSubmit, onProjectsImported }: ConfigDialogProps) {
  const [cloneRoot, setCloneRoot] = useState('');
  const [autoPickup, setAutoPickup] = useState(false);
  const [tokenRetry, setTokenRetry] = useState(false);
  const [autoPr, setAutoPr] = useState(true);
  const [fallbackMinutes, setFallbackMinutes] = useState(String(DEFAULT_FALLBACK_MINUTES));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // GitHub integration state
  const [githubStatus, setGithubStatus] = useState<{
    configured: boolean;
    tokenSource: 'env' | 'config' | null;
    username?: string | null;
  } | null>(null);
  const [githubToken, setGithubToken] = useState('');
  const [githubPhase, setGithubPhase] = useState<'idle' | 'saving' | 'importing' | 'done'>('idle');
  const [githubResult, setGithubResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [githubError, setGithubError] = useState('');

  useEffect(() => {
    if (!open) return;
    setCloneRoot(config?.cloneRoot ?? '');
    setAutoPickup(config?.autoPickupEnabled ?? false);
    setTokenRetry(config?.tokenLimitRetryEnabled ?? false);
    setAutoPr(config?.autoPrEnabled ?? true);
    setFallbackMinutes(String(config?.tokenLimitFallbackMinutes ?? DEFAULT_FALLBACK_MINUTES));
    setError('');
    setSubmitting(false);
    // Reset GitHub section state
    setGithubToken('');
    setGithubPhase('idle');
    setGithubResult(null);
    setGithubError('');
    // Fetch current GitHub status
    api.getGithubStatus().then(setGithubStatus).catch(() => setGithubStatus(null));
  }, [open, config]);

  async function handleGithubConnect() {
    const trimmed = githubToken.trim();
    if (!trimmed) {
      setGithubError('Please enter a GitHub Personal Access Token');
      return;
    }
    setGithubError('');
    setGithubPhase('saving');
    try {
      await api.saveGithubToken(trimmed);
      // Clear dismissed flag so setup modal can show again if needed
      resetGithubSetupDismissed();
      setGithubPhase('importing');
      const result = await api.importGithubRepos(trimmed);
      setGithubResult(result);
      setGithubPhase('done');
      onProjectsImported?.();
      // Refresh status
      api.getGithubStatus().then(setGithubStatus).catch(() => {});
    } catch (err: unknown) {
      setGithubPhase('idle');
      setGithubError(err instanceof Error ? err.message : 'Failed to connect to GitHub');
    }
  }

  async function handleGithubImport() {
    setGithubError('');
    setGithubPhase('importing');
    try {
      const result = await api.importGithubRepos();
      setGithubResult(result);
      setGithubPhase('done');
      onProjectsImported?.();
    } catch (err: unknown) {
      setGithubPhase('idle');
      setGithubError(err instanceof Error ? err.message : 'Import failed');
    }
  }

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
        autoPrEnabled: autoPr,
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
            className="fixed inset-0 z-[85] bg-[var(--overlay-bg)] backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 z-[85] flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col sticker rounded-[1.75rem] bg-popover p-6"
          >
            <div className="mb-5 flex shrink-0 items-center justify-between">
              <h2 className="text-base font-semibold">Settings</h2>
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-border font-pixel text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground pointer-coarse:h-10 pointer-coarse:w-10"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
              <div className="min-h-0 space-y-5 overflow-y-auto">
              {/* ââ GitHub Integration ââ */}
              <div className="space-y-3 rounded-2xl border-2 border-border bg-card/50 p-3">
                <div className="flex items-center gap-2">
                  <PixelIcon name="global-public" className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">GitHub Integration</span>
                </div>

                {githubStatus?.configured ? (
                  /* Token is already configured */
                  <div className="space-y-2">
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-xs text-emerald-400">
                      {githubStatus.tokenSource === 'env'
                        ? `Token loaded from environment${githubStatus.username ? ` Â· @${githubStatus.username}` : ''}`
                        : `Token saved Â· @${githubStatus.username ?? 'connected'}`}
                    </div>

                    {githubPhase === 'done' && githubResult ? (
                      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-xs text-emerald-400">
                        <PixelIcon name="iris-scan-approved" className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {githubResult.imported > 0
                            ? `${githubResult.imported} repo${githubResult.imported !== 1 ? 's' : ''} imported`
                            : 'All repos already loaded'}
                          {githubResult.skipped > 0 ? ` Â· ${githubResult.skipped} skipped` : ''}
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleGithubImport}
                        disabled={githubPhase === 'importing'}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {githubPhase === 'importing' ? (
                          <>
                            <PixelIcon name="loading-circle-1" className="h-3.5 w-3.5 animate-px-spin-fast" />
                            Importingâ¦
                          </>
                        ) : (
                          <>
                            <PixelIcon name="recycle" className="h-3.5 w-3.5" />
                            Re-import Repos
                          </>
                        )}
                      </button>
                    )}
                    {githubError && (
                      <p className="text-xs text-destructive">{githubError}</p>
                    )}
                  </div>
                ) : (
                  /* No token configured yet */
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground/70">
                      Connect GitHub to auto-load your repositories as projects.
                    </p>
                    <div className="relative">
                      <PixelIcon name="key" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="password"
                        value={githubToken}
                        onChange={(e) => { setGithubToken(e.target.value); setGithubError(''); }}
                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                        autoComplete="off"
                        className="h-11 w-full rounded-xl border-2 border-border bg-card py-2 pl-8 pr-3 font-mono text-xs placeholder:text-muted-foreground/40 focus:border-neon-pink focus:outline-none transition-colors"
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <a
                        href="https://github.com/settings/tokens/new?scopes=repo&description=AgentBoard"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-orange-500/70 hover:text-orange-400"
                      >
                        <PixelIcon name="hyperlink" className="h-3 w-3" />
                        Create token (needs <code className="font-mono">repo</code> scope)
                      </a>
                      <button
                        type="button"
                        onClick={handleGithubConnect}
                        disabled={githubPhase === 'saving' || githubPhase === 'importing'}
                        className="flex items-center gap-1.5 rounded-lg bg-orange-500/15 px-3 py-1.5 text-xs font-medium text-orange-400 transition-colors hover:bg-orange-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {githubPhase === 'saving' || githubPhase === 'importing' ? (
                          <>
                            <PixelIcon name="loading-circle-1" className="h-3 w-3 animate-px-spin-fast" />
                            {githubPhase === 'saving' ? 'Validatingâ¦' : 'Importingâ¦'}
                          </>
                        ) : (
                          <>
                            <PixelIcon name="global-public" className="h-3 w-3" />
                            Connect
                          </>
                        )}
                      </button>
                    </div>
                    {githubPhase === 'done' && githubResult && (
                      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-xs text-emerald-400">
                        <PixelIcon name="iris-scan-approved" className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {githubResult.imported > 0
                            ? `${githubResult.imported} repo${githubResult.imported !== 1 ? 's' : ''} imported`
                            : 'All repos already loaded'}
                        </span>
                      </div>
                    )}
                    {githubError && (
                      <p className="text-xs text-destructive">{githubError}</p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="config-clone-root" className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                  Clone Root
                </label>
                <input
                  id="config-clone-root"
                  value={cloneRoot}
                  onChange={(e) => { setCloneRoot(e.target.value); setError(''); }}
                  placeholder="~/agentboard/projects"
                  autoFocus={!isCoarsePointer()}
                  className="w-full h-11 rounded-xl border-2 border-border bg-card px-3 font-mono text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                />
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Repos created from a GitHub URL are cloned into this folder. It is created automatically.
                </p>
              </div>

              {/* Automation settings */}
              <div className="space-y-4 rounded-2xl border-2 border-border bg-card/50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <label htmlFor="config-auto-pr" className="block text-sm font-medium">
                      Auto-open PR on completion
                    </label>
                    <p className="mt-0.5 text-xs text-muted-foreground/70">
                      When a task finishes on a repo with a remote, open a pull request for its branch and
                      watch it â moving the task to Done and cleaning up the branch/worktree once merged.
                    </p>
                  </div>
                  <Toggle id="config-auto-pr" checked={autoPr} onChange={setAutoPr} />
                </div>

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
                    <label htmlFor="config-fallback-minutes" className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                      Fallback retry delay (minutes)
                    </label>
                    <input
                      id="config-fallback-minutes"
                      type="number"
                      min={1}
                      max={1440}
                      value={fallbackMinutes}
                      onChange={(e) => { setFallbackMinutes(e.target.value); setError(''); }}
                      className="h-11 w-28 rounded-xl border-2 border-border bg-card px-3 text-sm focus:border-neon-pink focus:outline-none transition-colors"
                    />
                    <p className="mt-1 text-xs text-muted-foreground/60">
                      Used when no reset time can be parsed from the error.
                    </p>
                  </div>
                )}
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-xl border-2 border-destructive/40 bg-destructive/10 px-3 py-2.5 font-pixel text-[11px] text-destructive">
                  {error}
                </div>
              )}
              </div>

              <div className="flex shrink-0 flex-wrap justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-11 w-full rounded-full border-2 border-border px-4 font-display text-sm text-foreground/80 hover:border-foreground/40 hover:text-foreground transition-colors [text-transform:lowercase] sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="sticker-sm sticker-press h-11 w-full rounded-full bg-primary px-5 font-display text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 [text-transform:lowercase] sm:w-auto"
                >
                  {submitting ? 'Savingâ¦' : 'Save'}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
