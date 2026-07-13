import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PixelIcon } from './PixelIcon';
import { isAbsoluteRepoPath, getRepoPathHelpText, getRepoPathPlaceholder } from '@/lib/utils';
import { AGENT_OPTIONS } from '@/lib/agent-config';
import { PRIORITY_OPTIONS } from '@/lib/priority-config';
import type { AgentType, CreateProjectRequest, Priority, Project, ProjectPathValidation, UpdateProjectRequest } from '@/types';

export interface ProjectDialogInitialValues {
  source?: 'local' | 'repo';
  name?: string;
  repoUrl?: string;
  repoPath?: string;
  defaultAgentType?: string;
  defaultPriority?: string;
  defaultBaseBranch?: string;
  defaultUseWorktree?: 'inherit' | 'true' | 'false';
  /** When true, submit the prefilled form automatically once the dialog opens. */
  autoSubmit?: boolean;
}

interface ProjectDialogProps {
  open: boolean;
  project?: Project | null;
  initialValues?: ProjectDialogInitialValues | null;
  onClose: () => void;
  onSubmit: (data: CreateProjectRequest | UpdateProjectRequest) => Promise<unknown>;
  onValidatePath: (repoPath: string) => Promise<ProjectPathValidation | undefined>;
  onSelectDirectory: (initialPath?: string) => Promise<string | null | undefined>;
}

type PathStatus =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'valid'; message: string }
  | { kind: 'warning'; message: string }
  | { kind: 'invalid'; message: string };

