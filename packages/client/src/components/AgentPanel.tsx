import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Markdown from 'react-markdown';
import {
  X,
  Brain,
  Terminal,
  FileCode2,
  Cog,
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
  Trash2,
  Send,
  FileText,
  RotateCw,
  Download,
} from 'lucide-react';
import type { Task, AgentEvent, AgentEventType } from '@/types';
import { getAgentDisplay } from '@/lib/agent-config';
import { TerminalView } from './TerminalView';
import { api, connectWS } from '@/lib/api';
import { cn } from '@/lib/utils';

const eventIconMap: Record<AgentEventType, React.ElementType> = {
  thinking: Brain,
  tool_call: Cog,
  file_read: FileText,
  file_write: FileCode2,
  file_edit: FileCode2,
  command: Terminal,
  command_output: Terminal,
  output: Terminal,
  test_result: CheckCircle2,
  error: AlertCircle,
  complete: CheckCircle2,
};

const eventColorMap: Record<AgentEventType, string> = {
  thinking: 'text-purple-500 dark:text-purple-400',
  tool_call: 'text-blue-500 dark:text-blue-400',
  file_read: 'text-sky-500 dark:text-sky-400',
  file_write: 'text-amber-500 dark:text-amber-400',
  file_edit: 'text-amber-500 dark:text-amber-400',
  command: 'text-cyan-600 dark:text-cyan-400',
  command_output: 'text-zinc-500 dark:text-zinc-400',
  output: 'text-zinc-500 dark:text-zinc-400',
  test_result: 'text-emerald-500 dark:text-emerald-400',
  error: 'text-red-500 dark:text-red-400',
  complete: 'text-emerald-500 dark:text-emerald-400',
};

const eventLabelMap: Record<AgentEventType, string> = {
  thinking: 'Thinking',
  tool_call: 'Tool Call',
  file_read: 'File Read',
  file_write: 'File Write',
  file_edit: 'File Edit',
  command: 'Command',
  command_output: 'Output',
  output: 'Output',
  test_result: 'Test Result',
  error: 'Error',
  complete: 'Complete',
};

/** A coalesced event merges consecutive events of the same type */
interface CoalescedEvent extends AgentEvent {
  /** Parsed label for command events (e.g. "bash") */
  toolLabel?: string;
  /** Parsed arguments for command events */
  toolArgs?: string;
}

/** Merge consecutive events of the same mergeable type */
function coalesceEvents(events: AgentEvent[], streaming: boolean): CoalescedEvent[] {
  const result: CoalescedEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Skip empty content events (shouldn't exist but guards against bad data)
    if (!event.content?.trim() && event.type !== 'complete' && event.type !== 'error') continue;

    // Hide thinking events that are still actively streaming
    // (i.e. the last run of thinking events with no non-thinking event after them)
    if (event.type === 'thinking' && streaming) {
      // Check if there's a non-thinking event after this run of thinking events
      let hasFollowUp = false;
      for (let j = i + 1; j < events.length; j++) {
        if (events[j].type !== 'thinking') { hasFollowUp = true; break; }
      }
      if (!hasFollowUp) continue; // skip — still streaming thinking
    }

    // Mergeable types: thinking, output, command_output
    if (event.type === 'thinking' || event.type === 'output' || event.type === 'command_output') {
      // Check if last coalesced entry is the same type — merge
      // Also merge command_output into output and vice versa
      const last = result[result.length - 1];
      const mergeable = last && (last.type === event.type ||
        (last.type === 'output' && event.type === 'command_output') ||
        (last.type === 'command_output' && event.type === 'output'));
      if (mergeable) {
        // Concatenate directly — content already includes natural newlines
        last.content += event.content;
        continue;
      }
    }

    // Parse command events: content is like 'bash: {"command":"...","description":"..."}'
    if (event.type === 'command') {
      const parsed = parseCommandEvent(event);
      result.push(parsed);
      continue;
    }

    result.push({ ...event });
  }
  return result;
}

