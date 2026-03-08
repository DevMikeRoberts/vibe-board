import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, ChevronDown, AlertTriangle } from 'lucide-react';
import type { AgentType, Priority } from '@/types';
import { MAX_GROUP_CHILDREN, MIN_GROUP_CHILDREN } from '@/types';
import { AGENT_OPTIONS } from '@/lib/agent-config';
import { PRIORITY_OPTIONS } from '@/lib/priority-config';
import { cn } from '@/lib/utils';
import { getRecentRepoPaths, addRepoPath } from '@/lib/repo-history';
import ParallelismSlider from './ParallelismSlider';
import type { CreateGroupChild, TaskGroupWithChildren } from '@/lib/api';

interface ChildRow {
  key: string; // React key
  title: string;
  description: string;
  agentType: AgentType;
  useWorktree: boolean;
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
}

const agents = AGENT_OPTIONS;
const priorities = PRIORITY_OPTIONS;

let nextKey = 0;
function makeRow(): ChildRow {
  return { key: `child-${nextKey++}`, title: '', description: '', agentType: 'copilot', useWorktree: true };
}

export function TaskGroupDialog({ open, onClose, onSubmit, editGroup, onEditSubmit }: TaskGroupDialogProps) {
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

  // Pre-populate in edit mode, reset when dialog closes
  useEffect(() => {
    if (editGroup && open) {
      setTitle(editGroup.title);
      setDescription(editGroup.description || '');
      setPriority(editGroup.priority);
      setRepoPath(editGroup.repoPath || '');
      setBaseBranch(editGroup.baseBranch || 'main');
      setMaxConcurrency(editGroup.maxConcurrency);
      setChildren(editGroup.children.map((c) => ({
        key: `child-${nextKey++}`,
        title: c.title,
        description: c.description,
        agentType: c.agentType || 'copilot',
        useWorktree: c.useWorktree ?? true,
      })));
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
  }, [editGroup, open]);

  // Keep concurrency in range when children change
  useEffect(() => {
    if (maxConcurrency > children.length) setMaxConcurrency(children.length);
  }, [children.length, maxConcurrency]);

  const hasWorktreeWarning = children.length >= 2 && children.some((c) => !c.useWorktree);

  async function handleSubmit() {
    if (!title.trim() || submitting) return;

    // Client-side path validation
    const trimmedPath = repoPath.trim();
    if (trimmedPath) {
      if (!trimmedPath.startsWith('/') && !trimmedPath.startsWith('~')) {
        setPathError('Path must be absolute (start with / or ~)');
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

      if (trimmedPath) addRepoPath(trimmedPath);
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
          useWorktree: c.useWorktree,
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
    setChildren((prev) => [...prev, makeRow()]);
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground">{isEditMode ? 'Edit Task Group' : 'Create Task Group'}</h2>
              <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Group title */}
              <div>
                <label className="mb-1 block text-sm font-medium text-muted-foreground">Group Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Q2 Feature Sprint"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                  autoFocus
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
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                />
              </div>

              {/* Priority + Repo + Branch row */}
              <div className="grid grid-cols-3 gap-3">
                {/* Priority dropdown */}
                <div className="relative">
                  <label className="mb-1 block text-sm font-medium text-muted-foreground">Priority</label>
                  <button
                    type="button"
                    onClick={() => setShowPriority(!showPriority)}
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-accent transition-colors"
                  >
                    <span>{priorities.find((p) => p.value === priority)?.emoji} {priorities.find((p) => p.value === priority)?.label}</span>
                    <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', showPriority && 'rotate-180')} />
                  </button>
                  {showPriority && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover py-1 shadow-xl">
                      {priorities.map((p) => (
                        <button
                          key={p.value}
                          onClick={() => { setPriority(p.value); setShowPriority(false); }}
                          className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors', priority === p.value && 'bg-accent')}
                        >
                          <span>{p.emoji}</span> {p.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Local path */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-muted-foreground">Local Path</label>
                  <input
                    type="text"
                    value={repoPath}
                    onChange={(e) => { setRepoPath(e.target.value); setPathError(''); }}
                    placeholder="/host-projects/my-app"
                    list="recent-group-repo-paths"
                    className={`w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none ${
                      pathError ? 'border-red-500 focus:border-red-500' : 'border-border focus:border-primary'
                    }`}
                  />
                  {pathError && (
                    <p className="mt-1 text-xs text-red-500">{pathError}</p>
                  )}
                  <datalist id="recent-group-repo-paths">
                    {getRecentRepoPaths().map((p) => <option key={p} value={p} />)}
                  </datalist>
                </div>

                {/* Base branch */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-muted-foreground">Base Branch</label>
                  <input
                    type="text"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    placeholder="main"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
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
                    <div key={child.key} className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-2 text-xs font-medium text-muted-foreground/60">{idx + 1}.</span>
                        <div className="flex-1 space-y-2">
                          {/* Title */}
                          <input
                            type="text"
                            value={child.title}
                            onChange={(e) => updateChild(child.key, { title: e.target.value })}
                            placeholder="Task title"
                            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                          />
                          {/* Description */}
                          <textarea
                            value={child.description}
                            onChange={(e) => updateChild(child.key, { description: e.target.value })}
                            placeholder="Task description (optional)"
                            rows={2}
                            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                          />
                          {/* Agent + Worktree row */}
                          <div className="flex items-center gap-3">
                            {/* Agent selector */}
                            <select
                              value={child.agentType}
                              onChange={(e) => updateChild(child.key, { agentType: e.target.value as AgentType })}
                              className="rounded border border-border bg-background px-2 py-1 text-sm"
                            >
                              {agents.map((a) => (
                                <option key={a.value} value={a.value}>{a.emoji} {a.label}</option>
                              ))}
                            </select>
                            {/* Worktree toggle */}
                            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={child.useWorktree}
                                onChange={(e) => updateChild(child.key, { useWorktree: e.target.checked })}
                                className="rounded border-border"
                              />
                              Worktree
                            </label>
                          </div>
                        </div>
                        {/* Delete button */}
                        {children.length > MIN_GROUP_CHILDREN && (
                          <button
                            onClick={() => removeChild(child.key)}
                            className="mt-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {children.length < MAX_GROUP_CHILDREN && (
                  <button
                    onClick={addChild}
                    className="mt-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-primary hover:bg-accent"
                  >
                    <Plus className="h-4 w-4" /> Add Task
                  </button>
                )}
              </div>

              {/* Auto-run checkbox */}
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={autoRun}
                  onChange={(e) => setAutoRun(e.target.checked)}
                  className="rounded border-border accent-primary"
                />
                <span className="text-sm text-muted-foreground">Auto-run — start agents immediately after creating</span>
              </label>

              {/* Worktree warning */}
              {hasWorktreeWarning && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <p className="text-sm text-amber-300">
                    {children.filter((c) => !c.useWorktree).length} task(s) have worktree disabled — they may conflict with other tasks modifying the same repo.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Cancel
              </button>
              {isEditMode ? (
                <button
                  onClick={handleSubmit}
                  disabled={!title.trim() || submitting}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Saving…' : 'Save Changes'}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { setAutoRun(false); handleSubmit(); }}
                    disabled={!title.trim() || children.some((c) => !c.title.trim()) || submitting}
                    className="rounded-lg bg-muted px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Creating…' : 'Create Group'}
                  </button>
                  <button
                    onClick={() => { setAutoRun(true); handleSubmit(); }}
                    disabled={!title.trim() || children.some((c) => !c.title.trim()) || submitting}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
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
