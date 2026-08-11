import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PixelIcon } from './PixelIcon';
import { isAbsoluteRepoPath, isCoarsePointer, getRepoPathHelpText, getRepoPathPlaceholder } from '@/lib/utils';
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
      const defaults = mode === 'edit'
        ? {
            defaultAgentType: (defaultAgentType || null) as AgentType | null,
            defaultPriority: (defaultPriority || null) as Priority | null,
            defaultBaseBranch: trimmedBaseBranch || null,
          }
        : {
            defaultAgentType: (defaultAgentType || undefined) as AgentType | undefined,
            defaultPriority: (defaultPriority || undefined) as Priority | undefined,
            defaultBaseBranch: trimmedBaseBranch || undefined,
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
            className="fixed inset-0 z-[85] bg-[var(--overlay-bg)] backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 z-[85] flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col sticker rounded-[1.75rem] bg-popover p-6"
          >
            <div className="mb-5 flex shrink-0 items-center justify-between">
              <h2 className="text-base font-semibold">{mode === 'edit' ? 'Edit Project' : 'Create Project'}</h2>
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-border font-pixel text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground pointer-coarse:h-10 pointer-coarse:w-10"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
              <div className="min-h-0 space-y-4 overflow-y-auto">
              {mode === 'create' && (
                <div>
                  <span className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">Project Source</span>
                  <div role="radiogroup" aria-label="Project Source" className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={sourceType === 'local'}
                      onClick={() => { setSourceType('local'); setError(''); }}
                      className={[
                        'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                        sourceType === 'local'
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border text-muted-foreground hover:bg-accent',
                      ].join(' ')}
                    >
                      <PixelIcon name="floppy-disk" className="h-4 w-4" />
                      Local Path
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={sourceType === 'repo'}
                      onClick={() => { setSourceType('repo'); setError(''); }}
                      className={[
                        'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                        sourceType === 'repo'
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border text-muted-foreground hover:bg-accent',
                      ].join(' ')}
                    >
                      <PixelIcon name="global-public" className="h-4 w-4" />
                      GitHub URL
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="project-name" className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                  Project Name
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
                  autoFocus={!isCoarsePointer()}
                  className="w-full h-11 rounded-xl border-2 border-border bg-card px-3 text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                />
              </div>

              {showRepoField && (
                <div>
                  <label htmlFor="project-repo-url" className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                    Repository URL
                  </label>
                  <input
                    id="project-repo-url"
                    value={repoUrl}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder="https://github.com/owner/repo.git"
                    className="w-full h-11 rounded-xl border-2 border-border bg-card px-3 font-mono text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                  />
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    {mode === 'create'
                      ? 'The repo is cloned into your configured clone root on create.'
                      : 'Source URL the repo was cloned from (metadata only).'}
                  </p>
                </div>
              )}

              {showLocalFields && (
                <div>
                  <label htmlFor="project-repo-path" className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                    Local Path
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="project-repo-path"
                      value={repoPath}
                      onChange={(e) => handlePathChange(e.target.value)}
                      onBlur={() => { void validatePath(repoPath); }}
                      placeholder={getRepoPathPlaceholder()}
                      className="min-w-0 flex-1 h-11 rounded-xl border-2 border-border bg-card px-3 font-mono text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                    />
                    <button
                      type="button"
                      onClick={handleSelectDirectory}
                      disabled={selectingDirectory}
                      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border-2 border-border px-3 font-pixel text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 [text-transform:lowercase]"
                    >
                      <PixelIcon name="open-book-bookmark" className="h-4 w-4" />
                      {selectingDirectory ? 'Browsingâ¦' : 'Browseâ¦'}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground/60">{getRepoPathHelpText()}</p>
                  {pathStatus.kind !== 'idle' && (
                    <p
                      className={[
                        'mt-1 text-xs',
                        pathStatus.kind === 'validating' ? 'text-muted-foreground' : '',
                        pathStatus.kind === 'valid' ? 'text-neon-green' : '',
                        pathStatus.kind === 'warning' ? 'text-neon-yellow' : '',
                        pathStatus.kind === 'invalid' ? 'text-destructive' : '',
                      ].join(' ')}
                    >
                      {pathStatus.kind === 'validating' ? 'Validating Local Pathâ¦' : pathStatus.message}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 rounded-xl border-2 border-destructive/40 bg-destructive/10 px-3 py-2.5 font-pixel text-[11px] text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-4 rounded-2xl border-2 border-border bg-card/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Task Defaults
                  <span className="ml-2 font-normal normal-case text-muted-foreground/50">applied to new tasks, overridable per task</span>
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="project-default-agent" className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                      Default Agent
                    </label>
                    <select
                      id="project-default-agent"
                      value={defaultAgentType}
                      onChange={(e) => setDefaultAgentType(e.target.value)}
                      className="h-11 w-full rounded-xl border-2 border-border bg-card px-3 text-sm focus:border-neon-pink focus:outline-none"
                    >
                      <option value="">No default</option>
                      {AGENT_OPTIONS.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="project-default-priority" className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                      Default Priority
                    </label>
                    <select
                      id="project-default-priority"
                      value={defaultPriority}
                      onChange={(e) => setDefaultPriority(e.target.value)}
                      className="h-11 w-full rounded-xl border-2 border-border bg-card px-3 text-sm focus:border-neon-pink focus:outline-none"
                    >
                      <option value="">No default</option>
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="project-default-base-branch" className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                      Default Base Branch
                    </label>
                    <input
                      id="project-default-base-branch"
                      value={defaultBaseBranch}
                      onChange={(e) => setDefaultBaseBranch(e.target.value)}
                      placeholder="No default"
                      className="w-full h-11 rounded-xl border-2 border-border bg-card px-3 font-mono text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                    />
                  </div>

                </div>
              </div>
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
                  {submitting
                    ? (mode === 'edit' ? 'Savingâ¦' : (sourceType === 'repo' ? 'Cloningâ¦' : 'Creatingâ¦'))
                    : (mode === 'edit' ? 'Save Changes' : 'Create Project')}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
