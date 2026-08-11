import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PixelIcon } from './PixelIcon';
import type { AgentType, Priority } from '@/types';
import { AGENT_OPTIONS } from '@/lib/agent-config';
import { PRIORITY_OPTIONS } from '@/lib/priority-config';
import { cn, getRepoPathHelpText, getRepoPathPlaceholder, isAbsoluteRepoPath, isCoarsePointer } from '@/lib/utils';
import { getRecentRepoPaths, addRepoPath } from '@/lib/repo-history';

interface SprintPlannerDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    sprintName: string;
    description: string;
    agentType: AgentType;
    repoPath?: string;
    baseBranch?: string;
    priority: Priority;
    projectId: string;
  }) => Promise<unknown>;
  lockedRepoPath?: string;
  projectId: string;
  projectDefaults?: {
    defaultAgentType?: AgentType;
    defaultPriority?: Priority;
    defaultBaseBranch?: string;
  };
}

const agents = AGENT_OPTIONS;
const priorities = PRIORITY_OPTIONS;

export function SprintPlannerDialog({
  open,
  onClose,
  onSubmit,
  lockedRepoPath,
  projectId,
  projectDefaults,
}: SprintPlannerDialogProps) {
  const [sprintName, setSprintName] = useState('');
  const [description, setDescription] = useState('');
  const [agentType, setAgentType] = useState<AgentType>(projectDefaults?.defaultAgentType ?? 'opencode');
  const [priority, setPriority] = useState<Priority>(projectDefaults?.defaultPriority ?? 'medium');
  const [repoPath, setRepoPath] = useState('');
  const [baseBranch, setBaseBranch] = useState(projectDefaults?.defaultBaseBranch ?? 'main');
  const [showPriority, setShowPriority] = useState(false);
  const [showAgent, setShowAgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pathError, setPathError] = useState('');

  const hasLockedRepoPath = !!lockedRepoPath;
  const defaultAgent = projectDefaults?.defaultAgentType ?? 'opencode';

  useEffect(() => {
    if (open) {
      setSprintName('');
      setDescription('');
      setAgentType(defaultAgent);
      setPriority(projectDefaults?.defaultPriority ?? 'medium');
      setRepoPath('');
      setBaseBranch(projectDefaults?.defaultBaseBranch ?? 'main');
      setSubmitting(false);
      setPathError('');
      setShowPriority(false);
      setShowAgent(false);
    }
  }, [open, defaultAgent, projectDefaults]);

  useEffect(() => {
    if (open && lockedRepoPath) {
      setRepoPath(lockedRepoPath);
      setPathError('');
    }
  }, [open, lockedRepoPath]);

  const repoPathPlaceholder = getRepoPathPlaceholder();
  const repoPathHelpText = getRepoPathHelpText();

  async function handleSubmit() {
    if (!sprintName.trim() || !description.trim() || submitting) return;

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
      if (trimmedPath && !hasLockedRepoPath) addRepoPath(trimmedPath);
      await onSubmit({
        sprintName: sprintName.trim(),
        description: description.trim(),
        agentType,
        repoPath: trimmedPath || undefined,
        baseBranch: baseBranch.trim() || undefined,
        priority,
        projectId,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
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
              <div className="flex items-center gap-3">
                <div
                  className="sticker-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: 'var(--color-neon-blue)', color: 'var(--color-ink)' }}
                >
                  <PixelIcon name="flag" className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Sprint Planner</h2>
                  <p className="text-xs text-muted-foreground">describe a sprint and let AI break it into tickets</p>
                </div>
              </div>
              <button onClick={onClose} aria-label="Close" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Sprint name */}
              <div>
                <label className="mb-1 block text-sm font-medium text-muted-foreground">Sprint Name</label>
                <input
                  type="text"
                  value={sprintName}
                  onChange={(e) => setSprintName(e.target.value)}
                  placeholder="e.g., Q2 Auth Overhaul"
                  className="h-11 w-full rounded-xl border-2 border-border bg-card px-3 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                  autoFocus={!isCoarsePointer()}
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1 block text-sm font-medium text-muted-foreground">Sprint Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the features, goals, and scope of this sprint. The AI agent will break this into individual tasks for the board..."
                  rows={6}
                  className="w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                />
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Be as detailed as possible. The AI agent will create individual tickets from this description.
                </p>
              </div>

              {/* Priority + Agent + Repo + Branch row */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Priority dropdown */}
                <div className="relative">
                  <label className="mb-1 block text-sm font-medium text-muted-foreground">Default Priority</label>
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

                {/* Agent type */}
                <div className="relative">
                  <label className="mb-1 block text-sm font-medium text-muted-foreground">Planning Agent</label>
                  <button
                    type="button"
                    onClick={() => setShowAgent(!showAgent)}
                    className="flex h-11 w-full items-center justify-between rounded-xl border-2 border-border bg-card px-3 text-sm hover:border-foreground/40 transition-colors"
                  >
                    <span>{agents.find((a) => a.value === agentType)?.emoji} {agents.find((a) => a.value === agentType)?.label}</span>
                    <span className={cn("shrink-0 font-pixel text-sm text-muted-foreground transition-transform", showAgent && "rotate-180")} aria-hidden="true">▾</span>
                  </button>
                  {showAgent && (
                    <div className="absolute z-10 mt-1 w-full rounded-xl border-2 border-border bg-popover py-1 shadow-xl">
                      {agents.map((a) => (
                        <button
                          key={a.value}
                          onClick={() => { setAgentType(a.value); setShowAgent(false); }}
                          className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-sm pointer-coarse:min-h-11 hover:bg-accent transition-colors', agentType === a.value && 'bg-accent')}
                        >
                          <span>{a.emoji}</span> {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Local path */}
                <div>
                  <label htmlFor="sprint-repo-path" className="mb-1 block text-sm font-medium text-muted-foreground">Local Path</label>
                  <input
                    id="sprint-repo-path"
                    type="text"
                    value={repoPath}
                    onChange={(e) => {
                      if (hasLockedRepoPath) return;
                      setRepoPath(e.target.value);
                      setPathError('');
                    }}
                    placeholder={repoPathPlaceholder}
                    list={hasLockedRepoPath ? undefined : 'recent-sprint-repo-paths'}
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
                    <datalist id="recent-sprint-repo-paths">
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
            </div>

            {/* Footer */}
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4 sm:gap-3">
              <button
                onClick={onClose}
                className="h-11 w-full rounded-lg px-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground sm:w-auto"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!sprintName.trim() || !description.trim() || submitting}
                className="sticker-sm sticker-press flex h-11 w-full items-center justify-center gap-2 rounded-full px-5 font-display text-sm sm:w-auto [text-transform:lowercase]"
                style={{ backgroundColor: 'var(--color-neon-blue)', color: 'var(--color-ink)' }}
              >
                <PixelIcon name="flag" className="h-4 w-4" />
                {submitting ? 'planning...' : 'plan sprint'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
