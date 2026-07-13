import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Task, TaskAttachment, ColumnId, AgentType, AgentInfo, Priority } from '@/types';
import { AGENT_OPTIONS } from '@/lib/agent-config';
import { PRIORITY_OPTIONS } from '@/lib/priority-config';
import { cn, getRepoPathHelpText, getRepoPathPlaceholder, isAbsoluteRepoPath, slugify } from '@/lib/utils';
import { getRecentRepoPaths, addRepoPath } from '@/lib/repo-history';
import { api } from '@/lib/api';
import { PixelIcon } from '@/components/PixelIcon';
import ImageUpload from './ImageUpload';

interface TaskDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (task: { title: string; description: string; priority: Priority; columnId: ColumnId; agentType: AgentType; autoRun?: boolean; repoPath?: string; branchName?: string; baseBranch?: string; useWorktree?: boolean }) => Promise<unknown>;
  /** When set, dialog is in edit mode with pre-populated fields */
  editTask?: Task | null;
  /** Called on save in edit mode */
  onEditSubmit?: (id: string, updates: { title: string; description: string; priority: Priority; agentType: AgentType; repoPath?: string; branchName?: string; baseBranch?: string; useWorktree?: boolean }) => Promise<unknown>;
  /** When true, highlight missing required fields (e.g. opened from Play button) */
  highlightRequired?: boolean;
  /** Project-level repo path that cannot be changed per task. */
  lockedRepoPath?: string;
  /** Project-level task defaults used to prefill create mode (each overridable). */
  projectDefaults?: {
    defaultAgentType?: AgentType;
    defaultPriority?: Priority;
    defaultBaseBranch?: string;
    defaultUseWorktree?: boolean;
  };
}

const agents = AGENT_OPTIONS;
const priorities = PRIORITY_OPTIONS;

/** Shared Midnight Arcade input shell. */
const inputShell =
  'w-full h-11 rounded-xl border-2 border-border bg-card px-3 font-pixel text-[11px] text-foreground placeholder:text-muted-foreground focus:border-neon-pink focus:outline-none transition-colors';

/** Label above inputs. */
const labelShell = 'mb-1.5 flex items-center gap-1.5 font-pixel text-[10px] lowercase text-muted-foreground';

