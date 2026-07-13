import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';import Markdown from 'react-markdown';
import type { Task, AgentEvent, AgentEventType } from '@/types';
import { getAgentDisplay } from '@/lib/agent-config';
import { TerminalView } from './TerminalView';
import { PixelIcon } from './PixelIcon';
import { api, connectWS } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Pixel-icon name per event type (see PixelIcon / the streamline pack). */
const eventIconMap: Record<AgentEventType, string> = {
  thinking: 'light-bulb',
  tool_call: 'cog-browser',
  file_read: 'open-book-bookmark',
  file_write: 'quill-ink',
  file_edit: 'quill-ink',
  command: 'old-electronics',
  command_output: 'old-electronics',
  output: 'message',
  test_result: 'iris-scan-approved',
  error: 'alert-triangle-1',
  complete: 'rating-star-1',
};

const eventColorMap: Record<AgentEventType, string> = {
  thinking: 'text-neon-purple',
  tool_call: 'text-neon-blue',
  file_read: 'text-neon-blue',
  file_write: 'text-neon-yellow',
  file_edit: 'text-neon-yellow',
  command: 'text-neon-green',
  command_output: 'text-muted-foreground',
  output: 'text-muted-foreground',
  test_result: 'text-neon-green',
  error: 'text-destructive',
  complete: 'text-neon-green',
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

/** Strip build-progress noise (dotnet timestamps, bare fragments) from output content */
function stripProgressNoise(content: string): string {
  return content.split('\n').filter(l => {
    const trimmed = l.trim();
    if (trimmed.length === 0) return false;
    const clean = trimmed.replace(/\x1b\[[0-9;]*m/g, '');
    // Filter progress timestamps: (0.3s), (1.2s)csproj, etc.
    if (/^\(?\d+\.\d+s\)/.test(clean)) return false;
    // Filter bare fragments that are just part of progress output
    if (/^(csproj|sln|props|targets)$/i.test(clean)) return false;
    return true;
  }).join('\n');
}

/** Merge consecutive events of the same mergeable type */
function coalesceEvents(events: AgentEvent[], streaming: boolean): CoalescedEvent[] {
  const result: CoalescedEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    let event = events[i];

    // Strip build-progress noise from command output
    if (event.type === 'command_output') {
      const cleaned = stripProgressNoise(event.content);
      if (!cleaned.trim()) continue; // nothing meaningful left
      event = { ...event, content: cleaned };
    }

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

/** Pretty-print a JSON string, or return null if it isn't JSON. */
function tryPrettyJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

/**
 * Derive a readable detail string for tool_call / file_* events. ACP agents
 * (Hermes, OpenClaw) emit these types with content shaped as raw JSON or
 * "Title: {json}"; pretty-print the args/output so clicking shows real detail.
 */
function deriveToolDetail(content: string | undefined): string | null {
  const raw = content?.trim();
  if (!raw) return null;
  const wholePretty = tryPrettyJson(raw);
  if (wholePretty) return wholePretty;
  const colonIdx = raw.indexOf(': ');
  if (colonIdx > 0) {
    const afterPretty = tryPrettyJson(raw.slice(colonIdx + 2));
    if (afterPretty) return afterPretty;
  }
  return raw;
}

/** Collapse content to a single-line, truncated summary for the event header. */
function compactToolSummary(content: string | undefined): string | null {
  const raw = content?.trim();
  if (!raw) return null;
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? oneLine.slice(0, 80) + '...' : oneLine;
}


interface AgentPanelProps {
  task: Task | null;
  onClose: () => void;
  onRun?: (id: string) => void;
  onStop?: (id: string) => void;
  onCreatePR?: (id: string) => Promise<string | undefined>;
  onMergeLocal?: (id: string) => Promise<string | undefined>;
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
      className="flex h-6 w-6 items-center justify-center rounded-md font-pixel text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      aria-label={copied ? 'Copied' : 'Copy'}
    >
      {copied ? <span className="text-neon-green">✓</span> : <PixelIcon name="clip-1" className="h-3 w-3" />}
    </button>
  );
}

function EventItem({ event }: { event: CoalescedEvent }) {
  // Thinking events default to collapsed; everything else expanded
  const [expanded, setExpanded] = useState(event.type !== 'thinking');
  const iconName = eventIconMap[event.type];
  const color = eventColorMap[event.type];
  const label = event.toolLabel
    ? event.toolLabel.charAt(0).toUpperCase() + event.toolLabel.slice(1)
    : eventLabelMap[event.type];

  const hasDiff = event.metadata?.diff;
  const hasFile = event.metadata?.file;

  // tool_call / file_* events (common for ACP agents like Hermes/OpenClaw) have
  // no command-style parsing, so derive a readable detail + header summary.
  const isToolDetailType =
    event.type === 'tool_call' ||
    event.type === 'file_read' ||
    event.type === 'file_write' ||
    event.type === 'file_edit';
  const toolDetail = isToolDetailType && !hasDiff ? deriveToolDetail(event.content) : null;

  // For parsed commands, show the command string in the header
  // For file events, show just the filename (basename) from metadata
  const fileLabel = (event.type === 'file_read' || event.type === 'file_write' || event.type === 'file_edit')
    ? (event.metadata?.file ? event.metadata.file.split('/').pop() : null)
    : null;
  const headerSummary = event.toolArgs
    ? event.toolArgs.length > 80 ? event.toolArgs.slice(0, 80) + '...' : event.toolArgs
    : fileLabel ?? (isToolDetailType ? compactToolSummary(event.content) : null);

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'group',
        event.type === 'error' && 'rounded-xl border-2 border-destructive/30 bg-destructive/5'
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-accent/50 transition-colors"
      >
        <div className={cn('mt-0.5 shrink-0', color)}>
          <PixelIcon name={iconName} className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-pixel text-[11px] text-foreground [text-transform:lowercase]">
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
            <span
              className={cn(
                'ml-auto shrink-0 font-pixel text-xs text-muted-foreground/60 transition-transform',
                expanded && 'rotate-90'
              )}
              aria-hidden="true"
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
              {/* Thinking / text content — render as code block if it looks like code */}
              {(event.type === 'thinking' || event.type === 'complete' || event.type === 'error') && (
                looksLikeCode(event.content) ? (
                  <div className="rounded-lg px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap" style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-text)' }}>
                    {event.content}
                  </div>
                ) : (
                  <p className={cn(
                    'text-xs leading-relaxed whitespace-pre-wrap',
                    event.type === 'error'
                      ? 'font-mono text-destructive'
                      : 'text-muted-foreground'
                  )}>
                    {event.content}
                  </p>
                )
              )}

              {/* Command — user follow-up messages have distinct styling */}
              {event.type === 'command' && event.content.startsWith('You: ') && (
                <div className="rounded-lg border-2 border-neon-blue/30 bg-neon-blue/10 px-2.5 py-1.5 text-xs text-neon-blue">
                  {event.content}
                </div>
              )}

              {/* Command — show parsed command cleanly */}
              {event.type === 'command' && !event.content.startsWith('You: ') && (
                <div className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-mono text-xs" style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-command)' }}>
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

              {/* Tool call / file operation — show the file path and tool args/output.
                  Covers ACP agents (Hermes/OpenClaw) whose activity arrives as
                  tool_call/file_* events rather than command/output. */}
              {isToolDetailType && (
                <div className="space-y-1">
                  {hasFile && (
                    <div className="font-mono text-[11px] text-muted-foreground break-all">
                      {event.metadata!.file}
                    </div>
                  )}
                  {toolDetail && (
                    <div className="flex items-start gap-1 rounded-lg px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap" style={{ backgroundColor: 'var(--code-bg)', color: 'var(--code-text)' }}>
                      <span className="flex-1 overflow-x-auto">{toolDetail}</span>
                      <CopyButton text={toolDetail} />
                    </div>
                  )}
                </div>
              )}

              {/* Diff */}
              {hasDiff && (
                <div className="mt-1 overflow-x-auto rounded-lg p-2.5 font-mono text-[11px] leading-relaxed" style={{ backgroundColor: 'var(--code-bg)' }}>
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

export function AgentPanel({ task, onClose, onRun, onStop, onCreatePR, onMergeLocal, onCleanupWorktree, onReconfigureRetry, theme }: AgentPanelProps) {
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
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'events' | 'terminal' | 'changes'>('events');
  // Tracks whether the user manually picked a tab for the current task, so the
  // auto-default (Summary for review/done) doesn't clobber an explicit choice.
  const userSelectedTabRef = useRef(false);
  const agentDisplay = task?.agentType ? getAgentDisplay(task.agentType) : undefined;
  const [showWorktreeConfirm, setShowWorktreeConfirm] = useState(false);
  const [hasRemote, setHasRemote] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const taskId = task?.id ?? null;
  const agentStatus = task?.agentStatus;
  const errorEvents = useMemo(() => events.filter((event) => event.type === 'error'), [events]);
  const latestError = errorEvents[errorEvents.length - 1];

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
    setMergeResult(null);
    setMergeLoading(false);
    setMergeError(null);
    setShowWorktreeConfirm(false);
    setHasRemote(null);
    setFollowUpMessage('');
    setSending(false);
    setFollowUpImages([]);
    // Allow the auto-default tab to apply for the newly selected task
    userSelectedTabRef.current = false;

    // Load existing events from server
    api.getEvents(taskId).then(setEvents).catch(console.error);

    // Check if repo has a git remote (for showing Create PR vs Merge to main)
    api.getGitInfo(taskId).then((info) => setHasRemote(info.hasRemote)).catch(() => setHasRemote(false));

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

  // Default to the Summary tab for review/done tasks (and auto-switch when a task
  // moves into review on completion), unless the user picked a tab themselves.
  const columnId = task?.columnId;
  useEffect(() => {
    if (!taskId) return;
    if (userSelectedTabRef.current) return;
    if (columnId === 'review' || columnId === 'done') {
      setActiveTab('summary');
    } else {
      setActiveTab('events');
    }
  }, [taskId, columnId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const isActive = task?.agentStatus === 'executing' || task?.agentStatus === 'planning';

  const selectTab = (tab: 'summary' | 'events' | 'terminal' | 'changes') => {
    userSelectedTabRef.current = true;
    setActiveTab(tab);
  };
  const showSummaryTab = columnId === 'review' || columnId === 'done';
  const summaryText = task?.summary ?? null;
  // The "Completed" section is required; flag when it's missing or empty.
  const completedSectionFilled = useMemo(() => {
    if (!summaryText) return false;
    const m = summaryText.match(/##\s*Completed\s*\r?\n([\s\S]*?)(?:\r?\n##\s|$)/i);
    return !!(m && m[1].trim().length > 0);
  }, [summaryText]);

  const coalescedEvents = useMemo(
    () => coalesceEvents(events, streaming),
    [events, streaming]
  );

  // Derive file changes for the Changes tab
  const fileChanges = useMemo(() => {
    const files = new Map<string, { type: 'created' | 'modified' | 'read'; content: string; diff?: string }>();
    for (const event of events) {
      const file = event.metadata?.file;
      if (!file) continue;
      if (event.type === 'file_write') {
        files.set(file, { type: files.has(file) ? 'modified' : 'created', content: event.content, diff: event.metadata?.diff });
      } else if (event.type === 'file_edit') {
        files.set(file, { type: 'modified', content: event.content, diff: event.metadata?.diff });
      } else if (event.type === 'command' && event.metadata?.fileEventType === 'file_write') {
        // bash commands that write files (cat > file, etc.)
        files.set(file, { type: files.has(file) ? 'modified' : 'created', content: event.content });
      } else if (event.type === 'command_output' && event.metadata?.fileEventType) {
        const isWrite = event.metadata.fileEventType === 'file_write' || event.metadata.fileEventType === 'file_edit';
        if (isWrite) {
          files.set(file, { type: files.has(file) ? 'modified' : 'created', content: event.content, diff: event.metadata?.diff });
        }
      } else if (event.type === 'file_read' && !files.has(file)) {
        files.set(file, { type: 'read', content: event.content });
      }
    }
    return [...files.entries()].map(([path, info]) => ({ path, ...info }));
  }, [events]);

  const failedWithoutDetails = task?.agentStatus === 'failed' && !latestError;

  const handleSendFollowUp = async () => {
    if (!task || (!followUpMessage.trim() && followUpImages.length === 0) || sending) return;
    const message = followUpMessage.trim();
    setSending(true);
    setFollowUpMessage('');
    const imagesToUpload = [...followUpImages];
    setFollowUpImages([]);

    // Show locally immediately
    const imageNote = imagesToUpload.length > 0 ? ` [+${imagesToUpload.length} image${imagesToUpload.length > 1 ? 's' : ''}]` : '';
    setEvents((prev) => [...prev, {
      id: `fu-${Date.now()}`,
      taskId: task.id,
      type: 'command' as const,
      content: `You: ${message || '(images only)'}${imageNote}`,
      timestamp: Date.now(),
    }]);
    try {
      let attachmentIds: string[] | undefined;
      if (imagesToUpload.length > 0) {
        const uploaded = await api.uploadAttachments(task.id, imagesToUpload);
        attachmentIds = uploaded.map(a => a.id);
      }
      await api.sendMessage(task.id, message || 'See the attached images.', attachmentIds);
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
            transition={{ type: 'spring', damping: 26, stiffness: 260 }}
            className="panel-neon fixed right-0 top-0 z-[60] flex h-full w-full flex-col rounded-l-[1.75rem] shadow-2xl md:max-w-md md:w-[460px]"
            style={{ '--panel': 'var(--color-neon-blue)' } as React.CSSProperties}
          >
          {/* Progress bar */}
          {(task.agentStatus === 'planning' || task.agentStatus === 'executing' || task.agentStatus === 'complete') && (
            <div className="h-2 w-full bg-ink shrink-0 rounded-tl-[1.75rem] overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all duration-700 ease-in-out',
                  task.agentStatus === 'complete'
                    ? 'w-full bg-neon-green'
                    : task.agentStatus === 'executing'
                      ? 'w-3/5 bg-primary animate-px-blink'
                      : 'w-1/4 bg-neon-purple animate-px-blink'
                )}
              />
            </div>
          )}

          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b-2 border-border px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-display text-lg leading-tight [text-transform:lowercase]">{task.title}</h3>
              <div className="mt-1 flex items-center gap-2.5 font-pixel text-[10px]">
                {task.agentType && agentDisplay && (
                  <span className="flex items-center gap-1 text-muted-foreground [text-transform:lowercase]">
                    <PixelIcon name="chipset" className="h-3 w-3" />
                    {agentDisplay.label}
                  </span>
                )}
                {isActive && (
                  <span className="flex items-center gap-1 text-primary [text-transform:lowercase]">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping bg-primary opacity-75" />
                      <span className="relative inline-flex h-2 w-2 bg-primary" />
                    </span>
                    active
                  </span>
                )}
                {task.agentStatus === 'complete' && (
                  <span className="flex items-center gap-1 text-neon-green [text-transform:lowercase]">
                    <PixelIcon name="rating-star-1" className="h-3 w-3" />
                    complete
                  </span>
                )}
                {task.agentStatus === 'failed' && (
                  <span className="flex items-center gap-1 text-destructive [text-transform:lowercase]">
                    <PixelIcon name="alert-triangle-1" className="h-3 w-3" />
                    failed
                  </span>
                )}
                <span className="text-muted-foreground [text-transform:lowercase]">
                  {events.length} events
                </span>
              </div>
            </div>
            <div className="ml-3 flex items-center gap-2">
              {/* Run / Stop / Retry buttons */}
              {!isActive && task.agentStatus !== 'complete' && onRun && (
                <button
                  onClick={() => onRun(task.id)}
                  className="sticker-sm sticker-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: 'var(--color-neon-green)', color: 'var(--color-ink)' }}
                  title={task.agentStatus === 'failed' ? 'Retry agent' : 'Run agent'}
                >
                  <PixelIcon name={task.agentStatus === 'failed' ? 'recycle' : 'flash'} className="h-5 w-5" />
                </button>
              )}
              {!isActive && task.agentStatus === 'failed' && onReconfigureRetry && (
                <button
                  onClick={() => onReconfigureRetry(task.id)}
                  className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border-2 border-border bg-card px-3 font-pixel text-[11px] text-neon-yellow hover:border-neon-yellow transition-colors [text-transform:lowercase]"
                  title="Reconfigure and retry"
                >
                  <PixelIcon name="cog-browser" className="h-3.5 w-3.5" />
                  reconfigure
                </button>
              )}
              {isActive && onStop && (
                <button
                  onClick={() => onStop(task.id)}
                  className="sticker-sm sticker-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-cream"
                  title="Stop agent"
                >
                  <span className="block h-3 w-3 bg-current" aria-hidden="true" />
                </button>
              )}
              <button
                onClick={onClose}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-card font-pixel text-foreground hover:border-destructive hover:bg-destructive hover:text-cream transition-colors"
                title="Close panel (Esc)"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Task description as collapsible markdown */}
          {/* WARNING: Do NOT add rehype-raw — it would allow raw HTML injection (XSS). */}
          {task.description && (
            <div className="shrink-0 border-b-2 border-border">
              <button
                onClick={() => setDescExpanded(!descExpanded)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors"
              >
                <PixelIcon name="open-book-bookmark" className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="font-pixel text-[11px] text-foreground [text-transform:lowercase]">task description</span>
                <span className="font-pixel text-[10px] text-muted-foreground ml-1">
                  {task.description.length > 200 ? `${Math.round(task.description.length / 100) * 100}+ chars` : ''}
                </span>
                <span className={cn('ml-auto shrink-0 font-pixel text-sm text-muted-foreground transition-transform', descExpanded && 'rotate-90')} aria-hidden="true">›</span>
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
            <div className="shrink-0 border-b-2 border-border px-4 py-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <PixelIcon name="hierarchy-2" className="h-3.5 w-3.5 text-neon-blue" />
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
                  {!prUrl && onCreatePR && hasRemote === true && (
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
                      className="sticker-sm sticker-press flex items-center gap-1.5 rounded-full px-3 py-1.5 font-pixel text-[10px] disabled:opacity-50 [text-transform:lowercase]"
                      style={{ backgroundColor: 'var(--color-neon-green)', color: 'var(--color-ink)' }}
                    >
                      <PixelIcon name="hyperlink" className="h-3.5 w-3.5" />
                      {prLoading ? 'creating…' : 'create pr'}
                    </button>
                  )}
                  {prUrl && (
                    <a
                      href={prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-full border-2 border-neon-green/40 bg-neon-green/10 px-3 py-1.5 font-pixel text-[10px] text-neon-green hover:bg-neon-green/20 transition-colors [text-transform:lowercase]"
                    >
                      <PixelIcon name="hyperlink" className="h-3.5 w-3.5" />
                      view pr
                    </a>
                  )}
                  {!mergeResult && task.branchName && onMergeLocal && (
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
                      className="sticker-sm sticker-press flex items-center gap-1.5 rounded-full px-3 py-1.5 font-pixel text-[10px] disabled:opacity-50 [text-transform:lowercase]"
                      style={{ backgroundColor: 'var(--color-neon-purple)', color: 'var(--color-ink)' }}
                    >
                      <PixelIcon name="deal-handshake" className="h-3.5 w-3.5" />
                      {mergeLoading ? 'merging…' : `merge to ${task.baseBranch || 'main'}`}
                    </button>
                  )}
                  {mergeResult && (
                    <span className="flex items-center gap-1.5 rounded-full border-2 border-neon-green/40 bg-neon-green/10 px-3 py-1.5 font-pixel text-[10px] text-neon-green [text-transform:lowercase]">
                      <PixelIcon name="deal-handshake" className="h-3.5 w-3.5" />
                      merged to {mergeResult}
                    </span>
                  )}
                  {task.worktreePath && onCleanupWorktree && (
                    <button
                      onClick={() => setShowWorktreeConfirm(true)}
                      className="flex items-center gap-1.5 rounded-full border-2 border-border bg-card px-3 py-1.5 font-pixel text-[10px] text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive transition-colors [text-transform:lowercase]"
                    >
                      <PixelIcon name="bin" className="h-3.5 w-3.5" />
                      clean up worktree
                    </button>
                  )}
                </div>
              )}

              {/* PR / merge errors */}
              {prError && <ErrorBanner message={prError} onDismiss={() => setPrError(null)} />}
              {mergeError && <ErrorBanner message={mergeError} onDismiss={() => setMergeError(null)} />}
            </div>
          )}
          {showWorktreeConfirm && (
            <div className="mx-4 my-2 rounded-2xl border-2 border-neon-yellow/40 bg-neon-yellow/10 p-3.5">
              <p className="flex items-center gap-1.5 font-display text-sm text-neon-yellow mb-1.5 [text-transform:lowercase]">
                <PixelIcon name="alert-triangle-1" className="h-4 w-4" />
                delete worktree?
              </p>
              <p className="text-xs text-foreground/70 mb-3">
                This removes the worktree directory and its files. If you haven't created a PR yet, you won't be able to push these changes afterward.
              </p>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setShowWorktreeConfirm(false)}
                  className="h-9 rounded-full border-2 border-border px-3.5 font-pixel text-[11px] text-foreground/80 hover:border-foreground/40 transition-colors [text-transform:lowercase]"
                >
                  cancel
                </button>
                <button
                  onClick={() => {
                    setShowWorktreeConfirm(false);
                    if (task && onCleanupWorktree) onCleanupWorktree(task.id);
                  }}
                  className="sticker-sm sticker-press flex h-9 items-center gap-1.5 rounded-full bg-destructive px-3.5 font-pixel text-[11px] text-cream [text-transform:lowercase]"
                >
                  <PixelIcon name="bin" className="h-3.5 w-3.5" />
                  delete worktree
                </button>
              </div>
            </div>
          )}

          {task.agentStatus === 'failed' && (
            <FailureSummary
              message={latestError?.content || 'The agent failed before it wrote an error log. Retry or reconfigure the task to capture the current failure reason.'}
            />
          )}

          {/* Tab bar — chunky sticker tabs */}
          <div className="shrink-0 flex items-center justify-between gap-2 border-b-2 border-border px-3 py-2.5">
            <div className="flex flex-wrap gap-2">
            {showSummaryTab && (
              <TabButton active={activeTab === 'summary'} onClick={() => selectTab('summary')} icon="certified-diploma" hue="var(--color-neon-green)">
                summary
              </TabButton>
            )}
            <TabButton active={activeTab === 'events'} onClick={() => selectTab('events')} icon="message" hue="var(--color-neon-pink)">
              events
            </TabButton>
            <TabButton active={activeTab === 'terminal'} onClick={() => selectTab('terminal')} icon="old-electronics" hue="var(--color-neon-blue)">
              terminal
            </TabButton>
            <TabButton active={activeTab === 'changes'} onClick={() => selectTab('changes')} icon="quill-ink" hue="var(--color-neon-yellow)">
              actions{fileChanges.length > 0 ? ` (${fileChanges.length})` : ''}
            </TabButton>
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
                className="flex shrink-0 items-center gap-1 rounded-full border-2 border-border px-2.5 py-1.5 font-pixel text-[10px] text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors [text-transform:lowercase]"
                title="Download event log as markdown"
              >
                <PixelIcon name="clound-download" className="h-3.5 w-3.5" />
                export
              </button>
            )}
          </div>

          {/* Summary view */}
          {activeTab === 'summary' && (
            <div className="flex-1 overflow-y-auto p-4">
              {summaryText ? (
                <>
                  {!completedSectionFilled && (
                    <div className="mb-3 flex items-center gap-2 rounded-xl border-2 border-neon-yellow/40 bg-neon-yellow/10 px-3 py-2.5 font-pixel text-[11px] text-neon-yellow [text-transform:lowercase]">
                      <PixelIcon name="alert-triangle-1" className="h-4 w-4 shrink-0" />
                      the required “completed” section is empty or missing.
                    </div>
                  )}
                  <div className="prose prose-sm dark:prose-invert max-w-none text-foreground [&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2:first-child]:mt-0">
                    <Markdown>{summaryText}</Markdown>
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center">
                    <PixelIcon name="certified-diploma" className="animate-px-bob mx-auto h-11 w-11 text-muted-foreground/30" />
                    <p className="mt-3 font-pixel text-[11px] text-muted-foreground/60 [text-transform:lowercase]">no summary was provided for this task.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Terminal view */}
          {activeTab === 'terminal' && (
            <div className={cn('flex-1 overflow-hidden', theme === 'light' ? 'bg-cream' : 'bg-ink')}>
              <TerminalView events={events} streaming={streaming} theme={theme} />
            </div>
          )}

          {/* Changes list */}
          {activeTab === 'changes' && (
            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
              {fileChanges.length === 0 && (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center">
                    <PixelIcon name="quill-ink" className="animate-px-bob mx-auto h-11 w-11 text-muted-foreground/30" />
                    <p className="mt-3 font-pixel text-[11px] text-muted-foreground/60 [text-transform:lowercase]">no actions yet</p>
                  </div>
                </div>
              )}
              {fileChanges.map((file) => (
                <details key={file.path} className="group rounded-xl border-2 border-border bg-card">
                  <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm hover:bg-accent/50 rounded-xl">
                    <PixelIcon
                      name={file.type === 'created' ? 'rating-star-1' : file.type === 'modified' ? 'quill-ink' : 'open-book-bookmark'}
                      className={cn('h-4 w-4 shrink-0', file.type === 'created' ? 'text-neon-green' : file.type === 'modified' ? 'text-neon-yellow' : 'text-neon-blue')}
                    />
                    <span className="flex-1 font-mono text-xs text-foreground truncate" title={file.path}>{file.path}</span>
                    <span className="font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">{file.type}</span>
                  </summary>
                  <div className="border-t-2 border-border px-3 py-2 overflow-x-auto">
                    <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">{file.diff || file.content}</pre>
                  </div>
                </details>
              ))}
            </div>
          )}

          {/* Events list */}
          {activeTab === 'events' && (
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-2 space-y-0.5"
          >
            {coalescedEvents.length === 0 && !streaming && failedWithoutDetails && (
              <div className="flex h-full items-center justify-center p-4">
                <div className="w-full rounded-2xl border-2 border-destructive/40 bg-destructive/10 p-5 text-center">
                  <PixelIcon name="alert-triangle-1" className="animate-px-bob mx-auto h-11 w-11 text-destructive" />
                  <p className="mt-3 font-display text-base text-destructive [text-transform:lowercase]">
                    agent failed
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-destructive/80">
                    This run did not record an error event. Use Reconfigure or Retry to run it again and capture details.
                  </p>
                </div>
              </div>
            )}

            {coalescedEvents.length === 0 && !streaming && !failedWithoutDetails && (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <PixelIcon name="light-bulb" className="animate-px-bob mx-auto h-11 w-11 text-muted-foreground/30" />
                  <p className="mt-3 font-pixel text-[11px] text-muted-foreground/60 [text-transform:lowercase]">
                    no agent activity yet
                  </p>
                  <p className="mt-1.5 font-pixel text-[10px] text-muted-foreground/40 [text-transform:lowercase]">
                    assign this task to start the agent
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
                    className="h-2 w-2 bg-neon-pink"
                  />
                  <motion.div
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: 0.2 }}
                    className="h-2 w-2 bg-neon-yellow"
                  />
                  <motion.div
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: 0.4 }}
                    className="h-2 w-2 bg-neon-green"
                  />
                </div>
                <span className="font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                  agent is working…
                </span>
              </motion.div>
            )}
          </div>
          )}

          {/* Follow-up message input — fixed at bottom */}
          <div className="shrink-0 border-t-2 border-border bg-card/60 px-3 py-3 rounded-bl-[1.75rem]">
            {/* Image previews */}
            {followUpImages.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {followUpImages.map((f, i) => (
                  <div key={i} className="relative group">
                    <FollowUpImagePreview file={f} />
                    <button
                      type="button"
                      onClick={() => setFollowUpImages(prev => prev.filter((_, j) => j !== i))}
                      className="sticker-sm absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-cream font-pixel text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
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
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                    setFollowUpImages(prev => [...prev, ...Array.from(e.target.files!)]);
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
                placeholder="message the agent…"
                disabled={agentStatus !== 'executing' || sending}
                className="h-10 flex-1 rounded-xl border-2 border-border bg-card px-3 font-pixel text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:border-neon-pink focus:outline-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed [text-transform:lowercase]"
              />
              <button
                onClick={handleSendFollowUp}
                disabled={agentStatus !== 'executing' || sending || (!followUpMessage.trim() && followUpImages.length === 0)}
                className="sticker-sm sticker-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                title="Send message"
              >
                <PixelIcon name="cursor-click-point" className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** A chunky sticker tab. Active = neon fill + ink text + hard shadow. */
function TabButton({ active, onClick, icon, hue, children }: { active: boolean; onClick: () => void; icon: string; hue: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-10 items-center gap-1.5 rounded-full px-3.5 font-display text-sm transition-all [text-transform:lowercase]',
        active
          ? 'sticker-sm border-ink'
          : 'border-2 border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
      )}
      style={active ? { backgroundColor: hue, color: 'var(--color-ink)' } : undefined}
    >
      <PixelIcon name={icon} className="h-4 w-4" />
      {children}
    </button>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="rounded-xl border-2 border-destructive/40 bg-destructive/10 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="whitespace-pre-wrap font-mono text-xs text-destructive">{message}</p>
        <button
          onClick={() => navigator.clipboard.writeText(message)}
          className="shrink-0 rounded-md px-2 py-1 font-pixel text-[10px] text-destructive hover:bg-destructive/20 [text-transform:lowercase]"
        >
          copy
        </button>
      </div>
      <button
        onClick={onDismiss}
        className="mt-2 font-pixel text-[10px] text-muted-foreground hover:text-foreground [text-transform:lowercase]"
      >
        dismiss
      </button>
    </div>
  );
}

function FailureSummary({ message }: { message: string }) {
  return (
    <div className="shrink-0 border-b-2 border-border px-4 py-3">
      <div className="rounded-2xl border-2 border-destructive/40 bg-destructive/10 p-3.5">
        <div className="flex items-start gap-2">
          <PixelIcon name="alert-triangle-1" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm text-destructive [text-transform:lowercase]">agent failed</p>
            <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-destructive/80">
              {message}
            </p>
          </div>
          <CopyButton text={message} />
        </div>
      </div>
    </div>
  );
}

function FollowUpImagePreview({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt={file.name} className="w-10 h-10 object-cover rounded-lg border-2 border-ink" />;
}
