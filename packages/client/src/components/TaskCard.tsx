import { useState, useEffect, useRef, memo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Task, AgentStatus } from '@/types';
import { getAgentDisplay } from '@/lib/agent-config';
import { getPriorityDisplay } from '@/lib/priority-config';
import { cn, formatDuration, isCoarsePointer } from '@/lib/utils';
import { PixelIcon } from '@/components/PixelIcon';
import { FcStateBadge } from '@/components/fc/FcStateBadge';
import { taskToFcState } from '@/components/fc/taskToFcState';
import { FC_STATE_META } from '@/components/fc/fcState';
import { useNeedsInput } from '@/components/fc/useNeedsInput';
import { FcCelebration } from '@/components/fc/FcCelebration';
import { ConfettiOverlay, type ConfettiRect } from '@/components/ConfettiOverlay';


// Module-level (not component state) so it survives TaskCard remounting.
// Each kanban column is a separate droppable subtree, so a task moving between
// columns — exactly what happens when an agent finishes, since the server sets
// agentStatus + columnId in the same update — unmounts and remounts TaskCard.
// A `useRef` reset on that remount would never observe the "not finished →
// finished" transition, so the celebration is tracked here instead, keyed by
// task id, for the lifetime of the page.
const lastFinishedById = new Map<string, boolean>();

const agentStatusConfig: Record<
  AgentStatus,
  { icon: string; label: string; className: string; spin?: boolean; pulse?: boolean }
> = {
  idle:      { icon: 'alarm-bell-sleep', label: 'Idle',      className: 'text-muted-foreground' },
  planning:  { icon: 'light-bulb',       label: 'Planning',  className: 'text-neon-purple', pulse: true },
  executing: { icon: 'loading-circle-1', label: 'Executing', className: 'text-neon-blue', spin: true },
  complete:  { icon: 'rating-star-1',    label: 'Complete',  className: 'text-neon-green' },
  failed:    { icon: 'alert-triangle-1', label: 'Failed',    className: 'text-destructive' },
};

function formatElapsed(startedAt?: number): string {
  if (!startedAt) return '';
  return formatDuration(Date.now() - startedAt);
}

function formatCompletedDuration(startedAt?: number, completedAt?: number): string {
  if (!startedAt || !completedAt) return '';
  return formatDuration(completedAt - startedAt);
}

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  onArchive?: (task: Task) => void;
  onUnarchive?: (task: Task) => void;
  onRetry?: (task: Task) => void;
  onExpand?: (task: Task) => void;
}