export function TaskDialog({ open, onClose, onSubmit, editTask, onEditSubmit, highlightRequired, lockedRepoPath, projectDefaults }: TaskDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [agentType, setAgentType] = useState<AgentType>('copilot');
  const [showPriority, setShowPriority] = useState(false);
  const [showAgent, setShowAgent] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [repoPath, setRepoPath] = useState('');
  const [branchName, setBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [useWorktree, setUseWorktree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pathError, setPathError] = useState('');
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<TaskAttachment[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([]);

  const isEditMode = !!editTask;
  const hasLockedRepoPath = !!lockedRepoPath;

  const defaultAgent = projectDefaults?.defaultAgentType ?? 'copilot';
  const defaultPriority = projectDefaults?.defaultPriority ?? 'medium';
  const defaultBaseBranch = projectDefaults?.defaultBaseBranch ?? 'main';
  const defaultUseWorktree = projectDefaults?.defaultUseWorktree ?? false;

  // Pre-populate fields when editing
  useEffect(() => {
    if (editTask && open) {
      setTitle(editTask.title);
      setDescription(editTask.description);
      setPriority(editTask.priority || 'medium');
      setAgentType(editTask.agentType || 'copilot');
      setRepoPath(lockedRepoPath || editTask.repoPath || '');
      setBranchName(editTask.branchName || `task/${slugify(editTask.title)}`);
      setBaseBranch(editTask.baseBranch || 'main');
      setUseWorktree(editTask.useWorktree ?? false);
      // Load attachments from server
      api.getAttachments(editTask.id).then(setExistingAttachments).catch(() => setExistingAttachments([]));
      // Highlight missing path if opened via Play button
      if (highlightRequired && !editTask.repoPath) {
        setPathError('Local path is required to run the agent');
      }
    } else if (open && !editTask) {
      // Opening in create mode — prefill from project defaults (each overridable)
      setPriority(defaultPriority);
      setAgentType(defaultAgent);
      setBaseBranch(defaultBaseBranch);
      setUseWorktree(defaultUseWorktree);
    } else if (!open) {
      // Reset when dialog closes
      setTitle('');
      setDescription('');
      setPriority('medium');
      setAgentType('copilot');
      setShowPriority(false);
      setShowAgent(false);
      setAutoRun(false);
      setRepoPath('');
      setBranchName('');
      setBaseBranch('main');
      setUseWorktree(false);
      setSubmitting(false);
      setPathError('');
      setPendingImages([]);
      setExistingAttachments([]);
    }
  }, [editTask, open, highlightRequired, lockedRepoPath, defaultAgent, defaultPriority, defaultBaseBranch, defaultUseWorktree]);

  useEffect(() => {
    if (open && lockedRepoPath) {
      setRepoPath(lockedRepoPath);
      setPathError('');
    }
  }, [open, lockedRepoPath]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    api.getAgents()
      .then((result) => {
        if (cancelled) return;
        setAvailableAgents(result);

        const selectedInfo = result.find((agent) => agent.name === agentType);
        const firstAvailable = result.find((agent) => agent.available);
        // Don't auto-swap when the project configures a default agent — respect the choice.
        if (!editTask && !projectDefaults?.defaultAgentType && selectedInfo && !selectedInfo.available && firstAvailable) {
          setAgentType(firstAvailable.name);
        }
      })
      .catch(() => {
        if (!cancelled) setAvailableAgents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [open, editTask, agentType, projectDefaults?.defaultAgentType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;

    // Client-side path validation — required
    const trimmedPath = (lockedRepoPath || repoPath).trim();
    if (!trimmedPath) {
      setPathError('Local path is required');
      return;
    }
    if (!isAbsoluteRepoPath(trimmedPath)) {
      setPathError('Path must be absolute (use /, ~, D:\\, or \\\\server\\share)');
      return;
    }
    setPathError('');

    // Auto-generate branch name from title if using worktree and no custom name set
    const effectiveBranch = useWorktree
      ? (branchName.trim() || `task/${slugify(title.trim())}`)
      : undefined;

    const repoFields = {
      repoPath: trimmedPath,
      branchName: effectiveBranch,
      baseBranch: baseBranch.trim() || 'main',
      useWorktree,
    };

    setSubmitting(true);
    try {
      if (isEditMode && onEditSubmit) {
        if (!hasLockedRepoPath) addRepoPath(trimmedPath);
        const result = await onEditSubmit(editTask!.id, {
          title: title.trim(),
          description: description.trim(),
          priority,
          agentType,
          ...repoFields,
        });
        if (result === undefined) return; // Server error — keep dialog open
      } else {
        if (!hasLockedRepoPath) addRepoPath(trimmedPath);
        const result = await onSubmit({
          title: title.trim(),
          description: description.trim(),
          priority,
          columnId: autoRun ? 'in-progress' : 'backlog',
          agentType,
          autoRun: autoRun || undefined,
          ...repoFields,
        }) as Task | undefined;
        if (result === undefined) return; // Server error — keep dialog open

        // Upload pending images after task creation
        if (pendingImages.length > 0 && result?.id) {
          try {
            await api.uploadAttachments(result.id, pendingImages);
          } catch (uploadErr) {
            console.warn('Failed to upload images for new task', result.id, uploadErr);
          }
        }
      }

      // Success — reset and close
      setTitle('');
      setDescription('');
      setPriority(defaultPriority);
      setAgentType(defaultAgent);
      setAutoRun(false);
      setRepoPath('');
      setBranchName('');
      setBaseBranch(defaultBaseBranch);
      setUseWorktree(defaultUseWorktree);
      setPendingImages([]);
      setExistingAttachments([]);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  // Close dropdowns on outside click
  const priorityRef = useRef<HTMLDivElement>(null);
  const agentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showPriority && !showAgent) return;
    const handleClick = (e: MouseEvent) => {
      if (showPriority && priorityRef.current && !priorityRef.current.contains(e.target as Node)) {
        setShowPriority(false);
      }
      if (showAgent && agentRef.current && !agentRef.current.contains(e.target as Node)) {
        setShowAgent(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showPriority, showAgent]);

  const selectedAgent = agents.find((a) => a.value === agentType)!;
  const selectedPriority = priorities.find((p) => p.value === priority)!;
  const agentAvailability = new Map(availableAgents.map((agent) => [agent.name, agent]));
  const selectedAgentInfo = agentAvailability.get(agentType);
  const repoPathPlaceholder = getRepoPathPlaceholder();
  const repoPathHelpText = getRepoPathHelpText();

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[var(--overlay-bg)] backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Dialog — giant blue neon sticker panel */}
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 24, scale: 0.92, rotate: -1 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, y: 24, scale: 0.92, rotate: -1 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="sticker panel-neon fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-[1.75rem] bg-popover p-6"
            style={{ '--panel': 'var(--color-neon-blue)' } as React.CSSProperties}
          >
            {/* Header */}
            <div className="mb-5 flex items-center justify-between">
              <h2 className="flex items-center gap-2.5 font-display text-xl leading-none text-foreground [text-transform:lowercase]">
                <PixelIcon name="flash" className="h-5 w-5 text-neon-blue" />
                {isEditMode ? 'Edit Task' : 'Create Task'}
              </h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-border bg-card font-pixel text-sm text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-1 min-h-0 flex-col">
              <div className="space-y-4 overflow-y-auto flex-1 min-h-0 px-1">
              {/* Title */}
              <div>
                <label className={labelShell}>
                  title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="what needs to be done?"
                  autoFocus
                  className={inputShell}
                />
              </div>

              {/* Description */}
              <div>
                <label className={labelShell}>
                  description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="describe the task for the selected agent…"
                  rows={4}
                  className="w-full resize-none rounded-xl border-2 border-border bg-card px-3 py-2.5 font-pixel text-[11px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-neon-pink focus:outline-none transition-colors"
                />
              </div>

              {/* Image attachments */}
              <div>
                <label className={labelShell}>
                  <PixelIcon name="camera-1" className="h-3.5 w-3.5" />
                  images
                </label>
                <ImageUpload
                  taskId={isEditMode ? editTask!.id : undefined}
                  existing={existingAttachments}
                  onPendingChange={setPendingImages}
                  onAttachmentsChange={setExistingAttachments}
                />
              </div>

              {/* Priority */}
              <div className="relative" ref={priorityRef}>
                <label className={labelShell}>
                  priority
                </label>
                <button
                  type="button"
                  onClick={() => setShowPriority(!showPriority)}
                  className="flex h-11 w-full items-center justify-between rounded-xl border-2 border-border bg-card px-3 font-pixel text-[11px] text-foreground transition-colors hover:border-foreground/40"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-sm">{selectedPriority.emoji}</span>
                    {selectedPriority.label}
                  </span>
                  <span className={cn('font-pixel text-xs text-muted-foreground transition-transform', showPriority && 'rotate-180')}>▼</span>
                </button>

                <AnimatePresence>
                  {showPriority && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="sticker-sm absolute left-0 right-0 top-full z-10 mt-1.5 overflow-hidden rounded-xl bg-popover"
                    >
                      {priorities.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => {
                            setPriority(p.value);
                            setShowPriority(false);
                          }}
                          className={cn(
                            'flex h-11 w-full items-center gap-2 px-3 font-pixel text-[11px] text-foreground hover:bg-accent transition-colors',
                            priority === p.value && 'bg-accent'
                          )}
                        >
                          <span className="text-sm">{p.emoji}</span>
                          {p.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Agent */}
              <div className="relative" ref={agentRef}>
                <label className={labelShell}>
                  <PixelIcon name="chipset" className="h-3.5 w-3.5" />
                  agent
                </label>
                <button
                  type="button"
                  onClick={() => setShowAgent(!showAgent)}
                  className="flex h-11 w-full items-center justify-between rounded-xl border-2 border-border bg-card px-3 font-pixel text-[11px] text-foreground transition-colors hover:border-foreground/40"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-sm">{selectedAgent.emoji}</span>
                    {selectedAgent.label}
                    {selectedAgentInfo && !selectedAgentInfo.available && (
                      <span className="font-pixel text-[10px] text-destructive">unavailable</span>
                    )}
                  </span>
                  <span className={cn('font-pixel text-xs text-muted-foreground transition-transform', showAgent && 'rotate-180')}>▼</span>
                </button>

                <AnimatePresence>
                  {showAgent && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="sticker-sm absolute left-0 right-0 top-full z-10 mt-1.5 overflow-hidden rounded-xl bg-popover"
                    >
                      {agents.map((a) => {
                        const info = agentAvailability.get(a.value);
                        const unavailable = info?.available === false;
                        return (
                          <button
                            key={a.value}
                            type="button"
                            disabled={unavailable}
                            onClick={() => {
                              setAgentType(a.value);
                              setShowAgent(false);
                            }}
                            className={cn(
                              'flex h-11 w-full items-center gap-2 px-3 font-pixel text-[11px] text-foreground hover:bg-accent transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
                              agentType === a.value && 'bg-accent'
                            )}
                            title={unavailable ? info?.reason || `${a.label} is unavailable` : undefined}
                          >
                            <span className="text-sm">{a.emoji}</span>
                            <span className="flex-1 text-left">{a.label}</span>
                            {info && (
                              <span className={cn(
                                'font-pixel text-[10px]',
                                info.available ? 'text-neon-green' : 'text-destructive'
                              )}>
                                {info.available ? 'available' : info.reason || 'unavailable'}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Auto-run (create mode only) */}
              {!isEditMode && (
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={autoRun}
                    onChange={(e) => setAutoRun(e.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
                  />
                  <span className="font-pixel text-[11px] text-muted-foreground">
                    auto-run — start agent immediately after creating
                  </span>
                </label>
              )}

              {/* Repository configuration */}
              <div className="space-y-3.5 rounded-2xl border-2 border-border bg-muted/40 p-4">
                <div>
                  <label htmlFor="task-repo-path" className={labelShell}>
                    <PixelIcon name="global-public" className="h-3.5 w-3.5" />
                    local path <span className="text-destructive">*</span>
                  </label>
                    <input
                      id="task-repo-path"
                      type="text"
                      value={repoPath}
                      onChange={(e) => {
                        if (hasLockedRepoPath) return;
                        setRepoPath(e.target.value);
                        setPathError('');
                      }}
                      placeholder={repoPathPlaceholder}
                      list={hasLockedRepoPath ? undefined : 'task-recent-repo-paths'}
                      readOnly={hasLockedRepoPath}
                      aria-readonly={hasLockedRepoPath}
                      className={cn(
                        'w-full h-11 rounded-xl border-2 bg-card px-3 font-pixel text-[11px] placeholder:text-muted-foreground focus:outline-none transition-colors',
                        hasLockedRepoPath
                          ? 'border-border text-muted-foreground'
                          : pathError
                            ? 'border-destructive text-foreground focus:border-destructive'
                            : 'border-border text-foreground focus:border-neon-pink'
                      )}
                    />
                    {pathError && (
                      <p className="mt-1.5 font-pixel text-[10px] text-destructive">{pathError}</p>
                    )}
                    {!pathError && (
                      <p className="mt-1.5 font-pixel text-[10px] text-muted-foreground/70">
                        {hasLockedRepoPath ? 'Locked to this Project local path.' : repoPathHelpText}
                      </p>
                    )}
                    {!hasLockedRepoPath && (
                      <datalist id="task-recent-repo-paths">
                        {getRecentRepoPaths().map((p) => <option key={p} value={p} />)}
                      </datalist>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelShell}>
                        <PixelIcon name="flag" className="h-3.5 w-3.5" />
                        base branch
                      </label>
                      <input
                        type="text"
                        value={baseBranch}
                        onChange={(e) => setBaseBranch(e.target.value)}
                        placeholder="main"
                        className={inputShell}
                      />
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex cursor-pointer items-center gap-2 font-pixel text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={useWorktree}
                          onChange={(e) => setUseWorktree(e.target.checked)}
                          className="rounded border-border accent-primary"
                        />
                        use git worktree
                      </label>
                    </div>
                  </div>
                  {useWorktree && (
                    <div>
                      <label className={labelShell}>
                        <PixelIcon name="hierarchy-2" className="h-3.5 w-3.5" />
                        branch name
                      </label>
                      <input
                        type="text"
                        value={branchName}
                        onChange={(e) => setBranchName(e.target.value)}
                        placeholder={title.trim() ? `task/${slugify(title.trim())}` : 'task/my-feature'}
                        className={inputShell}
                      />
                      <p className="mt-1 font-pixel text-[10px] text-muted-foreground/70">leave blank to auto-generate from title</p>
                    </div>
                  )}
                </div>

              </div>

              {/* Actions */}
              <div className="mt-2 flex shrink-0 justify-end gap-2.5 border-t-2 border-border pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-11 items-center justify-center rounded-xl border-2 border-border bg-card px-4 font-pixel text-[11px] text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim() || submitting}
                  className="sticker-sm sticker-press flex h-11 items-center gap-2 rounded-full bg-primary px-5 font-display text-sm text-primary-foreground [text-transform:lowercase] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PixelIcon name="flash" className="h-4 w-4" />
                  {submitting ? 'Saving…' : isEditMode ? 'Save Changes' : 'Create Task'}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