/** Parse command event content like 'bash: {"command":"python3 hello.py","description":"Run hello"}' */
function parseCommandEvent(event: AgentEvent): CoalescedEvent {
  const colonIdx = event.content.indexOf(': ');
  if (colonIdx === -1) return { ...event };

  const toolLabel = event.content.slice(0, colonIdx);
  const jsonStr = event.content.slice(colonIdx + 2);

  try {
    const parsed = JSON.parse(jsonStr);
    // Show the actual command or a description
    const display = parsed.command || parsed.description || jsonStr;
    return { ...event, toolLabel, toolArgs: display };
  } catch {
    // Not valid JSON — just show the raw content after the tool name
    return { ...event, toolLabel, toolArgs: jsonStr };
  }
}

/** Detect if content looks like code (backticks, common code patterns) */
function looksLikeCode(text: string): boolean {
  if (text.includes('`')) return true;
  const lines = text.split('\n');
  const codePatterns = /^(import |export |const |let |var |function |class |if \(|for \(|while \(|return |async |await |\/\/|#include|def |package )/;
  return lines.some((line) => codePatterns.test(line.trimStart()));
}


interface AgentPanelProps {
  task: Task | null;
  onClose: () => void;
  onRun?: (id: string) => void;
  onStop?: (id: string) => void;
  onCreatePR?: (id: string) => Promise<string | undefined>;
  onCleanupWorktree?: (id: string) => Promise<void>;
  onReconfigureRetry?: (id: string) => void;
  theme?: 'dark' | 'light';
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(timerRef.current); }, []);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }).catch((err) => {
      console.warn('[clipboard] copy failed:', err);
    });
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

function EventItem({ event }: { event: CoalescedEvent }) {
  // Thinking events default to collapsed; everything else expanded
  const [expanded, setExpanded] = useState(event.type !== 'thinking');
  const Icon = eventIconMap[event.type];
  const color = eventColorMap[event.type];
  const label = event.toolLabel
    ? event.toolLabel.charAt(0).toUpperCase() + event.toolLabel.slice(1)
    : eventLabelMap[event.type];

  const hasDiff = event.metadata?.diff;
  const hasFile = event.metadata?.file;

  // For parsed commands, show the command string in the header
  // For file events, show just the filename (basename) from metadata
  const fileLabel = (event.type === 'file_read' || event.type === 'file_write' || event.type === 'file_edit')
    ? (event.metadata?.file ? event.metadata.file.split('/').pop() : null)
    : null;
  const headerSummary = event.toolArgs
    ? event.toolArgs.length > 80 ? event.toolArgs.slice(0, 80) + '...' : event.toolArgs
    : fileLabel ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="group"
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
            <span className="text-xs font-medium text-foreground">
              {label}
            </span>
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
              {/* Thinking / text content — render as code block if it looks like code */}
              {(event.type === 'thinking' || event.type === 'complete' || event.type === 'error') && (
                looksLikeCode(event.content) ? (
                  <div className="rounded-md px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap" style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-text)' }}>
                    {event.content}
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                    {event.content}
                  </p>
                )
              )}

              {/* Command — user follow-up messages have distinct styling */}
              {event.type === 'command' && event.content.startsWith('You: ') && (
                <div className="rounded-md bg-sky-500/10 border border-sky-500/20 px-2.5 py-1.5 text-xs text-sky-700 dark:text-sky-300">
                  {event.content}
                </div>
              )}

              {/* Command — show parsed command cleanly */}
              {event.type === 'command' && !event.content.startsWith('You: ') && (
                <div className="flex items-center gap-1 rounded-md px-2.5 py-1.5 font-mono text-xs" style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-command)' }}>
                  <span className="text-muted-foreground select-none">$</span>
                  <span className="flex-1">{event.toolArgs || event.content}</span>
                  <CopyButton text={event.toolArgs || event.content} />
                </div>
              )}

              {/* Output — render as prose if it's natural language, code block if it looks like code */}
              {event.type === 'output' && (
                looksLikeCode(event.content) ? (
                  <div className="rounded-md px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap" style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-text)' }}>
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
                )
              )}

              {/* Diff */}
              {hasDiff && (
                <div className="mt-1 overflow-x-auto rounded-md p-2.5 font-mono text-[11px] leading-relaxed" style={{ backgroundColor: 'var(--code-bg)' }}>
                  {event.metadata!.diff!.split('\n').map((line, i) => (
                    <div
                      key={i}
                      style={
                        line.startsWith('+') && !line.startsWith('++')
                          ? { color: 'var(--code-diff-add-text)', backgroundColor: 'var(--code-diff-add-bg)' }
                          : line.startsWith('-') && !line.startsWith('--')
                          ? { color: 'var(--code-diff-del-text)', backgroundColor: 'var(--code-diff-del-bg)' }
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

export function AgentPanel({ task, onClose, onRun, onStop, onCreatePR, onCleanupWorktree, onReconfigureRetry, theme }: AgentPanelProps) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [followUpMessage, setFollowUpMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'events' | 'terminal'>('events');
  const [showWorktreeConfirm, setShowWorktreeConfirm] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const taskId = task?.id ?? null;
  const agentStatus = task?.agentStatus;

  useEffect(() => {
    if (!taskId) {
      setEvents([]);
      setPrUrl(null);
      setPrLoading(false);
      return;
    }

    // Reset state for new task
    setPrUrl(null);
    setPrLoading(false);
    setPrError(null);
    setFollowUpMessage('');
    setSending(false);

    // Load existing events from server
    api.getEvents(taskId).then(setEvents).catch(console.error);

    // Listen for live agent events via WS
    const disconnect = connectWS((msg) => {
      if (msg.type === 'agent_event') {
        if (msg.payload.taskId === taskId) {
          // Deduplicate by event id — historical load + live WS can overlap
          setEvents((prev) => {
            if (msg.payload.id && prev.some((e) => e.id === msg.payload.id)) return prev;
            return [...prev, msg.payload];
          });
          if (msg.payload.type === 'complete' || msg.payload.type === 'error') {
            setStreaming(false);
          }
        }
      }
      // Show follow-up messages from other clients (dedup against local sends)
      if (msg.type === 'agent_follow_up' && msg.payload.taskId === taskId) {
        const content = `You: ${msg.payload.message}`;
        setEvents((prev) => {
          // Skip if we already added this message locally
          if (prev.some((e) => e.type === 'command' && e.content === content)) return prev;
          return [...prev, {
            id: `fu-ws-${Date.now()}`,
            taskId: taskId,
            type: 'command' as const,
            content,
            timestamp: Date.now(),
          }];
        });
      }
    });

    return () => {
      disconnect();
      setStreaming(false);
    };
  }, [taskId]);

  // Fix #4: Sync streaming state with agentStatus (avoids stale closure on [taskId] effect)
  useEffect(() => {
    if (!taskId) return;
    const isActive = agentStatus === 'executing' || agentStatus === 'planning';
    setStreaming(isActive);
  }, [taskId, agentStatus]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const isActive = task?.agentStatus === 'executing' || task?.agentStatus === 'planning';

  const coalescedEvents = useMemo(
    () => coalesceEvents(events, streaming),
    [events, streaming]
  );

  const handleSendFollowUp = async () => {
    if (!task || !followUpMessage.trim() || sending) return;
    const message = followUpMessage.trim();
    setSending(true);
    setFollowUpMessage('');
    // Show locally immediately
    setEvents((prev) => [...prev, {
      id: `fu-${Date.now()}`,
      taskId: task.id,
      type: 'command' as const,
      content: `You: ${message}`,
      timestamp: Date.now(),
    }]);
    try {
      await api.sendMessage(task.id, message);
    } catch (err) {
      console.error('[AgentPanel] failed to send follow-up:', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <AnimatePresence>
      {task && (
        <>
          {/* Backdrop overlay — click to close */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[55]"
            style={{ backgroundColor: 'var(--overlay-bg)' }}
          />
          <motion.div
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 z-[60] flex h-full w-full flex-col border-l border-border bg-card shadow-2xl md:max-w-md md:w-[420px]"
          >
          {/* Progress bar */}
          {(task.agentStatus === 'planning' || task.agentStatus === 'executing' || task.agentStatus === 'complete') && (
            <div className="h-1 w-full bg-muted shrink-0">
              <div
                className={cn(
                  'h-full rounded-r transition-all duration-700 ease-in-out',
                  task.agentStatus === 'complete'
                    ? 'w-full bg-emerald-500'
                    : task.agentStatus === 'executing'
                      ? 'w-3/5 bg-primary animate-pulse'
                      : 'w-1/4 bg-purple-500 animate-pulse'
                )}
              />
            </div>
          )}

          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold">{task.title}</h3>
              <div className="mt-0.5 flex items-center gap-2">
                {task.agentType && (
                  <span className="text-[10px] text-muted-foreground">
                    {getAgentDisplay(task.agentType)?.emoji} {getAgentDisplay(task.agentType)?.label}
                  </span>
                )}
                {isActive && (
                  <span className="flex items-center gap-1 text-[10px] text-primary">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                    </span>
                    Active
                  </span>
                )}
                {task.agentStatus === 'complete' && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" />
                    Complete
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {events.length} events
                </span>
              </div>
            </div>
            <div className="ml-3 flex items-center gap-1.5">
              {/* Run / Stop / Retry buttons */}
              {!isActive && task.agentStatus !== 'complete' && onRun && (
                <button
                  onClick={() => onRun(task.id)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  title={task.agentStatus === 'failed' ? 'Retry agent' : 'Run agent'}
                >
                  {task.agentStatus === 'failed' ? <RotateCw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
              )}
              {!isActive && task.agentStatus === 'failed' && onReconfigureRetry && (
                <button
                  onClick={() => onReconfigureRetry(task.id)}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-muted px-3 text-xs font-medium text-amber-500 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
                  title="Reconfigure and retry"
                >
                  <Cog className="h-3.5 w-3.5" />
                  Reconfigure
                </button>
              )}
              {isActive && onStop && (
                <button
                  onClick={() => onStop(task.id)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-red-500 dark:text-red-400 hover:bg-red-500/20 transition-colors"
                  title="Stop agent"
                >
                  <Square className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground hover:bg-destructive hover:text-white hover:border-destructive transition-colors"
                title="Close panel (Esc)"
              >
                <X className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* Task description as collapsible markdown */}
          {/* WARNING: Do NOT add rehype-raw — it would allow raw HTML injection (XSS). */}
          {task.description && (
            <div className="shrink-0 border-b border-border">
              <button
                onClick={() => setDescExpanded(!descExpanded)}
                className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-accent/50 transition-colors"
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium text-foreground">Task Description</span>
                <span className="text-[10px] text-muted-foreground ml-1">
                  {task.description.length > 200 ? `${Math.round(task.description.length / 100) * 100}+ chars` : ''}
                </span>
                {descExpanded
                  ? <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  : <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground shrink-0" />
                }
              </button>
              <AnimatePresence>
                {descExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <div className="max-h-[30vh] overflow-y-auto px-4 pb-3 prose prose-xs dark:prose-invert max-w-none text-xs text-muted-foreground leading-relaxed [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_a]:text-primary [&_a]:underline" style={{ '--tw-prose-code-bg': 'var(--prose-code-bg)' } as React.CSSProperties}>
                      <style>{`.prose code { background-color: var(--prose-code-bg); } .prose pre { background-color: var(--code-bg); padding: 0.5rem; border-radius: 0.375rem; }`}</style>
                      <Markdown
                        allowedElements={[
                          'p', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'a',
                          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'br',
                          'table', 'thead', 'tbody', 'tr', 'th', 'td',
                        ]}
                      >
                        {task.description}
                      </Markdown>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Worktree info bar */}
          {task.branchName && (
            <div className="shrink-0 border-b border-border px-4 py-2 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <GitBranch className="h-3 w-3 text-primary" />
                <span className="font-mono text-foreground">{task.branchName}</span>
                <span className="text-muted-foreground/50">from</span>
                <span className="font-mono">{task.baseBranch || 'main'}</span>
              </div>
              {task.worktreePath && (
                <div className="text-[10px] text-muted-foreground font-mono truncate">
                  {task.worktreePath}
                </div>
              )}

              {/* PR / Cleanup actions — show when task is done or complete */}
              {(task.agentStatus === 'complete' || task.columnId === 'done') && (
                <div className="flex items-center gap-2 pt-1">
                  {!prUrl && onCreatePR && (
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
                      className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {prLoading ? 'Creating...' : 'Create PR'}
                    </button>
                  )}
                  {prUrl && (
                    <a
                      href={prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View PR
                    </a>
                  )}
                  {task.worktreePath && onCleanupWorktree && (
                    <button
                      onClick={() => setShowWorktreeConfirm(true)}
                      className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                      Clean up worktree
                    </button>
                  )}
                </div>
              )}

              {/* PR error with copy-able commands */}
              {prError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="whitespace-pre-wrap font-mono text-xs text-red-300">{prError}</p>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(prError);
                      }}
                      className="shrink-0 rounded px-2 py-1 text-[10px] text-red-400 hover:bg-red-500/20"
                    >
                      Copy
                    </button>
                  </div>
                  <button
                    onClick={() => setPrError(null)}
                    className="mt-2 text-[10px] text-zinc-300 hover:text-white"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Worktree cleanup confirmation */}
          {showWorktreeConfirm && (
            <div className="mx-4 my-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-200 font-medium mb-1">Delete worktree?</p>
              <p className="text-xs text-amber-300/80 mb-3">
                This removes the worktree directory and its files. If you haven't created a PR yet, you won't be able to push these changes afterward.
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
                    if (task && onCleanupWorktree) onCleanupWorktree(task.id);
                  }}
                  className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500"
                >
                  Delete worktree
                </button>
              </div>
            </div>
          )}

          {/* Tab bar */}
          <div className="shrink-0 flex items-center justify-between border-b border-border px-2 pt-1">
            <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('events')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-t transition-colors',
                activeTab === 'events'
                  ? 'bg-card border border-border border-b-card text-foreground -mb-px'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Events
            </button>
            <button
              onClick={() => setActiveTab('terminal')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-t transition-colors',
                activeTab === 'terminal'
                  ? 'bg-card border border-border border-b-card text-foreground -mb-px'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Terminal
            </button>
            </div>
            {events.length > 0 && (
              <button
                onClick={() => {
                  const md = events.map((e) => {
                    const label = eventLabelMap[e.type] || e.type;
                    const meta = e.metadata?.file ? ` (${e.metadata.file})` : '';
                    return `### ${label}${meta}\n${e.content}`;
                  }).join('\n\n');
                  const blob = new Blob([`# Agent Log — ${task.title}\n\n${md}`], { type: 'text/markdown' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = `agent-log-${task.id}.md`; a.click();
                  URL.revokeObjectURL(url);
                }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                title="Download event log as markdown"
              >
                <Download className="h-3 w-3" />
                Export
              </button>
            )}
          </div>

          {/* Terminal view */}
          {activeTab === 'terminal' && (
            <div className={cn('flex-1 overflow-hidden rounded-none', theme === 'light' ? 'bg-[#f8f9fb]' : 'bg-[#0f172a]')}>
              <TerminalView events={events} streaming={streaming} theme={theme} />
            </div>
          )}

          {/* Events list */}
          {activeTab === 'events' && (
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-2 space-y-0.5"
          >
            {coalescedEvents.length === 0 && !streaming && (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <Brain className="mx-auto h-10 w-10 text-muted-foreground/20" />
                  <p className="mt-3 text-sm text-muted-foreground/50">
                    No agent activity yet
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/30">
                    Assign this task to start the agent
                  </p>
                </div>
              </div>
            )}

            {coalescedEvents.map((event) => (
              <EventItem key={event.id} event={event} />
            ))}

            {/* Streaming indicator */}
            {streaming && coalescedEvents.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 px-2 py-2"
              >
                <div className="flex gap-1">
                  <motion.div
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: 0 }}
                    className="h-1 w-1 rounded-full bg-primary"
                  />
                  <motion.div
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: 0.2 }}
                    className="h-1 w-1 rounded-full bg-primary"
                  />
                  <motion.div
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: 0.4 }}
                    className="h-1 w-1 rounded-full bg-primary"
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">
                  Agent is working...
                </span>
              </motion.div>
            )}
          </div>
          )}

          {/* Follow-up message input — fixed at bottom */}
          <div className="shrink-0 border-t border-border bg-card px-3 py-2">
            <div className="flex items-center gap-2">
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
                placeholder="Send a message to the agent..."
                disabled={agentStatus !== 'executing' || sending}
                className="flex-1 rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40 disabled:cursor-not-allowed"
              />
              <button
                onClick={handleSendFollowUp}
                disabled={agentStatus !== 'executing' || sending || !followUpMessage.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Send message"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