function leafNameFromPath(value: string): string {
  const normalized = value.trim().replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

/** Derive a project/repo name from a git URL (last path segment, minus .git). */
function leafNameFromUrl(value: string): string {
  const cleaned = value.trim().split(/[?#]/)[0].replace(/[\\/]+$/, '').replace(/\.git$/i, '');
  return cleaned.split(/[\\/:]/).filter(Boolean).pop() ?? '';
}

export function ProjectDialog({
  open,
  project,
  initialValues,
  onClose,
  onSubmit,
  onValidatePath,
  onSelectDirectory,
}: ProjectDialogProps) {
  const mode = project ? 'edit' : 'create';
  const [sourceType, setSourceType] = useState<'local' | 'repo'>('local');
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [defaultAgentType, setDefaultAgentType] = useState('');
  const [defaultPriority, setDefaultPriority] = useState('');
  const [defaultBaseBranch, setDefaultBaseBranch] = useState('');
  const [defaultUseWorktree, setDefaultUseWorktree] = useState<'inherit' | 'true' | 'false'>('inherit');
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState('');
  const [pathStatus, setPathStatus] = useState<PathStatus>({ kind: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const [selectingDirectory, setSelectingDirectory] = useState(false);
  const [autoSubmitPending, setAutoSubmitPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSourceType(initialValues?.source ?? (project?.repoUrl ? 'repo' : 'local'));
    setName(project?.name ?? initialValues?.name ?? '');
    setRepoPath(project?.repoPath ?? initialValues?.repoPath ?? '');
    setRepoUrl(project?.repoUrl ?? initialValues?.repoUrl ?? '');
    setDefaultAgentType(project?.defaultAgentType ?? initialValues?.defaultAgentType ?? '');
    setDefaultPriority(project?.defaultPriority ?? initialValues?.defaultPriority ?? '');
    setDefaultBaseBranch(project?.defaultBaseBranch ?? initialValues?.defaultBaseBranch ?? '');
    setDefaultUseWorktree(
      project?.defaultUseWorktree === undefined
        ? initialValues?.defaultUseWorktree ?? 'inherit'
        : project.defaultUseWorktree ? 'true' : 'false',
    );
    setNameTouched(Boolean(project) || Boolean(initialValues?.name));
    setError('');
    setPathStatus({ kind: 'idle' });
    setSubmitting(false);
    setSelectingDirectory(false);
    // Defer auto-submit to a later render so the prefilled state above is applied first.
    setAutoSubmitPending(!project && Boolean(initialValues?.autoSubmit));
  }, [open, project, initialValues]);

  async function validatePath(value: string): Promise<boolean> {
    const trimmedPath = value.trim();
    if (!trimmedPath) {
      setPathStatus({ kind: 'idle' });
      return true;
    }
    if (!isAbsoluteRepoPath(trimmedPath)) {
      setPathStatus({ kind: 'invalid', message: 'Local Path must be absolute' });
      return false;
    }

    setPathStatus({ kind: 'validating' });
    const result = await onValidatePath(trimmedPath);
    if (!result) {
      setPathStatus({ kind: 'invalid', message: 'Could not validate Local Path' });
      return false;
    }
    if (!result.valid) {
      setPathStatus({ kind: 'invalid', message: result.error ?? 'Local Path is invalid' });
      return false;
    }
    setPathStatus(result.warning
      ? { kind: 'warning', message: result.warning }
      : { kind: 'valid', message: 'Local Path is valid' });
    return true;
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (submitting) return;

    const trimmedName = name.trim();
    const trimmedPath = repoPath.trim();
    const trimmedUrl = repoUrl.trim();
    const usingRepo = mode === 'create' && sourceType === 'repo';

    if (usingRepo) {
      if (!trimmedUrl) {
        setError('Repository URL is required');
        return;
      }
    } else if (mode === 'create') {
      if (!trimmedName && !trimmedPath) {
        setError('Project Name or Local Path is required');
        return;
      }
    } else if (!trimmedName) {
      setError('Project Name is required');
      return;
    }

    if (!usingRepo) {
      const pathValid = await validatePath(trimmedPath);
      if (!pathValid) {
        setError('Fix the Local Path before saving');
        return;
      }
    }

    setSubmitting(true);
    setError('');
    try {
      const trimmedBaseBranch = defaultBaseBranch.trim();
      const worktreeValue = defaultUseWorktree === 'inherit' ? undefined : defaultUseWorktree === 'true';
      const defaults = mode === 'edit'
        ? {
            defaultAgentType: (defaultAgentType || null) as AgentType | null,
            defaultPriority: (defaultPriority || null) as Priority | null,
            defaultBaseBranch: trimmedBaseBranch || null,
            defaultUseWorktree: worktreeValue === undefined ? null : worktreeValue,
          }
        : {
            defaultAgentType: (defaultAgentType || undefined) as AgentType | undefined,
            defaultPriority: (defaultPriority || undefined) as Priority | undefined,
            defaultBaseBranch: trimmedBaseBranch || undefined,
            defaultUseWorktree: worktreeValue,
          };

      let payload: CreateProjectRequest | UpdateProjectRequest;
      if (mode === 'edit') {
        payload = {
          name: trimmedName || undefined,
          repoPath: trimmedPath || null,
          repoUrl: trimmedUrl || null,
          ...defaults,
        };
      } else if (usingRepo) {
        payload = {
          name: trimmedName || undefined,
          repoUrl: trimmedUrl,
          ...defaults,
        };
      } else {
        payload = {
          name: trimmedName || undefined,
          repoPath: trimmedPath || undefined,
          ...defaults,
        };
      }

      const result = await onSubmit(payload);
      if (result === undefined) return;
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  // Auto-submit prefilled forms launched via a creation URI (?autostart=1).
  // Runs only after the prefill effect has applied initialValues to state, so
  // handleSubmit's closure sees the populated name/repoUrl/repoPath/source.
  useEffect(() => {
    if (!open || !autoSubmitPending || submitting) return;
    setAutoSubmitPending(false);
    void handleSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoSubmitPending, submitting]);

  function handlePathChange(value: string) {
    setRepoPath(value);
    setError('');
    setPathStatus({ kind: 'idle' });
    if (mode === 'create' && !nameTouched) setName(leafNameFromPath(value));
  }

  function handleUrlChange(value: string) {
    setRepoUrl(value);
    setError('');
    if (mode === 'create' && !nameTouched) setName(leafNameFromUrl(value));
  }

  async function handleSelectDirectory() {
    if (selectingDirectory) return;
    setSelectingDirectory(true);
    setError('');
    try {
      const selected = await onSelectDirectory(repoPath.trim() || undefined);
      if (selected === undefined || selected === null) return;
      setRepoPath(selected);
      if (mode === 'create' && !nameTouched) setName(leafNameFromPath(selected));
      await validatePath(selected);
    } finally {
      setSelectingDirectory(false);
    }
  }

  if (!open) return null;

  const showLocalFields = mode === 'edit' || sourceType === 'local';
  const showRepoField = mode === 'edit' || sourceType === 'repo';

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
            initial={{ opacity: 0, scale: 0.92, y: 24, rotate: -1 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 24 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            className="sticker panel-neon fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[1.75rem] bg-popover p-6"
            style={{ '--panel': 'var(--color-neon-green)' } as React.CSSProperties}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="flex items-center gap-2.5 font-display text-xl leading-none [text-transform:lowercase]">
                <span className="sticker-sm flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--color-neon-green)', color: 'var(--color-ink)' }}>
                  <PixelIcon name="home-2" className="h-5 w-5" />
                </span>
                {mode === 'edit' ? 'edit project' : 'create project'}
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
              {mode === 'create' && (
                <div>
                  <span className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">project source</span>
                  <div role="radiogroup" aria-label="Project Source" className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={sourceType === 'local'}
                      onClick={() => { setSourceType('local'); setError(''); }}
                      className={[
                        'flex h-11 items-center justify-center gap-2 rounded-full border-2 font-display text-sm transition-all [text-transform:lowercase]',
                        sourceType === 'local'
                          ? 'sticker-sm border-ink'
                          : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                      ].join(' ')}
                      style={sourceType === 'local' ? { backgroundColor: 'var(--color-neon-green)', color: 'var(--color-ink)' } : undefined}
                    >
                      <PixelIcon name="floppy-disk" className="h-4 w-4" />
                      local path
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={sourceType === 'repo'}
                      onClick={() => { setSourceType('repo'); setError(''); }}
                      className={[
                        'flex h-11 items-center justify-center gap-2 rounded-full border-2 font-display text-sm transition-all [text-transform:lowercase]',
                        sourceType === 'repo'
                          ? 'sticker-sm border-ink'
                          : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                      ].join(' ')}
                      style={sourceType === 'repo' ? { backgroundColor: 'var(--color-neon-green)', color: 'var(--color-ink)' } : undefined}
                    >
                      <PixelIcon name="global-public" className="h-4 w-4" />
                      github url
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="project-name" className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                  project name
                </label>
                <input
                  id="project-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameTouched(true);
                    setError('');
                  }}
                  placeholder={mode === 'create' ? 'Defaults to the folder/repo name' : 'Project name'}
                  autoFocus
                  className="h-11 w-full rounded-xl border-2 border-border bg-card px-3 text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                />
              </div>

              {showRepoField && (
                <div>
                  <label htmlFor="project-repo-url" className="mb-1.5 flex items-center gap-1.5 font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                    <PixelIcon name="global-public" className="h-3.5 w-3.5" />
                    repository url
                  </label>
                  <input
                    id="project-repo-url"
                    value={repoUrl}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder="https://github.com/owner/repo.git"
                    className="h-11 w-full rounded-xl border-2 border-border bg-card px-3 font-mono text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground/70">
                    {mode === 'create'
                      ? 'The repo is cloned into your configured clone root on create.'
                      : 'Source URL the repo was cloned from (metadata only).'}
                  </p>
                </div>
              )}

              {showLocalFields && (
                <div>
                  <label htmlFor="project-repo-path" className="mb-1.5 flex items-center gap-1.5 font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                    <PixelIcon name="floppy-disk" className="h-3.5 w-3.5" />
                    local path
                  </label>
                  <div className="flex gap-2.5">
                    <input
                      id="project-repo-path"
                      value={repoPath}
                      onChange={(e) => handlePathChange(e.target.value)}
                      onBlur={() => { void validatePath(repoPath); }}
                      placeholder={getRepoPathPlaceholder()}
                      className="h-11 min-w-0 flex-1 rounded-xl border-2 border-border bg-card px-3 font-mono text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                    />
                    <button
                      type="button"
                      onClick={handleSelectDirectory}
                      disabled={selectingDirectory}
                      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border-2 border-border px-3 font-pixel text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 [text-transform:lowercase]"
                    >
                      <PixelIcon name="open-book-bookmark" className="h-4 w-4" />
                      {selectingDirectory ? 'browsing…' : 'browse…'}
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground/70">{getRepoPathHelpText()}</p>
                  {pathStatus.kind !== 'idle' && (
                    <p
                      className={[
                        'mt-1.5 font-pixel text-[10px] [text-transform:lowercase]',
                        pathStatus.kind === 'validating' ? 'text-muted-foreground' : '',
                        pathStatus.kind === 'valid' ? 'text-neon-green' : '',
                        pathStatus.kind === 'warning' ? 'text-neon-yellow' : '',
                        pathStatus.kind === 'invalid' ? 'text-destructive' : '',
                      ].join(' ')}
                    >
                      {pathStatus.kind === 'validating' ? 'validating local path…' : pathStatus.message}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 rounded-xl border-2 border-destructive/40 bg-destructive/10 px-3 py-2.5 font-pixel text-[11px] text-destructive">
                  <PixelIcon name="alert-triangle-1" className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="space-y-4 rounded-2xl border-2 border-border bg-card/50 p-4">
                <p className="flex items-center gap-1.5 font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                  <PixelIcon name="settings-toggle-horizontal" className="h-3.5 w-3.5" />
                  task defaults
                  <span className="ml-1 text-muted-foreground/60">— applied to new tasks, overridable per task</span>
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="project-default-agent" className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                      default agent
                    </label>
                    <select
                      id="project-default-agent"
                      value={defaultAgentType}
                      onChange={(e) => setDefaultAgentType(e.target.value)}
                      className="h-11 w-full rounded-xl border-2 border-border bg-card px-3 text-sm focus:border-neon-pink focus:outline-none transition-colors"
                    >
                      <option value="">No default</option>
                      {AGENT_OPTIONS.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="project-default-priority" className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                      default priority
                    </label>
                    <select
                      id="project-default-priority"
                      value={defaultPriority}
                      onChange={(e) => setDefaultPriority(e.target.value)}
                      className="h-11 w-full rounded-xl border-2 border-border bg-card px-3 text-sm focus:border-neon-pink focus:outline-none transition-colors"
                    >
                      <option value="">No default</option>
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="project-default-base-branch" className="mb-1.5 flex items-center gap-1.5 font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                      <PixelIcon name="flag" className="h-3.5 w-3.5" />
                      default base branch
                    </label>
                    <input
                      id="project-default-base-branch"
                      value={defaultBaseBranch}
                      onChange={(e) => setDefaultBaseBranch(e.target.value)}
                      placeholder="No default"
                      className="h-11 w-full rounded-xl border-2 border-border bg-card px-3 font-mono text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label htmlFor="project-default-worktree" className="mb-1.5 flex items-center gap-1.5 font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                      <PixelIcon name="hierarchy-2" className="h-3.5 w-3.5" />
                      default worktree
                    </label>
                    <select
                      id="project-default-worktree"
                      value={defaultUseWorktree}
                      onChange={(e) => setDefaultUseWorktree(e.target.value as 'inherit' | 'true' | 'false')}
                      className="h-11 w-full rounded-xl border-2 border-border bg-card px-3 text-sm focus:border-neon-pink focus:outline-none transition-colors"
                    >
                      <option value="inherit">No default</option>
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </div>
                </div>
              </div>

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
                  {submitting
                    ? (mode === 'edit' ? 'saving…' : (sourceType === 'repo' ? 'cloning…' : 'creating…'))
                    : (mode === 'edit' ? 'save changes' : 'create project')}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
