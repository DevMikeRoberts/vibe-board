import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Markdown from 'react-markdown';
import {
  X,
  Brain,
  FileCode2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Play,
  Square,
  GitBranch,
  ExternalLink,
  GitMerge,
  Trash2,
  Send,
  FileText,
  RotateCw,
  Download,
  Paperclip,
  Clock,
  Folder,
  Minimize2,
  Cog,
  Terminal,
  CalendarDays,
  GitPullRequest,
  Zap,
  Archive,
  Pencil,
} from 'lucide-react';
import type { Task, AgentEvent } from '@/types';
import { getAgentDisplay } from '@/lib/agent-config';
import { getPriorityDisplay } from '@/lib/priority-config';
import { TerminalView } from './TerminalView';
import { api, connectWS } from '@/lib/api';
import { cn, formatDuration } from '@/lib/utils';
import {
  eventIconMap,
  eventColorMap,
  eventLabelMap,
  coalesceEvents,
  looksLikeCode,
  deriveToolDetail,
  compactToolSummary,
  deriveFileChanges,
  type CoalescedEvent,
} from '@/lib/agent-events';

// ─── CopyButton ────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(timerRef.current); }, []);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }).catch((err) => console.warn('[clipboard] copy failed:', err));
  };
  return (
    <button
      onClick={handleCopy}
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ─── EventItem ─────────────────────────────────────────────────────────────

function EventItem({ event }: { event: CoalescedEvent }) {
  const [expanded, setExpanded] = useState(event.type !== 'thinking');
  const Icon = eventIconMap[event.type];
  const color = eventColorMap[event.type];
  const label = event.toolLabel
    ? event.toolLabel.charAt(0).toUpperCase() + event.toolLabel.slice(1)
    : eventLabelMap[event.type];

  const hasDiff = event.metadata?.diff;
  const hasFile = event.metadata?.file;

  const isToolDetailType =
    event.type === 'tool_call' ||
    event.type === 'file_read' ||
    event.type === 'file_write' ||
    event.type === 'file_edit';
  const toolDetail = isToolDetailType && !hasDiff ? deriveToolDetail(event.content) : null;

  const fileLabel =
    event.type === 'file_read' || event.type === 'file_write' || event.type === 'file_edit'
      ? event.metadata?.file
        ? event.metadata.file.split('/').pop() ?? null
        : null
      : null;
  const headerSummary = event.toolArgs
    ? event.toolArgs.length > 100
      ? event.toolArgs.slice(0, 100) + '...'
      : event.toolArgs
    : fileLabel ?? (isToolDetailType ? compactToolSummary(event.content) : null);

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'group',
        event.type === 'error' && 'rounded-lg border border-red-500/20 bg-red-500/5'
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent/50 transition-colors"
      >
        <div className={cn('mt-0.5 shrink-0', color)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">{label}</span>
            {headerSummary && (
              <span className="truncate text-[10px] text-muted-foreground font-mono">
                {headerSummary}
              </span>
            )}
            {!headerSummary && hasFile && (
              <span className="truncate text-[10px] text-muted-foreground font-mono">
                {event.metadata!.file}
              </span>
            )}
            <ChevronRight
              className={cn(
                'ml-auto h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform',
                expanded && 'rotate-90'
              )}
            />
          </div>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="ml-6 mr-2 mb-2">
              {(event.type === 'thinking' || event.type === 'complete' || event.type === 'error') &&
                (looksLikeCode(event.content) ? (
                  <div
                    className="rounded-md px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap"
                    style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-text)' }}
                  >
                    {event.content}
                  </div>
                ) : (
                  <p
                    className={cn(
                      'text-xs leading-relaxed whitespace-pre-wrap',
                      event.type === 'error'
                        ? 'font-mono text-red-700 dark:text-red-300'
                        : 'text-muted-foreground'
                    )}
                  >
                    {event.content}
                  </p>
                ))}

              {event.type === 'command' && event.content.startsWith('You: ') && (
                <div className="rounded-md bg-sky-500/10 border border-sky-500/20 px-2.5 py-1.5 text-xs text-sky-700 dark:text-sky-300">
                  {event.content}
                </div>
              )}

              {event.type === 'command' && !event.content.startsWith('You: ') && (
                <div
                  className="flex items-center gap-1 rounded-md px-2.5 py-1.5 font-mono text-xs"
                  style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-command)' }}
                >
                  <span className="text-muted-foreground select-none">$</span>
                  <span className="flex-1">{event.toolArgs || event.content}</span>
                  <CopyButton text={event.toolArgs || event.content} />
                </div>
              )}

              {event.type === 'output' &&
                (looksLikeCode(event.content) ? (
                  <div
                    className="rounded-md px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap"
                    style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-text)' }}
                  >
                    {event.content}
                  </div>
                ) : (
                  <div className="text-xs leading-relaxed text-foreground/70 whitespace-pre-wrap [&>*:first-child]:mt-0">
                    {event.content.split(/\n{2,}/).map((paragraph, i) => (
                      <p key={i} className={i > 0 ? 'mt-2.5 pt-2.5 border-t border-border/30' : ''}>
                        {paragraph}
                      </p>
                    ))}
                  </div>
                ))}

              {isToolDetailType && (
                <div className="space-y-1">
                  {hasFile && (
                    <div className="font-mono text-[11px] text-muted-foreground break-all">
                      {event.metadata!.file}
                    </div>
                  )}
                  {toolDetail && (
                    <div
                      className="flex items-start gap-1 rounded-md px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap"
                      style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-text)' }}
                    >
                      <span className="flex-1 overflow-x-auto">{toolDetail}</span>
                      <CopyButton text={toolDetail} />
                    </div>
                  )}
                </div>
              )}

              {hasDiff && (
                <div
                  className="mt-1 overflow-x-auto rounded-md p-2.5 font-mono text-[11px] leading-relaxed"
                  style={{ backgroundColor: 'var(--code-bg)' }}
                >
                  {event.metadata!.diff!.split('\n').map((line, i) => (
                    <div
                      key={i}
                      style={
                        line.startsWith('+') && !line.startsWith('++')
                          ? {
                              color: 'var(--code-diff-add-text)',
                              backgroundColor: 'var(--code-diff-add-bg)',
                            }
                          : line.startsWith('-') && !line.startsWith('--')
                          ? {
                              color: 'var(--code-diff-del-text)',
                              backgroundColor: 'var(--code-diff-del-bg)',
                            }
                          : { color: 'var(--code-diff-neutral)' }
                      }
                    >
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── FollowUpImagePreview ───────────────────────────────────────────────────

function FollowUpImagePreview({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <img src={url} alt={file.name} className="w-12 h-12 object-cover rounded border border-border" />
  );
}

// ─── InfoRow ────────────────────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
          {label}
        </div>
        <div className="text-xs text-foreground">{children}</div>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 mb-1.5 flex items-center gap-2">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">
        {children}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface TaskFullViewProps {
  task: Task | null;
  onClose: () => void;
  onMinimize?: () => void;
  onRun?: (id: string) => void;
  onStop?: (id: string) => void;
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  onArchive?: (task: Task) => void;
  onUnarchive?: (task: Task) => void;
  onCreatePR?: (id: string) => Promise<string | undefined>;
  onMergeLocal?: (id: string) => Promise<string | undefined>;
  onCleanupWorktree?: (id: string) => Promise<void>;
  onReconfigureRetry?: (id: string) => void;
  theme?: 'dark' | 'light';
}

export function TaskFullView({
  task,
  onClose,
  onMinimize,
  onRun,
  onStop,
  onEdit,
  onDelete,
  onArchive,
  onUnarchive,
  onCreatePR,
  onMergeLocal,
  onCleanupWorktree,
  onReconfigureRetry,
  theme,
}: TaskFullViewProps) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [mergeResult, setMergeResult] = useState<string | null>(null);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [followUpMessage, setFollowUpMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [followUpImages, setFollowUpImages] = useState<File[]>([]);
  const [showWorktreeConfirm, setShowWorktreeConfirm] = useState(false);
  const [hasRemote, setHasRemote] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<'events' | 'terminal' | 'changes' | 'summary'>(
    'events'
  );
  const userSelectedTabRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const taskId = task?.id ?? null;
  const agentStatus = task?.agentStatus;
  const agentDisplay = task?.agentType ? getAgentDisplay(task.agentType) : undefined;
  const priorityDisplay = task ? getPriorityDisplay(task.priority) : undefined;

  const errorEvents = useMemo(() => events.filter((e) => e.type === 'error'), [events]);
  const latestError = errorEvents[errorEvents.length - 1];
  const isActive = agentStatus === 'executing' || agentStatus === 'planning';

  // Load events + WS subscription
  useEffect(() => {
    if (!taskId) {
      setEvents([]);
      return;
    }
    setPrUrl(null);
    setPrLoading(false);
    setPrError(null);
    setMergeResult(null);
    setMergeLoading(false);
    setMergeError(null);
    setShowWorktreeConfirm(false);
    setHasRemote(null);
    setFollowUpMessage('');
    setSending(false);
    setFollowUpImages([]);
    userSelectedTabRef.current = false;

    api.getEvents(taskId).then(setEvents).catch(console.error);
    api
      .getGitInfo(taskId)
      .then((info) => setHasRemote(info.hasRemote))
      .catch(() => setHasRemote(false));

    const disconnect = connectWS((msg) => {
      if (msg.type === 'agent_event' && msg.payload.taskId === taskId) {
        setEvents((prev) => {
          if (msg.payload.id && prev.some((e) => e.id === msg.payload.id)) return prev;
          return [...prev, msg.payload];
        });
        if (msg.payload.type === 'complete' || msg.payload.type === 'error') {
          setStreaming(false);
        }
      }
      if (msg.type === 'agent_follow_up' && msg.payload.taskId === taskId) {
        const content = `You: ${msg.payload.message}`;
        setEvents((prev) => {
          if (prev.some((e) => e.type === 'command' && e.content === content)) return prev;
          return [
            ...prev,
            {
              id: `fu-ws-${Date.now()}`,
              taskId: taskId,
              type: 'command' as const,
              content,
              timestamp: Date.now(),
            },
          ];
        });
      }
    });

    return () => {
      disconnect();
      setStreaming(false);
    };
  }, [taskId]);

  // Sync streaming state
  useEffect(() => {
    if (!taskId) return;
    setStreaming(agentStatus === 'executing' || agentStatus === 'planning');
  }, [taskId, agentStatus]);

  // Auto-default tab
  const columnId = task?.columnId;
  useEffect(() => {
    if (!taskId || userSelectedTabRef.current) return;
    if (columnId === 'review' || columnId === 'done') {
      setActiveTab('summary');
    } else {
      setActiveTab('events');
    }
  }, [taskId, columnId]);

  // Auto-scroll events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const selectTab = (tab: typeof activeTab) => {
    userSelectedTabRef.current = true;
    setActiveTab(tab);
  };

  const coalescedEvents = useMemo(
    () => coalesceEvents(events, streaming),
    [events, streaming]
  );

  const fileChanges = useMemo(() => deriveFileChanges(events), [events]);

  const summaryText = task?.summary ?? null;
  const showSummaryTab = columnId === 'review' || columnId === 'done';

  const completedSectionFilled = useMemo(() => {
    if (!summaryText) return false;
    const m = summaryText.match(/##\s*Completed\s*\r?\n([\s\S]*?)(?:\r?\n##\s|$)/i);
    return !!(m && m[1].trim().length > 0);
  }, [summaryText]);

  const handleSendFollowUp = async () => {
    if (!task || (!followUpMessage.trim() && followUpImages.length === 0) || sending) return;
    const message = followUpMessage.trim();
    setSending(true);
    setFollowUpMessage('');
    const imagesToUpload = [...followUpImages];
    setFollowUpImages([]);

    const imageNote =
      imagesToUpload.length > 0
        ? ` [+${imagesToUpload.length} image${imagesToUpload.length > 1 ? 's' : ''}]`
        : '';
    setEvents((prev) => [
      ...prev,
      {
        id: `fu-${Date.now()}`,
        taskId: task.id,
        type: 'command' as const,
        content: `You: ${message || '(images only)'}${imageNote}`,
        timestamp: Date.now(),
      },
    ]);
    try {
      let attachmentIds: string[] | undefined;
      if (imagesToUpload.length > 0) {
        const uploaded = await api.uploadAttachments(task.id, imagesToUpload);
        attachmentIds = uploaded.map((a) => a.id);
      }
      await api.sendMessage(task.id, message || 'See the attached images.', attachmentIds);
    } catch (err) {
      console.error('[TaskFullView] failed to send follow-up:', err);
    } finally {
      setSending(false);
    }
  };

  const handleExportLog = () => {
    if (!task) return;
    const md = events
      .map((e) => {
        const label = eventLabelMap[e.type] || e.type;
        const meta = e.metadata?.file ? ` (${e.metadata.file})` : '';
        return `### ${label}${meta}\n${e.content}`;
      })
      .join('\n\n');
    const blob = new Blob([`# Agent Log — ${task.title}\n\n${md}`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-log-${task.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Formatted timestamps ─────────────────────────────────────────────

  const formatDate = (ts?: number) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const duration = useMemo(() => {
    if (task?.startedAt && task?.completedAt) {
      return formatDuration(task.completedAt - task.startedAt);
    }
    if (task?.startedAt && isActive) {
      return formatDuration(Date.now() - task.startedAt) + ' (running)';
    }
    return null;
  }, [task, isActive]);

  return (
    <AnimatePresence>
    {task && (
      <motion.div
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.99 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[80] flex flex-col bg-background"
      >
        {/* ── Top progress bar ── */}
        {(agentStatus === 'planning' || agentStatus === 'executing' || agentStatus === 'complete') && (
          <div className="h-0.5 w-full bg-muted shrink-0">
            <div
              className={cn(
                'h-full rounded-r transition-all duration-700 ease-in-out',
                agentStatus === 'complete'
                  ? 'w-full bg-emerald-500'
                  : agentStatus === 'executing'
                  ? 'w-3/5 bg-primary animate-pulse'
                  : 'w-1/4 bg-purple-500 animate-pulse'
              )}
            />
          </div>
        )}

        {/* ── Header bar ── */}
        <div className="shrink-0 flex items-center justify-between border-b border-border bg-card/80 backdrop-blur px-4 py-2.5">
          <div className="flex items-center gap-3 min-w-0">
            {/* Status dot */}
            <div
              className={cn(
                'h-2.5 w-2.5 rounded-full shrink-0',
                agentStatus === 'executing' && 'bg-blue-400 animate-pulse shadow-[0_0_6px_rgba(96,165,250,0.8)]',
                agentStatus === 'planning' && 'bg-purple-400 animate-pulse shadow-[0_0_6px_rgba(168,85,247,0.8)]',
                agentStatus === 'complete' && 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]',
                agentStatus === 'failed' && 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.8)]',
                agentStatus === 'idle' && 'bg-muted-foreground/40'
              )}
            />
            <h1 className="text-sm font-semibold text-foreground truncate max-w-lg">{task.title}</h1>
            {agentDisplay && (
              <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                {agentDisplay.emoji} {agentDisplay.label}
              </span>
            )}
            {isActive && (
              <span className="hidden md:flex items-center gap-1 text-[10px] text-primary shrink-0">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
                Live
              </span>
            )}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1.5 shrink-0 ml-4">
            {!isActive && agentStatus !== 'complete' && onRun && (
              <button
                onClick={() => onRun(task.id)}
                className="flex items-center gap-1.5 h-8 rounded-lg border border-border bg-muted px-3 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                title={agentStatus === 'failed' ? 'Retry agent' : 'Run agent'}
              >
                {agentStatus === 'failed' ? (
                  <RotateCw className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {agentStatus === 'failed' ? 'Retry' : 'Run'}
              </button>
            )}
            {isActive && onStop && (
              <button
                onClick={() => onStop(task.id)}
                className="flex items-center gap-1.5 h-8 rounded-lg border border-border bg-muted px-3 text-xs font-medium text-red-500 dark:text-red-400 hover:bg-red-500/20 transition-colors"
                title="Stop agent"
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </button>
            )}
            {onMinimize && (
              <button
                onClick={onMinimize}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                title="Collapse to panel"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:bg-destructive hover:text-white hover:border-destructive transition-colors"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* ── LEFT INFO PANEL ── */}
          <aside className="w-72 xl:w-80 shrink-0 flex flex-col border-r border-border bg-card/40 overflow-y-auto">
            <div className="p-4">

              {/* Status badge */}
              <div className="mb-3 flex items-center gap-2">
                {agentStatus === 'executing' && (
                  <span className="flex items-center gap-1.5 rounded-full bg-blue-500/10 border border-blue-500/25 px-2.5 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                    Executing
                  </span>
                )}
                {agentStatus === 'planning' && (
                  <span className="flex items-center gap-1.5 rounded-full bg-purple-500/10 border border-purple-500/25 px-2.5 py-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
                    Planning
                  </span>
                )}
                {agentStatus === 'complete' && (
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" />
                    Complete
                  </span>
                )}
                {agentStatus === 'failed' && (
                  <span className="flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/25 px-2.5 py-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
                    <AlertCircle className="h-3 w-3" />
                    Failed
                  </span>
                )}
                {agentStatus === 'idle' && (
                  <span className="flex items-center gap-1.5 rounded-full bg-muted/60 border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                    Idle
                  </span>
                )}
                {priorityDisplay && (
                  <span className="text-sm" title={`Priority: ${task.priority}`}>
                    {priorityDisplay.emoji}
                  </span>
                )}
              </div>

              {/* Description */}
              {task.description && (
                <div className="mb-3">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">
                    Description
                  </div>
                  <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-foreground/80 max-h-48 overflow-y-auto prose-sm dark:prose-invert">
                    <Markdown
                      allowedElements={[
                        'p', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li',
                        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'br',
                      ]}
                    >
                      {task.description}
                    </Markdown>
                  </div>
                </div>
              )}

              {/* ── Metadata ── */}
              <SectionHeader>Metadata</SectionHeader>
              <div className="space-y-0.5">
                {agentDisplay && (
                  <InfoRow icon={Zap} label="Agent">
                    <span className="flex items-center gap-1">
                      {agentDisplay.emoji} {agentDisplay.label}
                    </span>
                  </InfoRow>
                )}
                {priorityDisplay && (
                  <InfoRow icon={AlertCircle} label="Priority">
                    <span className="flex items-center gap-1">
                      {priorityDisplay.emoji} {priorityDisplay.label}
                    </span>
                  </InfoRow>
                )}
                <InfoRow icon={CalendarDays} label="Created">
                  {formatDate(task.createdAt)}
                </InfoRow>
                {task.startedAt && (
                  <InfoRow icon={Play} label="Started">
                    {formatDate(task.startedAt)}
                  </InfoRow>
                )}
                {task.completedAt && (
                  <InfoRow icon={CheckCircle2} label="Finished">
                    {formatDate(task.completedAt)}
                  </InfoRow>
                )}
                {duration && (
                  <InfoRow icon={Clock} label="Duration">
                    {duration}
                  </InfoRow>
                )}
                <InfoRow icon={Terminal} label="Events">
                  {events.length} recorded
                </InfoRow>
              </div>

              {/* ── Repository ── */}
              {(task.branchName || task.repoPath) && (
                <>
                  <SectionHeader>Repository</SectionHeader>
                  <div className="space-y-0.5">
                    {task.branchName && (
                      <InfoRow icon={GitBranch} label="Branch">
                        <span className="font-mono">{task.branchName}</span>
                        <span className="text-muted-foreground/60"> from </span>
                        <span className="font-mono">{task.baseBranch || 'main'}</span>
                      </InfoRow>
                    )}
                    {task.repoPath && (
                      <InfoRow icon={Folder} label="Repo Path">
                        <span className="font-mono break-all text-[10px]">{task.repoPath}</span>
                      </InfoRow>
                    )}
                    {task.worktreePath && (
                      <InfoRow icon={Folder} label="Worktree">
                        <span className="font-mono break-all text-[10px]">{task.worktreePath}</span>
                      </InfoRow>
                    )}
                  </div>
                </>
              )}

              {/* ── Pull Request ── */}
              {(task.agentStatus === 'complete' || task.columnId === 'done') && task.branchName && (
                <>
                  <SectionHeader>Pull Request</SectionHeader>
                  <div className="space-y-2">
                    {/* Existing PR link */}
                    {(prUrl ?? task.prUrl) && (
                      <a
                        href={prUrl ?? task.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                      >
                        <GitPullRequest className="h-3.5 w-3.5" />
                        View Pull Request
                        <ExternalLink className="h-3 w-3 ml-auto" />
                      </a>
                    )}

                    {/* Create PR */}
                    {!prUrl && !task.prUrl && onCreatePR && hasRemote === true && (
                      <button
                        onClick={async () => {
                          setPrLoading(true);
                          setPrError(null);
                          try {
                            const url = await onCreatePR(task.id);
                            if (url) setPrUrl(url);
                          } catch (err: unknown) {
                            setPrError((err as Error).message || 'Failed to create PR');
                          }
                          setPrLoading(false);
                        }}
                        disabled={prLoading}
                        className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {prLoading ? 'Creating PR…' : 'Create Pull Request'}
                      </button>
                    )}

                    {/* Merge */}
                    {!mergeResult && onMergeLocal && (
                      <button
                        onClick={async () => {
                          setMergeLoading(true);
                          setMergeError(null);
                          try {
                            const branch = await onMergeLocal(task.id);
                            if (branch) setMergeResult(branch);
                          } catch (err: unknown) {
                            setMergeError((err as Error).message || 'Failed to merge');
                          }
                          setMergeLoading(false);
                        }}
                        disabled={mergeLoading}
                        className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                      >
                        <GitMerge className="h-3.5 w-3.5" />
                        {mergeLoading ? 'Merging…' : `Merge to ${task.baseBranch || 'main'}`}
                      </button>
                    )}

                    {mergeResult && (
                      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-400">
                        <GitMerge className="h-3.5 w-3.5" />
                        Merged to {mergeResult}
                      </div>
                    )}

                    {/* Cleanup worktree */}
                    {task.worktreePath && onCleanupWorktree && !showWorktreeConfirm && (
                      <button
                        onClick={() => setShowWorktreeConfirm(true)}
                        className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Clean up worktree
                      </button>
                    )}

                    {showWorktreeConfirm && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                        <p className="text-xs font-medium text-amber-200 mb-1">Delete worktree?</p>
                        <p className="text-xs text-amber-300/80 mb-3">
                          Removes the worktree directory. Push your changes first if you haven't already.
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setShowWorktreeConfirm(false)}
                            className="rounded px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              setShowWorktreeConfirm(false);
                              onCleanupWorktree(task.id);
                            }}
                            className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}

                    {prError && (
                      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400 flex items-start justify-between gap-2">
                        <span className="font-mono">{prError}</span>
                        <button onClick={() => setPrError(null)} className="shrink-0 hover:text-red-300">✕</button>
                      </div>
                    )}
                    {mergeError && (
                      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400 flex items-start justify-between gap-2">
                        <span className="font-mono">{mergeError}</span>
                        <button onClick={() => setMergeError(null)} className="shrink-0 hover:text-red-300">✕</button>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ── Actions ── */}
              <SectionHeader>Actions</SectionHeader>
              <div className="space-y-1.5">
                {onEdit && !task.archived && (
                  <button
                    onClick={() => { onClose(); onEdit(task); }}
                    className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit Task
                  </button>
                )}
                {!isActive && agentStatus === 'failed' && onReconfigureRetry && (
                  <button
                    onClick={() => { onClose(); onReconfigureRetry(task.id); }}
                    className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-amber-500 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
                  >
                    <Cog className="h-3.5 w-3.5" />
                    Reconfigure &amp; Retry
                  </button>
                )}
                {onArchive && (task.columnId === 'done' || agentStatus === 'failed') && !task.archived && (
                  <button
                    onClick={() => { onArchive(task); onClose(); }}
                    className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archive Task
                  </button>
                )}
                {onUnarchive && task.archived && (
                  <button
                    onClick={() => { onUnarchive(task); onClose(); }}
                    className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Unarchive Task
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={() => { onDelete(task); onClose(); }}
                    className="flex w-full items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/15 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Task
                  </button>
                )}
              </div>
            </div>
          </aside>

          {/* ── RIGHT ACTIVITY PANEL ── */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Failure summary */}
            {agentStatus === 'failed' && (
              <div className="shrink-0 border-b border-border px-4 py-3">
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                        Agent failed
                      </p>
                      <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-red-700/80 dark:text-red-300/80">
                        {latestError?.content ||
                          'No error event was recorded. Use Reconfigure or Retry to capture details.'}
                      </p>
                    </div>
                    {latestError && <CopyButton text={latestError.content} />}
                  </div>
                </div>
              </div>
            )}

            {/* Tab bar */}
            <div className="shrink-0 flex items-center justify-between border-b border-border px-3 pt-1">
              <div className="flex gap-1">
                {showSummaryTab && (
                  <button
                    onClick={() => selectTab('summary')}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded-t transition-colors',
                      activeTab === 'summary'
                        ? 'bg-card border border-border border-b-card text-foreground -mb-px'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Summary
                  </button>
                )}
                <button
                  onClick={() => selectTab('events')}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-t transition-colors',
                    activeTab === 'events'
                      ? 'bg-card border border-border border-b-card text-foreground -mb-px'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Brain className="h-3 w-3" />
                    Thinking Chain
                    {events.length > 0 && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold">
                        {coalescedEvents.length}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  onClick={() => selectTab('terminal')}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-t transition-colors',
                    activeTab === 'terminal'
                      ? 'bg-card border border-border border-b-card text-foreground -mb-px'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Terminal className="h-3 w-3" />
                    Terminal
                  </span>
                </button>
                <button
                  onClick={() => selectTab('changes')}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-t transition-colors',
                    activeTab === 'changes'
                      ? 'bg-card border border-border border-b-card text-foreground -mb-px'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <FileCode2 className="h-3 w-3" />
                    File Changes
                    {fileChanges.length > 0 && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold">
                        {fileChanges.length}
                      </span>
                    )}
                  </span>
                </button>
              </div>
              {events.length > 0 && (
                <button
                  onClick={handleExportLog}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  title="Download event log as markdown"
                >
                  <Download className="h-3 w-3" />
                  Export
                </button>
              )}
            </div>

            {/* ── Summary tab ── */}
            {activeTab === 'summary' && (
              <div className="flex-1 overflow-y-auto p-6">
                {summaryText ? (
                  <>
                    {!completedSectionFilled && (
                      <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        The required "Completed" section is empty or missing.
                      </div>
                    )}
                    <div className="prose prose-sm dark:prose-invert max-w-none text-foreground [&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2:first-child]:mt-0">
                      <Markdown>{summaryText}</Markdown>
                    </div>
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <FileText className="mx-auto h-12 w-12 text-muted-foreground/20" />
                      <p className="mt-3 text-sm text-muted-foreground/50">
                        No summary was provided for this task.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Events / Thinking Chain tab ── */}
            {activeTab === 'events' && (
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-0.5">
                {coalescedEvents.length === 0 && !streaming && agentStatus === 'failed' && !latestError && (
                  <div className="flex h-full items-center justify-center p-4">
                    <div className="w-full max-w-sm rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-center">
                      <AlertCircle className="mx-auto h-10 w-10 text-red-500/80 dark:text-red-400/80" />
                      <p className="mt-3 text-sm font-medium text-red-700 dark:text-red-300">
                        Agent failed — no events recorded
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-red-700/70 dark:text-red-300/70">
                        Use Reconfigure or Retry to run again and capture details.
                      </p>
                    </div>
                  </div>
                )}
                {coalescedEvents.length === 0 && !streaming && agentStatus !== 'failed' && (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <Brain className="mx-auto h-12 w-12 text-muted-foreground/20" />
                      <p className="mt-3 text-sm text-muted-foreground/50">No agent activity yet</p>
                      <p className="mt-1 text-xs text-muted-foreground/30">
                        Start the agent to see the thinking chain
                      </p>
                    </div>
                  </div>
                )}
                {coalescedEvents.map((event) => (
                  <EventItem key={event.id} event={event} />
                ))}
                {streaming && coalescedEvents.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-2 px-2 py-2"
                  >
                    <div className="flex gap-1">
                      {[0, 0.2, 0.4].map((delay) => (
                        <motion.div
                          key={delay}
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ repeat: Infinity, duration: 1.2, delay }}
                          className="h-1.5 w-1.5 rounded-full bg-primary"
                        />
                      ))}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      Agent is thinking…
                    </span>
                  </motion.div>
                )}
              </div>
            )}

            {/* ── Terminal tab ── */}
            {activeTab === 'terminal' && (
              <div
                className={cn(
                  'flex-1 overflow-hidden',
                  theme === 'light' ? 'bg-[#f8fafc]' : 'bg-[#0f172a]'
                )}
              >
                <TerminalView events={events} streaming={streaming} theme={theme} />
              </div>
            )}

            {/* ── File Changes tab ── */}
            {activeTab === 'changes' && (
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {fileChanges.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <FileCode2 className="mx-auto h-12 w-12 text-muted-foreground/20" />
                      <p className="mt-3 text-sm text-muted-foreground/50">No file changes yet</p>
                    </div>
                  </div>
                ) : (
                  fileChanges.map((file) => (
                    <details key={file.path} className="group rounded-lg border border-border bg-card">
                      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm hover:bg-accent/50">
                        <span>
                          {file.type === 'created' ? '🟢' : file.type === 'modified' ? '🟡' : '📖'}
                        </span>
                        <span
                          className="flex-1 font-mono text-xs text-foreground truncate"
                          title={file.path}
                        >
                          {file.path}
                        </span>
                        <span className="text-[10px] text-muted-foreground capitalize shrink-0">
                          {file.type}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-open:rotate-180 transition-transform" />
                      </summary>
                      <div className="border-t border-border px-3 py-2.5 overflow-x-auto">
                        {file.diff ? (
                          <div
                            className="rounded-md p-2.5 font-mono text-[11px] leading-relaxed"
                            style={{ backgroundColor: 'var(--code-bg)' }}
                          >
                            {file.diff.split('\n').map((line, i) => (
                              <div
                                key={i}
                                style={
                                  line.startsWith('+') && !line.startsWith('++')
                                    ? {
                                        color: 'var(--code-diff-add-text)',
                                        backgroundColor: 'var(--code-diff-add-bg)',
                                      }
                                    : line.startsWith('-') && !line.startsWith('--')
                                    ? {
                                        color: 'var(--code-diff-del-text)',
                                        backgroundColor: 'var(--code-diff-del-bg)',
                                      }
                                    : { color: 'var(--code-diff-neutral)' }
                                }
                              >
                                {line}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                            {file.content}
                          </pre>
                        )}
                      </div>
                    </details>
                  ))
                )}
              </div>
            )}

            {/* ── Message composer (bottom) ── */}
            <div className="shrink-0 border-t border-border bg-card px-4 py-3">
              {followUpImages.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2.5">
                  {followUpImages.map((f, i) => (
                    <div key={i} className="relative group">
                      <FollowUpImagePreview file={f} />
                      <button
                        type="button"
                        onClick={() => setFollowUpImages((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={agentStatus !== 'executing' || sending}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Attach images"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) {
                      setFollowUpImages((prev) => [...prev, ...Array.from(e.target.files!)]);
                      e.target.value = '';
                    }
                  }}
                />
                <input
                  type="text"
                  value={followUpMessage}
                  onChange={(e) => setFollowUpMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendFollowUp();
                    }
                  }}
                  placeholder={
                    agentStatus === 'executing'
                      ? 'Send a message to the agent… (Enter to send)'
                      : 'Messages can only be sent while the agent is running'
                  }
                  disabled={agentStatus !== 'executing' || sending}
                  className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40 disabled:cursor-not-allowed"
                />
                <button
                  onClick={handleSendFollowUp}
                  disabled={
                    agentStatus !== 'executing' ||
                    sending ||
                    (!followUpMessage.trim() && followUpImages.length === 0)
                  }
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Send message (Enter)"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground/40 text-center">
                {agentStatus === 'executing'
                  ? 'Your message will be injected into the running agent session'
                  : 'Start the agent to enable messaging'}
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    )}
    </AnimatePresence>
  );
}
