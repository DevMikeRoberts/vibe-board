import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Markdown from 'react-markdown';
import { PixelIcon } from '@/components/PixelIcon';
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

// ─── useMinWidth ───────────────────────────────────────────────────────────

function useMinWidth(px: number) {
  const [matches, setMatches] = useState(() => window.matchMedia(`(min-width: ${px}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [px]);
  return matches;
}

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
      className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors before:absolute before:-inset-2"
    >
      {copied
        ? <PixelIcon name="rating-star-1" className="h-3 w-3 text-neon-green" />
        : <PixelIcon name="clip-1" className="h-3 w-3" />}
    </button>
  );
}

// ─── EventItem ─────────────────────────────────────────────────────────────

function EventItem({ event }: { event: CoalescedEvent }) {
  const [expanded, setExpanded] = useState(event.type !== 'thinking');
  const iconName = eventIconMap[event.type];
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
        event.type === 'error' && 'rounded-xl border-2 border-destructive/40 bg-destructive/10'
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-accent/50 transition-colors"
      >
        <div className={cn('mt-0.5 shrink-0', color)}>
          <PixelIcon name={iconName} className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-pixel text-[11px] text-foreground">{label}</span>
            {headerSummary && (
              <span className="truncate font-pixel text-[10px] text-muted-foreground">
                {headerSummary}
              </span>
            )}
            {!headerSummary && hasFile && (
              <span className="truncate font-pixel text-[10px] text-muted-foreground">
                {event.metadata!.file}
              </span>
            )}
            <span
              className={cn(
                'ml-auto shrink-0 font-pixel text-xs text-muted-foreground/50 transition-transform',
                expanded && 'rotate-90'
              )}
              aria-hidden
            >
              ›
            </span>
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
                    className="rounded-lg px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap"
                    style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-text)' }}
                  >
                    {event.content}
                  </div>
                ) : (
                  <p
                    className={cn(
                      'text-xs leading-relaxed whitespace-pre-wrap',
                      event.type === 'error'
                        ? 'font-mono text-destructive'
                        : 'text-muted-foreground'
                    )}
                  >
                    {event.content}
                  </p>
                ))}

              {event.type === 'command' && event.content.startsWith('You: ') && (
                <div
                  className="rounded-lg border-2 border-neon-blue/30 px-2.5 py-1.5 text-xs text-foreground/90"
                  style={{ backgroundColor: 'color-mix(in oklab, var(--color-neon-blue) 12%, transparent)' }}
                >
                  {event.content}
                </div>
              )}

              {event.type === 'command' && !event.content.startsWith('You: ') && (
                <div
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-mono text-xs"
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
                    className="rounded-lg px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap"
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
                      className="flex items-start gap-1 rounded-lg px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap"
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
                  className="mt-1 overflow-x-auto rounded-lg p-2.5 font-mono text-[11px] leading-relaxed"
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
    <img src={url} alt={file.name} className="w-12 h-12 object-cover rounded-lg border-2 border-border" />
  );
}

// ─── InfoRow ────────────────────────────────────────────────────────────────

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <PixelIcon name={icon} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="font-pixel text-[10px] text-muted-foreground lowercase tracking-wide mb-0.5">
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
      <span className="font-pixel text-[10px] lowercase tracking-widest text-muted-foreground/60 px-1">
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
  const [hasRemote, setHasRemote] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'events' | 'terminal' | 'changes' | 'summary'>(
    'events'
  );
  const userSelectedTabRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMdUp = useMinWidth(768);
  const isSmUp = useMinWidth(640);

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

  // The mobile-only info tab disappears at md+ (the aside returns) — fall back to events
  useEffect(() => {
    if (isMdUp) {
      setActiveTab((tab) => (tab === 'info' ? 'events' : tab));
    }
  }, [isMdUp]);

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

  const tabButtonClass = (active: boolean) =>
    cn(
      'sticker-sm flex h-11 items-center gap-2 rounded-full px-4 font-display text-sm [text-transform:lowercase] transition-transform',
      active
        ? 'sticker-press'
        : 'border-2 border-border bg-card text-foreground/80 hover:border-foreground/40 hover:text-foreground'
    );
  const activeTabStyle = { backgroundColor: 'var(--color-neon-blue)', color: 'var(--color-ink)' };

  // Info panel content — rendered in the md+ aside AND in the mobile-only "info" tab
  const infoContent = task && (
    <div className="p-4">

      {/* Status badge */}
      <div className="mb-3 flex items-center gap-2">
        {agentStatus === 'executing' && (
          <span
            className="sticker-sm flex items-center gap-1.5 rounded-full px-2.5 py-1 font-pixel text-[10px] lowercase"
            style={{ backgroundColor: 'var(--color-neon-blue)', color: 'var(--color-ink)' }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-ink animate-pulse" />
            executing
          </span>
        )}
        {agentStatus === 'planning' && (
          <span
            className="sticker-sm flex items-center gap-1.5 rounded-full px-2.5 py-1 font-pixel text-[10px] lowercase"
            style={{ backgroundColor: 'var(--color-neon-purple)', color: 'var(--color-ink)' }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-ink animate-pulse" />
            planning
          </span>
        )}
        {agentStatus === 'complete' && (
          <span
            className="sticker-sm flex items-center gap-1.5 rounded-full px-2.5 py-1 font-pixel text-[10px] lowercase"
            style={{ backgroundColor: 'var(--color-neon-green)', color: 'var(--color-ink)' }}
          >
            <PixelIcon name="rating-star-1" className="h-3 w-3" />
            complete
          </span>
        )}
        {agentStatus === 'failed' && (
          <span
            className="sticker-sm flex items-center gap-1.5 rounded-full px-2.5 py-1 font-pixel text-[10px] lowercase"
            style={{ backgroundColor: 'var(--color-destructive)', color: 'var(--color-ink)' }}
          >
            <PixelIcon name="alert-triangle-1" className="h-3 w-3" />
            failed
          </span>
        )}
        {agentStatus === 'idle' && (
          <span className="flex items-center gap-1.5 rounded-full border-2 border-border bg-muted/60 px-2.5 py-1 font-pixel text-[10px] lowercase text-muted-foreground">
            idle
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
          <div className="font-pixel text-[10px] lowercase tracking-widest text-muted-foreground/60 mb-1.5">
            description
          </div>
          <div className="rounded-xl border-2 border-border/50 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-foreground/80 max-h-48 overflow-y-auto prose-sm dark:prose-invert">
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
      <SectionHeader>metadata</SectionHeader>
      <div className="space-y-0.5">
        {agentDisplay && (
          <InfoRow icon="chipset" label="Agent">
            <span className="flex items-center gap-1">
              {agentDisplay.emoji} {agentDisplay.label}
            </span>
          </InfoRow>
        )}
        {priorityDisplay && (
          <InfoRow icon="alert-triangle-1" label="Priority">
            <span className="flex items-center gap-1">
              {priorityDisplay.emoji} {priorityDisplay.label}
            </span>
          </InfoRow>
        )}
        <InfoRow icon="calendar-date" label="Created">
          {formatDate(task.createdAt)}
        </InfoRow>
        {task.startedAt && (
          <InfoRow icon="flash" label="Started">
            {formatDate(task.startedAt)}
          </InfoRow>
        )}
        {task.completedAt && (
          <InfoRow icon="rating-star-1" label="Finished">
            {formatDate(task.completedAt)}
          </InfoRow>
        )}
        {duration && (
          <InfoRow icon="clock" label="Duration">
            {duration}
          </InfoRow>
        )}
        <InfoRow icon="old-electronics" label="Events">
          {events.length} recorded
        </InfoRow>
      </div>

      {/* ── Repository ── */}
      {(task.branchName || task.repoPath) && (
        <>
          <SectionHeader>repository</SectionHeader>
          <div className="space-y-0.5">
            {task.branchName && (
              <InfoRow icon="hierarchy-2" label="Branch">
                <span className="font-mono">{task.branchName}</span>
                <span className="text-muted-foreground/60"> from </span>
                <span className="font-mono">{task.baseBranch || 'main'}</span>
              </InfoRow>
            )}
            {task.repoPath && (
              <InfoRow icon="global-public" label="Repo Path">
                <span className="font-mono break-all text-[10px]">{task.repoPath}</span>
              </InfoRow>
            )}
          </div>
        </>
      )}

      {/* ── Pull Request ── */}
      {(task.agentStatus === 'complete' || task.columnId === 'done') && task.branchName && (
        <>
          <SectionHeader>pull request</SectionHeader>
          <div className="space-y-2">
            {/* Existing PR link */}
            {(prUrl ?? task.prUrl) && (
              <a
                href={prUrl ?? task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="sticker-sm sticker-press flex items-center gap-2 rounded-xl px-3 py-2 font-pixel text-[11px] lowercase"
                style={{ backgroundColor: 'var(--color-neon-green)', color: 'var(--color-ink)' }}
              >
                <PixelIcon name="hyperlink" className="h-3.5 w-3.5" />
                view pull request
                <PixelIcon name="hyperlink" className="h-3 w-3 ml-auto" />
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
                className="flex w-full items-center gap-2 rounded-xl border-2 border-border bg-card px-3 py-2 font-pixel text-[11px] lowercase text-foreground/80 hover:border-foreground/40 hover:text-foreground transition-colors disabled:opacity-50"
              >
                <PixelIcon name="hyperlink" className="h-3.5 w-3.5" />
                {prLoading ? 'creating pr…' : 'create pull request'}
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
                className="flex w-full items-center gap-2 rounded-xl border-2 border-border bg-card px-3 py-2 font-pixel text-[11px] lowercase text-foreground/80 hover:border-foreground/40 hover:text-foreground transition-colors disabled:opacity-50"
              >
                <PixelIcon name="deal-handshake" className="h-3.5 w-3.5" />
                {mergeLoading ? 'merging…' : `merge to ${task.baseBranch || 'main'}`}
              </button>
            )}

            {mergeResult && (
              <div
                className="sticker-sm flex items-center gap-2 rounded-xl px-3 py-2 font-pixel text-[11px] lowercase"
                style={{ backgroundColor: 'var(--color-neon-green)', color: 'var(--color-ink)' }}
              >
                <PixelIcon name="deal-handshake" className="h-3.5 w-3.5" />
                merged to {mergeResult}
              </div>
            )}

            {prError && (
              <div className="rounded-xl border-2 border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive flex items-start justify-between gap-2">
                <span className="font-mono">{prError}</span>
                <button onClick={() => setPrError(null)} className="shrink-0 font-pixel hover:text-foreground" aria-label="Dismiss">✕</button>
              </div>
            )}
            {mergeError && (
              <div className="rounded-xl border-2 border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive flex items-start justify-between gap-2">
                <span className="font-mono">{mergeError}</span>
                <button onClick={() => setMergeError(null)} className="shrink-0 font-pixel hover:text-foreground" aria-label="Dismiss">✕</button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Actions ── */}
      <SectionHeader>actions</SectionHeader>
      <div className="space-y-1.5">
        {onEdit && !task.archived && (
          <button
            onClick={() => { onClose(); onEdit(task); }}
            className="flex w-full items-center gap-2 rounded-xl border-2 border-border bg-card px-3 py-2 font-pixel text-[11px] lowercase text-foreground/80 hover:border-foreground/40 hover:text-foreground transition-colors"
          >
            <PixelIcon name="quill-ink" className="h-3.5 w-3.5" />
            edit task
          </button>
        )}
        {!isActive && agentStatus === 'failed' && onReconfigureRetry && (
          <button
            onClick={() => { onClose(); onReconfigureRetry(task.id); }}
            className="flex w-full items-center gap-2 rounded-xl border-2 border-border bg-card px-3 py-2 font-pixel text-[11px] lowercase text-neon-yellow hover:border-neon-yellow/60 hover:text-neon-yellow transition-colors"
          >
            <PixelIcon name="cog-browser" className="h-3.5 w-3.5" />
            reconfigure &amp; retry
          </button>
        )}
        {onArchive && (task.columnId === 'done' || agentStatus === 'failed') && !task.archived && (
          <button
            onClick={() => { onArchive(task); onClose(); }}
            className="flex w-full items-center gap-2 rounded-xl border-2 border-border bg-card px-3 py-2 font-pixel text-[11px] lowercase text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors"
          >
            <PixelIcon name="floppy-disk" className="h-3.5 w-3.5" />
            archive task
          </button>
        )}
        {onUnarchive && task.archived && (
          <button
            onClick={() => { onUnarchive(task); onClose(); }}
            className="flex w-full items-center gap-2 rounded-xl border-2 border-border bg-card px-3 py-2 font-pixel text-[11px] lowercase text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors"
          >
            <PixelIcon name="floppy-disk" className="h-3.5 w-3.5" />
            unarchive task
          </button>
        )}
        {onDelete && (
          <button
            onClick={() => { onDelete(task); onClose(); }}
            className="flex w-full items-center gap-2 rounded-xl border-2 border-destructive/30 bg-destructive/10 px-3 py-2 font-pixel text-[11px] lowercase text-destructive hover:border-destructive/60 hover:bg-destructive/15 transition-colors"
          >
            <PixelIcon name="bin" className="h-3.5 w-3.5" />
            delete task
          </button>
        )}
      </div>
    </div>
  );

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
          <div className="h-2.5 w-full bg-ink shrink-0">
            <div
              className={cn(
                'h-full transition-all duration-700 ease-in-out',
                agentStatus === 'complete'
                  ? 'w-full bg-neon-green'
                  : agentStatus === 'executing'
                  ? 'w-3/5 bg-primary animate-pulse'
                  : 'w-1/4 bg-neon-purple animate-pulse'
              )}
            />
          </div>
        )}

        {/* ── Header bar ── */}
        <div className="shrink-0 flex items-center justify-between border-b-2 border-border bg-card px-4 py-2.5">
          <div className="flex items-center gap-3 min-w-0">
            {/* Status dot */}
            <div
              className={cn(
                'h-3 w-3 rounded-full shrink-0 border-2 border-ink',
                agentStatus === 'executing' && 'bg-neon-blue animate-pulse',
                agentStatus === 'planning' && 'bg-neon-purple animate-pulse',
                agentStatus === 'complete' && 'bg-neon-green',
                agentStatus === 'failed' && 'bg-destructive',
                agentStatus === 'idle' && 'bg-muted-foreground/40'
              )}
            />
            <h1 className="min-w-0 font-display text-sm [text-transform:lowercase] text-foreground truncate max-w-lg">{task.title}</h1>
            {agentDisplay && (
              <span className="hidden sm:inline-flex items-center gap-1 font-pixel text-[10px] text-muted-foreground shrink-0">
                {agentDisplay.emoji} {agentDisplay.label}
              </span>
            )}
            {isActive && (
              <span className="hidden md:flex items-center gap-1 font-pixel text-[10px] text-primary shrink-0">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
                live
              </span>
            )}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2 shrink-0 ml-4">
            {!isActive && agentStatus !== 'complete' && onRun && (
              <button
                onClick={() => onRun(task.id)}
                className="sticker-sm sticker-press flex h-10 items-center gap-2 rounded-full px-4 font-display text-sm [text-transform:lowercase]"
                style={{ backgroundColor: 'var(--color-neon-green)', color: 'var(--color-ink)' }}
                title={agentStatus === 'failed' ? 'Retry agent' : 'Run agent'}
              >
                <PixelIcon name={agentStatus === 'failed' ? 'recycle' : 'flash'} className="h-3.5 w-3.5" />
                {agentStatus === 'failed' ? 'retry' : 'run'}
              </button>
            )}
            {isActive && onStop && (
              <button
                onClick={() => onStop(task.id)}
                className="sticker-sm sticker-press flex h-10 items-center gap-2 rounded-full px-4 font-display text-sm [text-transform:lowercase]"
                style={{ backgroundColor: 'var(--color-destructive)', color: 'var(--color-ink)' }}
                title="Stop agent"
              >
                <span className="text-[10px] leading-none" aria-hidden>■</span>
                stop
              </button>
            )}
            {onMinimize && (
              <button
                onClick={onMinimize}
                className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground/80 hover:border-foreground/40 hover:text-foreground transition-colors"
                title="Collapse to panel"
              >
                <PixelIcon name="flip-vertical-down" className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground/80 hover:border-destructive hover:bg-destructive hover:text-primary-foreground transition-colors"
              title="Close (Esc)"
            >
              <span className="font-pixel text-sm leading-none" aria-hidden>✕</span>
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* ── LEFT INFO PANEL (md+; below md the same content lives in the "info" tab) ── */}
          <aside className="hidden md:flex w-72 xl:w-80 shrink-0 flex-col border-r-2 border-border bg-card/40 overflow-y-auto">
            {infoContent}
          </aside>

          {/* ── RIGHT ACTIVITY PANEL ── */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Failure summary */}
            {agentStatus === 'failed' && (
              <div className="shrink-0 border-b-2 border-border px-4 py-3">
                <div className="sticker rounded-2xl border-2 border-destructive/40 bg-destructive/10 p-3">
                  <div className="flex items-start gap-2">
                    <PixelIcon name="alert-triangle-1" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-sm [text-transform:lowercase] text-destructive">
                        agent failed
                      </p>
                      <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-destructive/80">
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
            <div className="shrink-0 flex items-center justify-between border-b-2 border-border px-3 py-2 gap-2">
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => selectTab('info')}
                  className={cn(tabButtonClass(activeTab === 'info'), 'md:hidden')}
                  style={activeTab === 'info' ? activeTabStyle : undefined}
                >
                  <PixelIcon name="information-circle-1" className="h-4 w-4" />
                  info
                </button>
                {showSummaryTab && (
                  <button
                    onClick={() => selectTab('summary')}
                    className={tabButtonClass(activeTab === 'summary')}
                    style={activeTab === 'summary' ? activeTabStyle : undefined}
                  >
                    <PixelIcon name="reward-gift" className="h-4 w-4" />
                    summary
                  </button>
                )}
                <button
                  onClick={() => selectTab('events')}
                  className={tabButtonClass(activeTab === 'events')}
                  style={activeTab === 'events' ? activeTabStyle : undefined}
                >
                  <PixelIcon name="light-bulb" className="h-4 w-4" />
                  thinking chain
                  {events.length > 0 && (
                    <span className="rounded-full bg-ink/20 px-1.5 py-0.5 font-pixel text-[9px]">
                      {coalescedEvents.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => selectTab('terminal')}
                  className={tabButtonClass(activeTab === 'terminal')}
                  style={activeTab === 'terminal' ? activeTabStyle : undefined}
                >
                  <PixelIcon name="old-electronics" className="h-4 w-4" />
                  terminal
                </button>
                <button
                  onClick={() => selectTab('changes')}
                  className={tabButtonClass(activeTab === 'changes')}
                  style={activeTab === 'changes' ? activeTabStyle : undefined}
                >
                  <PixelIcon name="text-format-1" className="h-4 w-4" />
                  file changes
                  {fileChanges.length > 0 && (
                    <span className="rounded-full bg-ink/20 px-1.5 py-0.5 font-pixel text-[9px]">
                      {fileChanges.length}
                    </span>
                  )}
                </button>
              </div>
              {events.length > 0 && (
                <button
                  onClick={handleExportLog}
                  className="flex h-10 shrink-0 items-center gap-1 rounded-full px-3 font-pixel text-[10px] lowercase text-muted-foreground hover:text-foreground transition-colors"
                  title="Download event log as markdown"
                >
                  <PixelIcon name="clound-download" className="h-3 w-3" />
                  export
                </button>
              )}
            </div>

            {/* ── Info tab (below md — same content as the desktop aside) ── */}
            {activeTab === 'info' && (
              <div className="flex-1 overflow-y-auto bg-card/40 md:hidden">
                {infoContent}
              </div>
            )}

            {/* ── Summary tab ── */}
            {activeTab === 'summary' && (
              <div className="flex-1 overflow-y-auto p-6">
                {summaryText ? (
                  <>
                    {!completedSectionFilled && (
                      <div className="mb-4 flex items-center gap-2 rounded-xl border-2 border-neon-yellow/40 bg-neon-yellow/10 px-3 py-2 text-xs text-neon-yellow">
                        <PixelIcon name="alert-triangle-1" className="h-4 w-4 shrink-0" />
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
                      <PixelIcon name="reward-gift" className="mx-auto h-12 w-12 text-muted-foreground/20" />
                      <p className="mt-3 font-pixel text-xs lowercase text-muted-foreground/50">
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
                    <div className="sticker w-full max-w-sm rounded-2xl border-2 border-destructive/40 bg-destructive/10 p-6 text-center">
                      <PixelIcon name="alert-triangle-1" className="mx-auto h-10 w-10 text-destructive/80" />
                      <p className="mt-3 font-display text-sm [text-transform:lowercase] text-destructive">
                        agent failed — no events recorded
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-destructive/70">
                        Use Reconfigure or Retry to run again and capture details.
                      </p>
                    </div>
                  </div>
                )}
                {coalescedEvents.length === 0 && !streaming && agentStatus !== 'failed' && (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <PixelIcon name="light-bulb" className="mx-auto h-12 w-12 text-muted-foreground/20 animate-px-bob" />
                      <p className="mt-3 font-display text-sm [text-transform:lowercase] text-muted-foreground/50">no agent activity yet</p>
                      <p className="mt-1 font-pixel text-[10px] lowercase text-muted-foreground/30">
                        start the agent to see the thinking chain
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
                    <span className="font-pixel text-[10px] lowercase text-muted-foreground">
                      agent is thinking…
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
                  theme === 'light' ? 'bg-cream' : 'bg-ink'
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
                      <PixelIcon name="text-format-1" className="mx-auto h-12 w-12 text-muted-foreground/20" />
                      <p className="mt-3 font-pixel text-xs lowercase text-muted-foreground/50">no file changes yet</p>
                    </div>
                  </div>
                ) : (
                  fileChanges.map((file) => (
                    <details key={file.path} className="group rounded-xl border-2 border-border bg-card">
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
                        <span className="font-pixel text-[10px] text-muted-foreground lowercase shrink-0">
                          {file.type}
                        </span>
                        <span className="font-pixel text-xs text-muted-foreground shrink-0 group-open:rotate-180 transition-transform" aria-hidden>▾</span>
                      </summary>
                      <div className="border-t-2 border-border px-3 py-2.5 overflow-x-auto">
                        {file.diff ? (
                          <div
                            className="rounded-lg p-2.5 font-mono text-[11px] leading-relaxed"
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
            <div className="shrink-0 border-t-2 border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {followUpImages.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2.5">
                  {followUpImages.map((f, i) => (
                    <div key={i} className="relative group">
                      <FollowUpImagePreview file={f} />
                      <button
                        type="button"
                        onClick={() => setFollowUpImages((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 pointer-coarse:w-7 pointer-coarse:h-7 rounded-full bg-destructive text-primary-foreground text-[10px] leading-none flex items-center justify-center pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 transition-opacity before:absolute before:-inset-2"
                        aria-label="Remove image"
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
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground/80 hover:border-foreground/40 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Attach images"
                >
                  <PixelIcon name="clip-1" className="h-4 w-4" />
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
                      ? isSmUp
                        ? 'Send a message to the agent… (Enter to send)'
                        : 'Message the agent…'
                      : isSmUp
                      ? 'Messages can only be sent while the agent is running'
                      : 'Agent must be running'
                  }
                  disabled={agentStatus !== 'executing' || sending}
                  className="h-11 min-w-0 flex-1 rounded-xl border-2 border-border bg-card px-3 font-pixel text-[11px] text-foreground placeholder:text-muted-foreground focus:border-neon-pink focus:outline-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                />
                <button
                  onClick={handleSendFollowUp}
                  disabled={
                    agentStatus !== 'executing' ||
                    sending ||
                    (!followUpMessage.trim() && followUpImages.length === 0)
                  }
                  className="sticker-sm sticker-press flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Send message (Enter)"
                >
                  <PixelIcon name="envelope-close" className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1.5 font-pixel text-[10px] lowercase text-muted-foreground/40 text-center">
                {agentStatus === 'executing'
                  ? 'your message will be injected into the running agent session'
                  : 'start the agent to enable messaging'}
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    )}
    </AnimatePresence>
  );
}
