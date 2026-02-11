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
  Copy,
  Check,
  Play,
  Square,
  GitBranch,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import type { Task, AgentEvent, AgentEventType } from '@/types';
import { getAgentDisplay } from '@/lib/agent-config';
import { api, connectWS } from '@/lib/api';
import { cn } from '@/lib/utils';

const eventIconMap: Record<AgentEventType, React.ElementType> = {
  thinking: Brain,
  tool_call: Cog,
  file_edit: FileCode2,
  command: Terminal,
  output: Terminal,
  error: AlertCircle,
  complete: CheckCircle2,
};

const eventColorMap: Record<AgentEventType, string> = {
  thinking: 'text-purple-400',
  tool_call: 'text-blue-400',
  file_edit: 'text-amber-400',
  command: 'text-cyan-400',
  output: 'text-zinc-400',
  error: 'text-red-400',
  complete: 'text-emerald-400',
};

const eventLabelMap: Record<AgentEventType, string> = {
  thinking: 'Thinking',
  tool_call: 'Tool Call',
  file_edit: 'File Edit',
  command: 'Command',
  output: 'Output',
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

    // Mergeable types: thinking, output
    if (event.type === 'thinking' || event.type === 'output') {
      // Check if last coalesced entry is the same type — merge
      const last = result[result.length - 1];
      if (last && last.type === event.type) {
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
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
  const headerSummary = event.toolArgs
    ? event.toolArgs.length > 80 ? event.toolArgs.slice(0, 80) + '...' : event.toolArgs
    : null;

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
                  <div className="rounded-md bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-300 whitespace-pre-wrap">
                    {event.content}
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                    {event.content}
                  </p>
                )
              )}

              {/* Command — show parsed command cleanly */}
              {event.type === 'command' && (
                <div className="flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-emerald-400">
                  <span className="text-muted-foreground select-none">$</span>
                  <span className="flex-1">{event.toolArgs || event.content}</span>
                  <CopyButton text={event.toolArgs || event.content} />
                </div>
              )}

              {/* Output */}
              {event.type === 'output' && (
                <div className="rounded-md bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-300 whitespace-pre-wrap">
                  {event.content}
                </div>
              )}

              {/* Diff */}
              {hasDiff && (
                <div className="mt-1 overflow-x-auto rounded-md bg-zinc-900 p-2.5 font-mono text-[11px] leading-relaxed">
                  {event.metadata!.diff!.split('\n').map((line, i) => (
                    <div
                      key={i}
                      className={cn(
                        line.startsWith('+') && !line.startsWith('++')
                          ? 'text-emerald-400 bg-emerald-500/10'
                          : line.startsWith('-') && !line.startsWith('--')
                          ? 'text-red-400 bg-red-500/10'
                          : 'text-zinc-400'
                      )}
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

export function AgentPanel({ task, onClose, onRun, onStop, onCreatePR, onCleanupWorktree }: AgentPanelProps) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [prLoading, setPrLoading] = useState(false);
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
            className="fixed inset-0 z-[55] bg-black/20"
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
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400">
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
              {/* Run / Stop buttons */}
              {!isActive && task.agentStatus !== 'complete' && onRun && (
                <button
                  onClick={() => onRun(task.id)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  title="Run agent"
                >
                  <Play className="h-4 w-4" />
                </button>
              )}
              {isActive && onStop && (
                <button
                  onClick={() => onStop(task.id)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-red-400 hover:bg-red-500/20 transition-colors"
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

          {/* Task description as markdown */}
          {/* WARNING: Do NOT add rehype-raw — it would allow raw HTML injection (XSS). */}
          {task.description && (
            <div className="shrink-0 border-b border-border px-4 py-3 prose prose-xs prose-invert max-w-none text-xs text-muted-foreground leading-relaxed [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_pre]:rounded-md [&_pre]:bg-zinc-900 [&_pre]:p-2 [&_a]:text-primary [&_a]:underline">
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
                        const url = await onCreatePR(task.id);
                        if (url) setPrUrl(url);
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
                      className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View PR
                    </a>
                  )}
                  {task.worktreePath && onCleanupWorktree && (
                    <button
                      onClick={() => onCleanupWorktree(task.id)}
                      className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                      Clean up worktree
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Events list */}
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
        </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
