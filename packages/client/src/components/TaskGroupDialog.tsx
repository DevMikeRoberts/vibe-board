import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PixelIcon } from './PixelIcon';
import type { AgentType, Priority } from '@/types';
import { MAX_GROUP_CHILDREN, MIN_GROUP_CHILDREN } from '@/types';
import { AGENT_OPTIONS } from '@/lib/agent-config';
import { PRIORITY_OPTIONS } from '@/lib/priority-config';
import { cn, getRepoPathHelpText, getRepoPathPlaceholder, isAbsoluteRepoPath, isCoarsePointer } from '@/lib/utils';
import { getRecentRepoPaths, addRepoPath } from '@/lib/repo-history';
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
          className="fixed inset-0 z-[85] flex items-start justify-center bg-black/60 p-4 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="sticker flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[1.75rem] bg-popover"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground">{isEditMode ? 'Edit Task Group' : 'Create Task Group'}</h2>
              <button onClick={onClose} aria-label="Close" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Group title */}
              <div>
                <label className="mb-1 block text-sm font-medium text-muted-foreground">Group Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Q2 Feature Sprint"
                  className="h-11 w-full rounded-xl border-2 border-border bg-card px-3 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                  autoFocus={!isCoarsePointer()}
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1 block text-sm font-medium text-muted-foreground">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional group description..."
                  rows={2}
                  className="min-h-16 w-full resize-y rounded-xl border-2 border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                />
              </div>

              {/* Priority + Repo + Branch row */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {/* Priority dropdown */}
                <div className="relative">
                  <label className="mb-1 block text-sm font-medium text-muted-foreground">Priority</label>
                  <button
                    type="button"
                    onClick={() => setShowPriority(!showPriority)}
                    className="flex h-11 w-full items-center justify-between rounded-xl border-2 border-border bg-card px-3 text-sm hover:border-foreground/40 transition-colors"
                  >
                    <span>{priorities.find((p) => p.value === priority)?.emoji} {priorities.find((p) => p.value === priority)?.label}</span>
                    <span className={cn("shrink-0 font-pixel text-sm text-muted-foreground transition-transform", showPriority && "rotate-180")} aria-hidden="true">▾</span>
                  </button>
                  {showPriority && (
                    <div className="absolute z-10 mt-1 w-full rounded-xl border-2 border-border bg-popover py-1 shadow-xl">
                      {priorities.map((p) => (
                        <button
                          key={p.value}
                          onClick={() => { setPriority(p.value); setShowPriority(false); }}
                          className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-sm pointer-coarse:min-h-11 hover:bg-accent transition-colors', priority === p.value && 'bg-accent')}
                        >
                          <span>{p.emoji}</span> {p.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Local path */}
                <div>
                  <label htmlFor="group-repo-path" className="mb-1 block text-sm font-medium text-muted-foreground">Local Path</label>
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
                    className={`h-11 w-full rounded-xl border-2 bg-card px-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none transition-colors ${
                      hasLockedRepoPath
                        ? 'border-border text-muted-foreground'
                        : pathError ? 'border-red-500 focus:border-red-500' : 'border-border focus:border-primary'
                    }`}
                  />
                  {pathError && (
                    <p className="mt-1 text-xs text-destructive">{pathError}</p>
                  )}
                  {!pathError && (
                    <p className="mt-1 text-xs text-muted-foreground/60">
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
                  <label className="mb-1 block text-sm font-medium text-muted-foreground">Base Branch</label>
                  <input
                    type="text"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    placeholder="main"
                    className="h-11 w-full rounded-xl border-2 border-border bg-card px-3 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                  />
                </div>
              </div>

              {/* Parallelism slider */}
              <div>
                <label className="mb-1 block text-sm font-medium text-muted-foreground">Parallelism</label>
                <ParallelismSlider value={maxConcurrency} max={children.length} onChange={setMaxConcurrency} />
              </div>

              {/* Children */}
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">Tasks ({children.length})</label>
                <div className="space-y-3">
                  {children.map((child, idx) => (
                    <div key={child.key} className="rounded-xl border-2 border-border bg-card px-3 py-2.5 space-y-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-2 text-xs font-medium text-muted-foreground/60">{idx + 1}.</span>
                        <div className="flex-1 space-y-2">
                          {/* Title */}
                          <input
                            type="text"
                            value={child.title}
                            onChange={(e) => updateChild(child.key, { title: e.target.value })}
                            placeholder="Task title"
                            className="w-full rounded-lg border-2 border-border bg-card px-2 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                          />
                          {/* Description */}
                          <textarea
                            value={child.description}
                            onChange={(e) => updateChild(child.key, { description: e.target.value })}
                            placeholder="Task description (optional)"
                            rows={2}
                            className="w-full rounded-lg border-2 border-border bg-card px-2 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                          />
                          {/* Agent row */}
                          <div className="flex items-center gap-3">
                            {/* Agent selector */}
                            <select
                              value={child.agentType}
                              onChange={(e) => updateChild(child.key, { agentType: e.target.value as AgentType })}
                              className="rounded-lg border-2 border-border bg-card px-2 py-1 text-sm pointer-coarse:min-h-10"
                            >
                              {agents.map((a) => (
                                <option key={a.value} value={a.value}>{a.emoji} {a.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        {/* Delete button */}
                        {children.length > MIN_GROUP_CHILDREN && (
                          <button
                            onClick={() => removeChild(child.key)}
                            aria-label="Remove task"
                            className="mt-1 rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-destructive pointer-coarse:p-2.5"
                          >
                            <PixelIcon name="bin" className="h-5 w-5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {children.length < MAX_GROUP_CHILDREN && (
                  <button
                    onClick={addChild}
                    className="mt-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-primary hover:bg-accent pointer-coarse:min-h-10"
                  >
                    <PixelIcon name="flash" className="h-4 w-4" /> add task
                  </button>
                )}
              </div>

              {/* Auto-run checkbox */}
              <label className="flex cursor-pointer items-center gap-2.5 py-2">
                <input
                  type="checkbox"
                  checked={autoRun}
                  onChange={(e) => setAutoRun(e.target.checked)}
                  className="h-5 w-5 cursor-pointer rounded border-border accent-[var(--color-neon-pink)]"
                />
                <span className="text-sm text-muted-foreground">Auto-run — start agents immediately after creating</span>
              </label>
            </div>

            {/* Footer */}
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4 sm:gap-3">
              <button
                onClick={onClose}
                className="h-11 w-full rounded-lg px-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground sm:w-auto"
              >
                Cancel
              </button>
              {isEditMode ? (
                <button
                  onClick={handleSubmit}
                  disabled={!title.trim() || submitting}
                  className="h-11 w-full rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed sm:w-auto"
                >
                  {submitting ? 'Saving…' : 'Save Changes'}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { setAutoRun(false); handleSubmit(); }}
                    disabled={!title.trim() || children.some((c) => !c.title.trim()) || submitting}
                    className="h-11 w-full rounded-lg bg-muted px-4 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed sm:w-auto"
                  >
                    {submitting ? 'Creating…' : 'Create Group'}
                  </button>
                  <button
                    onClick={() => { setAutoRun(true); handleSubmit(); }}
                    disabled={!title.trim() || children.some((c) => !c.title.trim()) || submitting}
                    className="h-11 w-full rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed sm:w-auto"
                  >
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
