import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PixelIcon } from './PixelIcon';
import type { Task, TaskAttachment, ColumnId, AgentType, AgentInfo, Priority } from '@/types';
import { AGENT_OPTIONS } from '@/lib/agent-config';
import { PRIORITY_OPTIONS } from '@/lib/priority-config';
import { cn, getRepoPathHelpText, getRepoPathPlaceholder, isAbsoluteRepoPath, slugify } from '@/lib/utils';
import { getRecentRepoPaths, addRepoPath } from '@/lib/repo-history';
import { api } from '@/lib/api';
import ImageUpload from './ImageUpload';

interface TaskDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (task: { title: string; description: string; priority: Priority; columnId: ColumnId; agentType: AgentType; model?: string; autoRun?: boolean; repoPath?: string; branchName?: string; baseBranch?: string }) => Promise<unknown>;
  /** When set, dialog is in edit mode with pre-populated fields */
  editTask?: Task | null;
  /** Called on save in edit mode */
  onEditSubmit?: (id: string, updates: { title: string; description: string; priority: Priority; agentType: AgentType; model?: string; repoPath?: string; branchName?: string; baseBranch?: string }) => Promise<unknown>;
  /** When true, highlight missing required fields (e.g. opened from Play button) */
  highlightRequired?: boolean;
  /** Project-level repo path that cannot be changed per task. */
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

