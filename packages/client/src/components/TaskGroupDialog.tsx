import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, ChevronDown, AlertTriangle } from 'lucide-react';
import type { AgentType, Priority } from '@/types';
import { MAX_GROUP_CHILDREN, MIN_GROUP_CHILDREN } from '@/types';
import { AGENT_DISPLAY } from '@/lib/agent-config';
import { PRIORITY_DISPLAY } from '@/lib/priority-config';
import { cn } from '@/lib/utils';
import ParallelismSlider from './ParallelismSlider';
import type { CreateGroupChild } from '@/lib/api';

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
  }) => void;
}

const agents: { value: AgentType; label: string; emoji: string }[] = (
  Object.entries(AGENT_DISPLAY) as [AgentType, { emoji: string; label: string }][]
).map(([value, { emoji, label }]) => ({ value, label, emoji }));

const priorities: { value: Priority; label: string; emoji: string }[] = (
  Object.entries(PRIORITY_DISPLAY) as [Priority, { emoji: string; label: string }][]
).map(([value, { emoji, label }]) => ({ value, label, emoji }));

let nextKey = 0;
function makeRow(): ChildRow {
  return { key: `child-${nextKey++}`, title: '', description: '', agentType: 'copilot', useWorktree: true };
}

export function TaskGroupDialog({ open, onClose, onSubmit }: TaskGroupDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [repoPath, setRepoPath] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [maxConcurrency, setMaxConcurrency] = useState(2);
  const [children, setChildren] = useState<ChildRow[]>([makeRow(), makeRow()]);
  const [autoRun, setAutoRun] = useState(false);
  const [showPriority, setShowPriority] = useState(false);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setPriority('medium');
      setRepoPath('');
      setBaseBranch('main');
      setMaxConcurrency(2);
      setChildren([makeRow(), makeRow()]);
      setAutoRun(false);
    }
  }, [open]);

  // Keep concurrency in range when children change
  useEffect(() => {
    if (maxConcurrency > children.length) setMaxConcurrency(children.length);
  }, [children.length, maxConcurrency]);

  const hasWorktreeWarning = children.length >= 2 && children.some((c) => !c.useWorktree);

  function handleSubmit() {
    if (!title.trim()) return;
    if (children.some((c) => !c.title.trim())) return;

    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      repoPath: repoPath.trim() || undefined,
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
    onClose();
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
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-700 px-6 py-4">
              <h2 className="text-lg font-semibold text-zinc-100">Create Task Group</h2>
              <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Group title */}
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-300">Group Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Q2 Feature Sprint"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
                  autoFocus
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-300">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional group description..."
                  rows={2}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* Priority + Repo + Branch row */}
              <div className="grid grid-cols-3 gap-3">
                {/* Priority dropdown */}
                <div className="relative">
                  <label className="mb-1 block text-sm font-medium text-zinc-300">Priority</label>
                  <button
                    type="button"
                    onClick={() => setShowPriority(!showPriority)}
                    className="flex w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
                  >
                    <span>{priorities.find((p) => p.value === priority)?.emoji} {priorities.find((p) => p.value === priority)?.label}</span>
                    <ChevronDown className="h-4 w-4 text-zinc-400" />
                  </button>
                  {showPriority && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-xl">
                      {priorities.map((p) => (
                        <button
                          key={p.value}
                          onClick={() => { setPriority(p.value); setShowPriority(false); }}
                          className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-700', priority === p.value && 'bg-zinc-700')}
                        >
                          <span>{p.emoji}</span> {p.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Repository path */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-300">Repository</label>
                  <input
                    type="text"
                    value={repoPath}
                    onChange={(e) => setRepoPath(e.target.value)}
                    placeholder="/host-projects/my-app"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {/* Base branch */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-300">Base Branch</label>
                  <input
                    type="text"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    placeholder="main"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Parallelism slider */}
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-300">Parallelism</label>
                <ParallelismSlider value={maxConcurrency} max={children.length} onChange={setMaxConcurrency} />
              </div>

              {/* Children */}
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">Tasks ({children.length})</label>
                <div className="space-y-3">
                  {children.map((child, idx) => (
                    <div key={child.key} className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-2 text-xs font-medium text-zinc-500">{idx + 1}.</span>
                        <div className="flex-1 space-y-2">
                          {/* Title */}
                          <input
                            type="text"
                            value={child.title}
                            onChange={(e) => updateChild(child.key, { title: e.target.value })}
                            placeholder="Task title"
                            className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
                          />
                          {/* Description */}
                          <textarea
                            value={child.description}
                            onChange={(e) => updateChild(child.key, { description: e.target.value })}
                            placeholder="Task description (optional)"
                            rows={2}
                            className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
                          />
                          {/* Agent + Worktree row */}
                          <div className="flex items-center gap-3">
                            {/* Agent selector */}
                            <select
                              value={child.agentType}
                              onChange={(e) => updateChild(child.key, { agentType: e.target.value as AgentType })}
                              className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-sm text-zinc-100"
                            >
                              {agents.map((a) => (
                                <option key={a.value} value={a.value}>{a.emoji} {a.label}</option>
                              ))}
                            </select>
                            {/* Worktree toggle */}
                            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-zinc-400">
                              <input
                                type="checkbox"
                                checked={child.useWorktree}
                                onChange={(e) => updateChild(child.key, { useWorktree: e.target.checked })}
                                className="rounded border-zinc-600"
                              />
                              Worktree
                            </label>
                          </div>
                        </div>
                        {/* Delete button */}
                        {children.length > MIN_GROUP_CHILDREN && (
                          <button
                            onClick={() => removeChild(child.key)}
                            className="mt-1 rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
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
                    className="mt-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-blue-400 hover:bg-zinc-800"
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
                  className="rounded border-zinc-600"
                />
                <span className="text-sm text-zinc-300">Auto-run — start agents immediately after creating</span>
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
            <div className="flex items-center justify-end gap-3 border-t border-zinc-700 px-6 py-4">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={() => { setAutoRun(false); handleSubmit(); }}
                disabled={!title.trim() || children.some((c) => !c.title.trim())}
                className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Create Group
              </button>
              <button
                onClick={() => { setAutoRun(true); handleSubmit(); }}
                disabled={!title.trim() || children.some((c) => !c.title.trim())}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Create & Run
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
