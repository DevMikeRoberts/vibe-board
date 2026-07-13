import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentType, Priority } from '@/types';
import { MAX_GROUP_CHILDREN, MIN_GROUP_CHILDREN } from '@/types';
import { AGENT_OPTIONS } from '@/lib/agent-config';
import { PRIORITY_OPTIONS } from '@/lib/priority-config';
import { cn, getRepoPathHelpText, getRepoPathPlaceholder, isAbsoluteRepoPath } from '@/lib/utils';
import { getRecentRepoPaths, addRepoPath } from '@/lib/repo-history';
import { PixelIcon } from '@/components/PixelIcon';
import ParallelismSlider from './ParallelismSlider';
import type { CreateGroupChild, TaskGroupWithChildren } from '@/lib/api';

interface ChildRow {
  key: string; // React key
  title: string;
  description: string;
  agentType: AgentType;
}

interface TaskGroupDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    description?: string;
    priority: Priority;
    repoPath?: string;
    baseBranch?: string;
    maxConcurrency: number;
    children: CreateGroupChild[];
    autoRun?: boolean;
  }) => Promise<unknown>;
  editGroup?: TaskGroupWithChildren | null;
  onEditSubmit?: (id: string, updates: { title: string; description?: string; priority: Priority; maxConcurrency: number }) => Promise<unknown>;
  lockedRepoPath?: string;
  /** Project-level task defaults used to prefill create mode (each overridable). */
  projectDefaults?: {
    defaultAgentType?: AgentType;
    defaultPriority?: Priority;
    defaultBaseBranch?: string;
  };
}

const agents = AGENT_OPTIONS;
const priorities = PRIORITY_OPTIONS;

/** Shared shells for the midnight-arcade form controls. */
const fieldLabel = 'mb-1.5 block font-pixel text-[10px] lowercase text-muted-foreground';
const inputShell =
  'w-full h-11 rounded-xl border-2 border-border bg-card px-3 font-pixel text-[11px] text-foreground placeholder:text-muted-foreground focus:border-neon-pink focus:outline-none transition-colors';
const textareaShell =
  'w-full rounded-xl border-2 border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-neon-pink focus:outline-none transition-colors';

let nextKey = 0;
function makeRow(agentType: AgentType = 'copilot'): ChildRow {
  return { key: `child-${nextKey++}`, title: '', description: '', agentType };
}