export function TaskDialog({ open, onClose, onSubmit, editTask, onEditSubmit, highlightRequired, lockedRepoPath, projectDefaults }: TaskDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [agentType, setAgentType] = useState<AgentType>('copilot');
  const [model, setModel] = useState<string | undefined>(undefined);
  const [showPriority, setShowPriority] = useState(false);
  const [showAgent, setShowAgent] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [repoPath, setRepoPath] = useState('');
  const [branchName, setBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
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

  // Pre-populate fields when editing
  useEffect(() => {
    if (editTask && open) {
      setTitle(editTask.title);
      setDescription(editTask.description);
      setPriority(editTask.priority || 'medium');
      setAgentType(editTask.agentType || 'copilot');
      setModel(editTask.model || undefined);
      setRepoPath(lockedRepoPath || editTask.repoPath || '');
      setBranchName(editTask.branchName || `task/${slugify(editTask.title)}`);
      setBaseBranch(editTask.baseBranch || 'main');
      // Load attachments from server
      api.getAttachments(editTask.id).then(setExistingAttachments).catch(() => setExistingAttachments([]));
      // Highlight missing path if opened via Play button
      if (highlightRequired && !editTask.repoPath) {
        setPathError('Local path is required to run the agent');
      }
    } else if (open && !editTask) {
      // Opening in create mode â prefill from project defaults (each overridable)
      setPriority(defaultPriority);
      setAgentType(defaultAgent);
      setModel(undefined);
      setBaseBranch(defaultBaseBranch);
    } else if (!open) {
      // Reset when dialog closes
      setTitle('');
      setDescription('');
      setPriority('medium');
      setAgentType('copilot');
      setModel(undefined);
      setShowPriority(false);
      setShowAgent(false);
      setAutoRun(false);
      setRepoPath('');
      setBranchName('');
      setBaseBranch('main');
      setSubmitting(false);
      setPathError('');
      setPendingImages([]);
      setExistingAttachments([]);
    }
  }, [editTask, open, highlightRequired, lockedRepoPath, defaultAgent, defaultPriority, defaultBaseBranch]);

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
        // Don't auto-swap when the project configures a default agent â respect the choice.
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

    // Client-side path validation â required
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

    const effectiveBranch = branchName.trim() || `task/${slugify(title.trim())}`;

    const repoFields = {
      repoPath: trimmedPath,
      branchName: effectiveBranch,
      baseBranch: baseBranch.trim() || 'main',
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
          model: model || undefined,
          ...repoFields,
        });
        if (result === undefined) return; // Server error â keep dialog open
      } else {
        if (!hasLockedRepoPath) addRepoPath(trimmedPath);
        const result = await onSubmit({
          title: title.trim(),
          description: description.trim(),
          priority,
          columnId: autoRun ? 'in-progress' : 'backlog',
          agentType,
          model: model || undefined,
          autoRun: autoRun || undefined,
          ...repoFields,
        }) as Task | undefined;
        if (result === undefined) return; // Server error â keep dialog open

        // Upload pending images after task creation
        if (pendingImages.length > 0 && result?.id) {
          try {
            await api.uploadAttachments(result.id, pendingImages);
          } catch (uploadErr) {
            console.warn('Failed to upload images for new task', result.id, uploadErr);
          }
        }
      }

      // Success â reset and close
      setTitle('');
      setDescription('');
      setPriority(defaultPriority);
      setAgentType(defaultAgent);
      setModel(undefined);
      setAutoRun(false);
      setRepoPath('');
      setBranchName('');
      setBaseBranch(defaultBaseBranch);
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

          {/* Dialog */}
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.92, y: 24, rotate: -1 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 24 }}
            transition={{ type: 'spring', damping: 22, stiffness: 320 }}
            className="sticker panel-neon fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] bg-popover p-6 max-h-[90vh] flex flex-col"
            style={{ '--panel': 'var(--color-neon-blue)' } as React.CSSProperties}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="flex items-center gap-2.5 font-display text-xl leading-none [text-transform:lowercase]">
                <span className="sticker-sm flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <PixelIcon name="flash" className="h-5 w-5" />
                </span>
                {isEditMode ? 'edit task' : 'create task'}
              </h2>
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-border font-pixel text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-1 min-h-0 flex-col">
              <div className="space-y-4 overflow-y-auto flex-1 min-h-0 px-1">
              {/* Title */}
              <div>
                <label className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What needs to be done?"
                  autoFocus
                  className="w-full h-11 rounded-xl border-2 border-border bg-card px-3 text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the task for the selected agent..."
                  rows={4}
                  className="w-full resize-none h-11 rounded-xl border-2 border-border bg-card px-3 text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                />
              </div>

              {/* Image attachments */}
              <div>
                <label className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                  Images
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
                <label className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                  Priority
                </label>
                <button
                  type="button"
                  onClick={() => setShowPriority(!showPriority)}
                  className="flex h-11 w-full items-center justify-between rounded-xl border-2 border-border bg-card px-3 text-sm hover:border-foreground/40 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span>{selectedPriority.emoji}</span>
                    {selectedPriority.label}
                  </span>
                  <span className={cn("shrink-0 font-pixel text-sm text-muted-foreground transition-transform", showPriority && "rotate-180")} aria-hidden="true">▾</span>
                </button>

                <AnimatePresence>
                  {showPriority && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border-2 border-border bg-popover shadow-xl"
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
                            'flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors',
                            priority === p.value && 'bg-accent'
                          )}
                        >
                          <span>{p.emoji}</span>
                          {p.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Agent */}
              <div className="relative" ref={agentRef}>
                <label className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                  Agent
                </label>
                <button
                  type="button"
                  onClick={() => setShowAgent(!showAgent)}
                  className="flex h-11 w-full items-center justify-between rounded-xl border-2 border-border bg-card px-3 text-sm hover:border-foreground/40 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span>{selectedAgent.emoji}</span>
                    {selectedAgent.label}
                    {selectedAgentInfo && !selectedAgentInfo.available && (
                      <span className="text-xs text-destructive">Unavailable</span>
                    )}
                  </span>
                  <span className={cn("shrink-0 font-pixel text-sm text-muted-foreground transition-transform", showAgent && "rotate-180")} aria-hidden="true">▾</span>
                </button>

                <AnimatePresence>
                  {showAgent && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border-2 border-border bg-popover shadow-xl"
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
                              'flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
                              agentType === a.value && 'bg-accent'
                            )}
                            title={unavailable ? info?.reason || `${a.label} is unavailable` : undefined}
                          >
                            <span>{a.emoji}</span>
                            <span className="flex-1 text-left">{a.label}</span>
                            {info && (
                              <span className={cn(
                                'text-[10px]',
                                info.available ? 'text-neon-green' : 'text-destructive'
                              )}>
                                {info.available ? 'Available' : info.reason || 'Unavailable'}
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
                    className="h-4 w-4 cursor-pointer rounded border-border accent-[var(--color-neon-pink)]"
                  />
                  <span className="text-sm text-muted-foreground">
                    Auto-run â start agent immediately after creating
                  </span>
                </label>
              )}

              {/* Model selection for Claude */}
              {agentType === 'claude' && (
                <div>
                  <label className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">Model</label>
                  <select
                    value={model ?? ''}
                    onChange={(e) => setModel(e.target.value || undefined)}
                    className="w-full h-11 rounded-xl border-2 border-border bg-card px-3 text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                  >
                    <option value="">Use provider default (CLAUDE_MODEL env)</option>
                    <option value="claude-opus-4-20250514">claude-opus-4-20250514</option>
                    <option value="claude-sonnet-4-20250514">claude-sonnet-4-20250514</option>
                    <option value="claude-haiku-4-20250414">claude-haiku-4-20250414</option>
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground/60">Claude model selection (overrides CLAUDE_MODEL env).</p>
                </div>
              )}

              {/* Model selection for OpenCode (local Ollama models) */}
              {agentType === 'opencode' && (
                <div>
                  <label className="mb-1.5 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">Model</label>
                  <select
                    value={model ?? ''}
                    onChange={(e) => setModel(e.target.value || undefined)}
                    className="w-full h-11 rounded-xl border-2 border-border bg-card px-3 text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                  >
                    <option value="">Use provider default</option>
                    <option value="qwen3:4B">ollama qwen3:4B</option>
                    <option value="qwen2.5-coder:7b-16k">qwen2.5-coder:7b-16k</option>
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground/60">Local Ollama model selection (OpenCode must point at your Ollama endpoint).</p>
                </div>
              )}

              {/* Repository configuration */}
              <div className="space-y-3 rounded-2xl border-2 border-border bg-card/50 p-4">
                <div>
                  <label htmlFor="task-repo-path" className="mb-1 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                    Local Path <span className="text-destructive">*</span>
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
                      className={`h-11 w-full rounded-xl border-2 bg-card px-3 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none transition-colors ${
                        hasLockedRepoPath
                          ? 'border-border text-muted-foreground'
                          : pathError ? 'border-destructive focus:border-destructive' : 'border-border focus:border-neon-pink'
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
                      <datalist id="task-recent-repo-paths">
                        {getRecentRepoPaths().map((p) => <option key={p} value={p} />)}
                      </datalist>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">Base Branch</label>
                      <input
                        type="text"
                        value={baseBranch}
                        onChange={(e) => setBaseBranch(e.target.value)}
                        placeholder="main"
                        className="w-full h-11 rounded-xl border-2 border-border bg-card px-3 text-sm placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">Branch Name</label>
                      <input
                        type="text"
                        value={branchName}
                        onChange={(e) => setBranchName(e.target.value)}
                        placeholder={title.trim() ? `task/${slugify(title.trim())}` : 'task/my-feature'}
                        className="h-11 w-full rounded-xl border-2 border-border bg-card px-3 text-sm font-mono placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60">
                    Each task creates a branch from the latest copy of the base branch. Leave the branch blank to auto-generate it from the title.
                  </p>
                </div>

              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-4 mt-2 border-t border-border shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-11 rounded-full border-2 border-border px-4 font-display text-sm text-foreground/80 hover:border-foreground/40 hover:text-foreground transition-colors [text-transform:lowercase]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim() || submitting}
                  className="sticker-sm sticker-press h-11 rounded-full bg-primary px-5 font-display text-sm text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed [text-transform:lowercase]"
                >
                  {submitting ? 'Savingâ¦' : isEditMode ? 'Save Changes' : 'Create Task'}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