function TaskCardComponent({ task, onClick, onEdit, onDelete, onArchive, onUnarchive, onRetry, onExpand }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id, disabled: task.archived });
  const agentDisplay = task.agentType ? getAgentDisplay(task.agentType) : undefined;

  const wasDragging = useRef(false);
  useEffect(() => {
    if (isDragging) {
      wasDragging.current = true;
    } else if (wasDragging.current) {
      const id = requestAnimationFrame(() => { wasDragging.current = false; });
      return () => cancelAnimationFrame(id);
    }
  }, [isDragging]);

  const style = isDragging && transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  const agentStatus = agentStatusConfig[task.agentStatus];
  const isActive = task.agentStatus === 'executing' || task.agentStatus === 'planning';
  const retryPending = typeof task.retryAt === 'number' && task.retryAt > Date.now();
  const retryLabel = retryPending
    ? new Date(task.retryAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';
  const priorityDisplay = getPriorityDisplay(task.priority);
  const needsInput = useNeedsInput(task.id);
  const fcState = taskToFcState(task, needsInput);

  const cardRef = useRef<HTMLDivElement>(null);
  const finished = task.agentStatus === 'complete' || task.columnId === 'done';
  const [celebrate, setCelebrate] = useState(false);
  const [confettiRect, setConfettiRect] = useState<ConfettiRect | null>(null);
  useEffect(() => {
    const wasFinished = lastFinishedById.get(task.id);
    lastFinishedById.set(task.id, finished);
    // Only celebrate on an observed not-finished -> finished transition — never
    // on first sight of an already-finished task (e.g. reloading the board).
    if (finished && wasFinished === false) {
      setCelebrate(true);
      // Viewport-coordinate confetti only on fine pointers: the rect is
      // captured once and held for 2.6s, so on the scrolling touch board it
      // goes stale mid-scroll and the burst plays at the wrong position. The
      // card-local FcCelebration still plays there.
      if (!isCoarsePointer() && cardRef.current) {
        const rect = cardRef.current.getBoundingClientRect();
        setConfettiRect({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
      }
      const id = setTimeout(() => {
        setCelebrate(false);
        setConfettiRect(null);
      }, 2600);
      return () => clearTimeout(id);
    }
  }, [finished, task.id]);

  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    if (!isActive || !task.startedAt) { setElapsed(''); return; }
    const tick = () => setElapsed(formatElapsed(task.startedAt!));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isActive, task.startedAt]);

  return (
    <div
      ref={(node) => { setNodeRef(node); (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = node; }}
      style={style}
      {...attributes}
      {...listeners}
      data-fc-state={fcState}
      className={cn(
        'fc-card',
        'group relative cursor-grab active:cursor-grabbing rounded-2xl max-md:p-3 md:p-3 lg:p-4',
        // Long-press drag (TouchSensor) must not fight iOS text selection,
        // the touch callout menu, or double-tap zoom.
        'select-none touch-manipulation [-webkit-touch-callout:none]',
        isDragging && 'z-50 rotate-2 scale-105 opacity-90',
        task.archived && 'opacity-60 saturate-50'
      )}
      onClick={() => { if (!wasDragging.current) onClick(); }}
    >
      {/* Priority edge — a chunky neon tab hugging the left side */}
      {priorityDisplay?.accent && (
        <span
          aria-hidden="true"
          className="absolute -left-0.5 bottom-4 top-4 w-1.5 rounded-r-full"
          style={{ backgroundColor: priorityDisplay.accent }}
        />
      )}

      <div>
        {/* Header: title + actions. On touch (and no-hover devices) the
            actions are a static right-aligned row in the flow so they never
            cover the title; on fine pointers they become the classic
            absolute hover-reveal overlay. */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 line-clamp-2 text-lg font-bold leading-snug tracking-tight text-card-foreground pointer-fine:pr-16">
            {priorityDisplay && <span className="mr-1.5">{priorityDisplay.emoji}</span>}{task.title}
          </h3>

          {(onEdit || onDelete || onArchive || onUnarchive || onRetry || onExpand) && (
            <div
              className="flex shrink-0 items-center gap-1 transition-opacity pointer-coarse:-mr-1.5 pointer-coarse:-mt-1 pointer-coarse:gap-2 pointer-fine:absolute pointer-fine:right-2.5 pointer-fine:top-2.5 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              {onExpand && task.columnId !== 'backlog' && (
                <button
                  onClick={(e) => { e.stopPropagation(); onExpand(task); }}
                  className="flex size-7 pointer-coarse:size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
                  aria-label="Expand task view"
                  title="Open full view"
                >
                  <PixelIcon name="expand-1" className="h-3.5 w-3.5 pointer-coarse:h-4 pointer-coarse:w-4" />
                </button>
              )}
              {onRetry && task.agentStatus === 'failed' && !task.archived && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRetry(task); }}
                  className="flex size-7 pointer-coarse:size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-neon-yellow"
                  aria-label="Retry task"
                >
                  <PixelIcon name="recycle" className="h-3.5 w-3.5 pointer-coarse:h-4 pointer-coarse:w-4" />
                </button>
              )}
              {onEdit && !task.archived && (
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(task); }}
                  className="flex size-7 pointer-coarse:size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Edit task"
                >
                  <PixelIcon name="quill-ink" className="h-3.5 w-3.5 pointer-coarse:h-4 pointer-coarse:w-4" />
                </button>
              )}
              {onArchive && (task.columnId === 'done' || task.agentStatus === 'failed') && !task.archived && (
                <button
                  onClick={(e) => { e.stopPropagation(); onArchive(task); }}
                  className="flex size-7 pointer-coarse:size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Archive task"
                >
                  <PixelIcon name="floppy-disk" className="h-3.5 w-3.5 pointer-coarse:h-4 pointer-coarse:w-4" />
                </button>
              )}
              {onUnarchive && task.archived && (
                <button
                  onClick={(e) => { e.stopPropagation(); onUnarchive(task); }}
                  className="flex size-7 pointer-coarse:size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Unarchive task"
                >
                  <PixelIcon name="floppy-disk" className="h-3.5 w-3.5 pointer-coarse:h-4 pointer-coarse:w-4" />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(task); }}
                  className="flex size-7 pointer-coarse:size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                  aria-label="Delete task"
                >
                  <PixelIcon name="bin" className="h-3.5 w-3.5 pointer-coarse:h-4 pointer-coarse:w-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Description */}
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {task.description}
        </p>

        {/* State badge */}
        <div className="mt-3">
          <FcStateBadge state={fcState} />
        </div>

        {/* Footer */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-y-1">
          <div className="flex min-w-0 items-center gap-2">
            {task.agentType && task.columnId !== 'backlog' && (
              <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 font-pixel text-[10px] text-accent-foreground">
                <PixelIcon name="chipset" className="h-3 w-3 shrink-0" />
                <span className="truncate">{agentDisplay?.label}</span>
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {retryPending && (
              <span
                className="flex items-center gap-1 rounded-full border-2 border-neon-yellow/40 bg-neon-yellow/10 px-2 py-0.5 font-pixel text-[10px] text-neon-yellow"
                title={`Auto-retry after token limit at ${new Date(task.retryAt!).toLocaleString()}`}
              >
                <PixelIcon name="recycle" className="h-3 w-3" />
                retry {retryLabel}
              </span>
            )}

            {isActive && elapsed && (
              <span className="flex items-center gap-1 font-pixel text-[10px] text-muted-foreground">
                <PixelIcon name="clock" className="h-3 w-3" />
                {elapsed}
              </span>
            )}

            {!isActive && (task.agentStatus === 'complete' || task.agentStatus === 'failed') && task.startedAt && task.completedAt && (
              <span className="flex items-center gap-1 font-pixel text-[10px] text-muted-foreground">
                <PixelIcon name="clock" className="h-3 w-3" />
                {formatCompletedDuration(task.startedAt, task.completedAt)}
              </span>
            )}

            {/* Agent status icon */}
            <div className={cn('flex items-center gap-1', agentStatus.className)} title={agentStatus.label}>
              <PixelIcon
                name={agentStatus.icon}
                className={cn(
                  'h-4 w-4',
                  agentStatus.spin && 'animate-px-spin-fast',
                  agentStatus.pulse && 'animate-px-blink'
                )}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Working progress bar */}
      {FC_STATE_META[fcState].working && (
        <div className="fc-card-bar" aria-hidden="true">
          <i />
        </div>
      )}

      {celebrate && <FcCelebration />}
      {confettiRect && <ConfettiOverlay rect={confettiRect} />}
    </div>
  );
}

export const TaskCard = memo(TaskCardComponent);