export function TaskGroupDialog({ open, onClose, onSubmit, editGroup, onEditSubmit, lockedRepoPath, projectDefaults }: TaskGroupDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [repoPath, setRepoPath] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [maxConcurrency, setMaxConcurrency] = useState(2);
  const [children, setChildren] = useState<ChildRow[]>([makeRow(), makeRow()]);
  const [autoRun, setAutoRun] = useState(false);
  const [showPriority, setShowPriority] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pathError, setPathError] = useState('');

  const isEditMode = !!editGroup;
  const hasLockedRepoPath = !!lockedRepoPath;

  const defaultAgent = projectDefaults?.defaultAgentType ?? 'copilot';
  const defaultPriorityVal = projectDefaults?.defaultPriority ?? 'medium';
  const defaultBaseBranchVal = projectDefaults?.defaultBaseBranch ?? 'main';
  // Pre-populate in edit mode, reset when dialog closes
  useEffect(() => {
    if (editGroup && open) {
      setTitle(editGroup.title);
      setDescription(editGroup.description || '');
      setPriority(editGroup.priority);
      setRepoPath(lockedRepoPath || editGroup.repoPath || '');
      setBaseBranch(editGroup.baseBranch || 'main');
      setMaxConcurrency(editGroup.maxConcurrency);
      setChildren(editGroup.children.map((c) => ({
        key: `child-${nextKey++}`,
        title: c.title,
        description: c.description,
        agentType: c.agentType || 'copilot',
      })));
    } else if (open && !editGroup) {
      // Opening in create mode — prefill from project defaults (each overridable)
      setPriority(defaultPriorityVal);
      setBaseBranch(defaultBaseBranchVal);
      setChildren([
        makeRow(defaultAgent),
        makeRow(defaultAgent),
      ]);
    } else if (!open) {
      setTitle('');
      setDescription('');
      setPriority('medium');
      setRepoPath('');
      setBaseBranch('main');
      setMaxConcurrency(2);
      setChildren([makeRow(), makeRow()]);
      setAutoRun(false);
      setSubmitting(false);
      setPathError('');
    }
  }, [editGroup, open, lockedRepoPath, defaultAgent, defaultPriorityVal, defaultBaseBranchVal]);

  useEffect(() => {
    if (open && lockedRepoPath) {
      setRepoPath(lockedRepoPath);
      setPathError('');
    }
  }, [open, lockedRepoPath]);

  // Keep concurrency in range when children change
  useEffect(() => {
    if (maxConcurrency > children.length) setMaxConcurrency(children.length);
  }, [children.length, maxConcurrency]);

  const repoPathPlaceholder = getRepoPathPlaceholder();
  const repoPathHelpText = getRepoPathHelpText();

  async function handleSubmit() {
    if (!title.trim() || submitting) return;

    // Client-side path validation
    const trimmedPath = (lockedRepoPath || repoPath).trim();
    if (trimmedPath) {
      if (!isAbsoluteRepoPath(trimmedPath)) {
        setPathError('Path must be absolute (use /, ~, D:\\, or \\\\server\\share)');
        return;
      }
    }
    setPathError('');

    setSubmitting(true);
    try {
      if (isEditMode && onEditSubmit && editGroup) {
        const result = await onEditSubmit(editGroup.id, {
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          maxConcurrency,
        });
        if (result === undefined) return;
        onClose();
        return;
      }

      if (children.some((c) => !c.title.trim())) return;

      if (trimmedPath && !hasLockedRepoPath) addRepoPath(trimmedPath);
      const result = await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        repoPath: trimmedPath || undefined,
        baseBranch: baseBranch.trim() || undefined,
        maxConcurrency,
        children: children.map((c) => ({
          title: c.title.trim(),
          description: c.description.trim() || undefined,
          agentType: c.agentType,
        })),
        autoRun,
      });
      if (result === undefined) return;
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  function addChild() {
    if (children.length >= MAX_GROUP_CHILDREN) return;
    setChildren((prev) => [...prev, isEditMode ? makeRow() : makeRow(defaultAgent)]);
  }

  function removeChild(key: string) {
    if (children.length <= MIN_GROUP_CHILDREN) return;
    setChildren((prev) => prev.filter((c) => c.key !== key));
  }

  function updateChild(key: string, updates: Partial<ChildRow>) {
    setChildren((prev) => prev.map((c) => (c.key === key ? { ...c, ...updates } : c)));
  }

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-bg)] p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="panel-neon panel-neon-glow flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[1.75rem]"
            style={{ '--panel': 'var(--color-neon-purple)' } as React.CSSProperties}
            initial={{ opacity: 0, y: 24, scale: 0.92, rotate: -1 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, y: 24, scale: 0.92, rotate: -1 }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b-2 border-border px-6 py-5">
              <h2 className="flex items-center gap-2.5 font-display text-xl text-foreground [text-transform:lowercase]">
                <span className="sticker-sm flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--color-neon-purple)', color: 'var(--color-ink)' }}>
                  <PixelIcon name="layer" className="h-4.5 w-4.5" />
                </span>
                {isEditMode ? 'Edit Task Group' : 'Create Task Group'}
              </h2>
              <button
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-border bg-card font-pixel text-sm text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Group title */}
              <div>
                <label className={fieldLabel}>group title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Q2 Feature Sprint"
                  className={inputShell}
                  autoFocus
                />
              </div>

              {/* Description */}
              <div>
                <label className={fieldLabel}>description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional group description..."
                  rows={2}
                  className={textareaShell}
                />
              </div>

              {/* Priority + Repo + Branch row */}
              <div className="grid grid-cols-3 gap-3">
                {/* Priority dropdown */}
                <div className="relative">
                  <label className={fieldLabel}>priority</label>
                  <button
                    type="button"
                    onClick={() => setShowPriority(!showPriority)}
                    className="flex h-11 w-full items-center justify-between rounded-xl border-2 border-border bg-card px-3 font-pixel text-[11px] text-foreground transition-colors hover:border-foreground/40"
                  >
                    <span>{priorities.find((p) => p.value === priority)?.emoji} {priorities.find((p) => p.value === priority)?.label}</span>
                    <span aria-hidden="true" className={cn('text-muted-foreground transition-transform', showPriority && 'rotate-180')}>▾</span>
                  </button>
                  {showPriority && (
                    <div className="sticker absolute z-10 mt-1.5 w-full overflow-hidden rounded-xl bg-popover py-1.5">
                      {priorities.map((p) => (
                        <button
                          key={p.value}
                          onClick={() => { setPriority(p.value); setShowPriority(false); }}
                          className={cn('flex w-full items-center gap-2 px-3 py-2 font-pixel text-[11px] text-foreground hover:bg-accent transition-colors', priority === p.value && 'bg-accent')}
                        >
                          <span>{p.emoji}</span> {p.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Local path */}
                <div>
                  <label htmlFor="group-repo-path" className={fieldLabel}>local path</label>
                  <input
                    id="group-repo-path"
                    type="text"
                    value={repoPath}
                    onChange={(e) => {
                      if (hasLockedRepoPath) return;
                      setRepoPath(e.target.value);
                      setPathError('');
                    }}
                    placeholder={repoPathPlaceholder}
                    list={hasLockedRepoPath ? undefined : 'recent-group-repo-paths'}
                    readOnly={hasLockedRepoPath}
                    aria-readonly={hasLockedRepoPath}
                    className={cn(
                      inputShell,
                      hasLockedRepoPath
                        ? 'text-muted-foreground'
                        : pathError && 'border-destructive focus:border-destructive'
                    )}
                  />
                  {pathError && (
                    <p className="mt-1.5 font-pixel text-[10px] text-destructive">{pathError}</p>
                  )}
                  {!pathError && (
                    <p className="mt-1.5 font-pixel text-[10px] lowercase text-muted-foreground/70">
                      {hasLockedRepoPath ? 'Locked to this Project local path.' : repoPathHelpText}
                    </p>
                  )}
                  {!hasLockedRepoPath && (
                    <datalist id="recent-group-repo-paths">
                      {getRecentRepoPaths().map((p) => <option key={p} value={p} />)}
                    </datalist>
                  )}
                </div>

                {/* Base branch */}
                <div>
                  <label className={fieldLabel}>base branch</label>
                  <input
                    type="text"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    placeholder="main"
                    className={inputShell}
                  />
                </div>
              </div>

              {/* Parallelism slider */}
              <div>
                <label className={fieldLabel}>parallelism</label>
                <ParallelismSlider value={maxConcurrency} max={children.length} onChange={setMaxConcurrency} />
              </div>

              {/* Children */}
              <div>
                <label className="mb-2.5 flex items-center gap-1.5 font-pixel text-[10px] lowercase text-muted-foreground">
                  <PixelIcon name="layer" className="h-3.5 w-3.5 text-neon-purple" />
                  tasks ({children.length})
                </label>
                <div className="space-y-3">
                  {children.map((child, idx) => (
                    <div key={child.key} className="rounded-xl border-2 border-border bg-card p-4 space-y-2.5">
                      <div className="flex items-start gap-3">
                        <span className="mt-3 font-pixel text-[11px] text-neon-purple">{idx + 1}.</span>
                        <div className="flex-1 space-y-2.5">
                          {/* Title */}
                          <input
                            type="text"
                            value={child.title}
                            onChange={(e) => updateChild(child.key, { title: e.target.value })}
                            placeholder="Task title"
                            className="w-full h-10 rounded-xl border-2 border-border bg-background px-3 font-pixel text-[11px] text-foreground placeholder:text-muted-foreground focus:border-neon-pink focus:outline-none transition-colors"
                          />
                          {/* Description */}
                          <textarea
                            value={child.description}
                            onChange={(e) => updateChild(child.key, { description: e.target.value })}
                            placeholder="Task description (optional)"
                            rows={2}
                            className="w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-neon-pink focus:outline-none transition-colors"
                          />
                          {/* Agent row */}
                          <div className="flex items-center gap-3">
                            {/* Agent selector */}
                            <select
                              value={child.agentType}
                              onChange={(e) => updateChild(child.key, { agentType: e.target.value as AgentType })}
                              className="h-10 cursor-pointer rounded-xl border-2 border-border bg-background px-2 font-pixel text-[11px] text-foreground focus:border-neon-pink focus:outline-none transition-colors"
                            >
                              {agents.map((a) => (
                                <option key={a.value} value={a.value}>{a.emoji} {a.label}</option>
                              ))}
                            </select>
                            {/* Worktree toggle */}
                            <label className="flex cursor-pointer items-center gap-2 font-pixel text-[11px] lowercase text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={child.useWorktree}
                                onChange={(e) => updateChild(child.key, { useWorktree: e.target.checked })}
                                className="h-4 w-4 rounded border-border accent-primary"
                              />
                              Worktree
                            </label>
                          </div>
                        </div>
                        {/* Delete button */}
                        {children.length > MIN_GROUP_CHILDREN && (
                          <button
                            onClick={() => removeChild(child.key)}
                            className="mt-1.5 flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                          >
                            <PixelIcon name="bin" className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {children.length < MAX_GROUP_CHILDREN && (
                  <button
                    onClick={addChild}
                    className="mt-3 flex h-11 items-center gap-2 rounded-xl border-2 border-dashed border-border px-4 font-pixel text-[11px] lowercase text-muted-foreground transition-colors hover:border-neon-purple hover:text-foreground"
                  >
                    <span aria-hidden="true" className="text-sm leading-none">+</span> Add Task
                  </button>
                )}
              </div>

              {/* Auto-run checkbox */}
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={autoRun}
                  onChange={(e) => setAutoRun(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="font-pixel text-[11px] lowercase text-muted-foreground">Auto-run — start agents immediately after creating</span>
              </label>

              {/* Worktree warning */}
              {hasWorktreeWarning && (
                <div className="flex items-start gap-2.5 rounded-xl border-2 border-neon-yellow bg-[color-mix(in_srgb,var(--color-neon-yellow)_14%,var(--color-card))] px-4 py-3">
                  <PixelIcon name="alert-triangle-1" className="mt-0.5 h-4 w-4 shrink-0 text-neon-yellow" />
                  <p className="text-sm text-foreground">
                    {children.filter((c) => !c.useWorktree).length} task(s) have worktree disabled — they may conflict with other tasks modifying the same repo.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t-2 border-border px-6 py-4">
              <button
                onClick={onClose}
                className="flex h-11 items-center rounded-xl border-2 border-border bg-card px-4 font-pixel text-[11px] lowercase text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                Cancel
              </button>
              {isEditMode ? (
                <button
                  onClick={handleSubmit}
                  disabled={!title.trim() || submitting}
                  className="sticker-sm sticker-press flex h-11 items-center gap-2 rounded-full bg-primary px-4 font-display text-sm text-primary-foreground [text-transform:lowercase] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Saving…' : 'Save Changes'}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { setAutoRun(false); handleSubmit(); }}
                    disabled={!title.trim() || children.some((c) => !c.title.trim()) || submitting}
                    className="sticker-sm sticker-press flex h-11 items-center gap-2 rounded-full px-4 font-display text-sm [text-transform:lowercase] disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ backgroundColor: 'var(--color-neon-purple)', color: 'var(--color-ink)' }}
                  >
                    <PixelIcon name="layer" className="h-4 w-4" />
                    {submitting ? 'Creating…' : 'Create Group'}
                  </button>
                  <button
                    onClick={() => { setAutoRun(true); handleSubmit(); }}
                    disabled={!title.trim() || children.some((c) => !c.title.trim()) || submitting}
                    className="sticker-sm sticker-press flex h-11 items-center gap-2 rounded-full bg-primary px-4 font-display text-sm text-primary-foreground [text-transform:lowercase] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <PixelIcon name="flash" className="h-4 w-4" />
                    {submitting ? 'Creating…' : 'Create & Run'}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
