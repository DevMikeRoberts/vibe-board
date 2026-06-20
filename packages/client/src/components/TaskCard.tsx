import { useState, useEffect, useRef, memo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  Clock,
  Brain,
  Cog,
  CheckCircle2,
  AlertCircle,
  Circle,
  Pencil,
  Trash2,
  Archive,
  RotateCw,
} from 'lucide-react';
import type { Task, AgentStatus } from '@/types';
import { getAgentDisplay } from '@/lib/agent-config';
import { getPriorityDisplay } from '@/lib/priority-config';
import { cn, formatDuration } from '@/lib/utils';
import { FcStateBadge } from '@/components/fc/FcStateBadge';
import { taskToFcState } from '@/components/fc/taskToFcState';
import { FC_STATE_META } from '@/components/fc/fcState';
import { useNeedsInput } from '@/components/fc/useNeedsInput';
import { FcCelebration } from '@/components/fc/FcCelebration';


const agentStatusConfig: Record<
  AgentStatus,
  { icon: React.ElementType; label: string; className: string }
> = {
  idle: { icon: Circle, label: 'Idle', className: 'text-muted-foreground' },
  planning: { icon: Brain, label: 'Planning', className: 'text-purple-400' },
  executing: { icon: Cog, label: 'Executing', className: 'text-blue-400' },
  complete: { icon: CheckCircle2, label: 'Complete', className: 'text-emerald-400' },
  failed: { icon: AlertCircle, label: 'Failed', className: 'text-red-400' },
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
}

function TaskCardComponent({ task, onClick, onEdit, onDelete, onArchive, onUnarchive, onRetry }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: task.id,
      disabled: task.archived // Disable dragging for archived tasks
    });
  const agentDisplay = task.agentType ? getAgentDisplay(task.agentType) : undefined;

  // Suppress click that fires immediately after a drag ends
  const wasDragging = useRef(false);
  useEffect(() => {
    if (isDragging) {
      wasDragging.current = true;
    } else if (wasDragging.current) {
      // Clear on next frame so the click event from drag-end is suppressed
      const id = requestAnimationFrame(() => { wasDragging.current = false; });
      return () => cancelAnimationFrame(id);
    }
  }, [isDragging]);

  const style = isDragging && transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  const agentStatus = agentStatusConfig[task.agentStatus];
  const StatusIcon = agentStatus.icon;
  const isActive = task.agentStatus === 'executing' || task.agentStatus === 'planning';
  const priorityDisplay = getPriorityDisplay(task.priority);
  const needsInput = useNeedsInput(task.id);
  const fcState = taskToFcState(task, needsInput);

  // Fire a one-off celebration when the task crosses into a finished state.
  const finished = task.agentStatus === 'complete' || task.columnId === 'done';
  const prevFinishedRef = useRef(finished);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (finished && !prevFinishedRef.current) {
      setCelebrate(true);
      const id = setTimeout(() => setCelebrate(false), 2600);
      prevFinishedRef.current = finished;
      return () => clearTimeout(id);
    }
    prevFinishedRef.current = finished;
  }, [finished]);

  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    if (!isActive || !task.startedAt) {
      setElapsed('');
      return;
    }
    const tick = () => setElapsed(formatElapsed(task.startedAt!));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isActive, task.startedAt]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-fc-state={fcState}
      className={cn(
        'fc-card',
        'group relative cursor-grab active:cursor-grabbing rounded-lg border border-border bg-card p-3 shadow-sm transition-all',
        'hover:border-primary/30 hover:shadow-md',
        priorityDisplay?.borderClass,
        isDragging && 'z-50 rotate-2 scale-105 shadow-xl opacity-90',
        isActive && 'border-primary/20',
        task.archived && 'opacity-60 bg-muted'
      )}
      onClick={() => { if (!wasDragging.current) onClick(); }}
    >

      {/* Action buttons — top right, visible on hover */}
      {(onEdit || onDelete || onArchive || onUnarchive || onRetry) && (
        <div
          className="absolute right-2 top-2 flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {onRetry && task.agentStatus === 'failed' && !task.archived && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetry(task);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-amber-400"
              aria-label="Retry task"
            >
              <RotateCw className="h-3 w-3" />
            </button>
          )}
          {onEdit && !task.archived && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(task);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Edit task"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          {onArchive && (task.columnId === 'done' || task.agentStatus === 'failed') && !task.archived && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onArchive(task);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Archive task"
            >
              <Archive className="h-3 w-3" />
            </button>
          )}
          {onUnarchive && task.archived && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUnarchive(task);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Unarchive task"
            >
              <Archive className="h-3 w-3" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(task);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-red-400"
              aria-label="Delete task"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      <div>
        {/* Title with priority emoji */}
        <h3 className="line-clamp-2 pr-16 text-base font-medium leading-snug text-card-foreground">
          {priorityDisplay && <span className="mr-1">{priorityDisplay.emoji}</span>}{task.title}
        </h3>

        {/* Description preview */}
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {task.description}
        </p>

        {/* Agent card state badge (card-states feature) */}
        <div className="mt-2">
          <FcStateBadge state={fcState} />
        </div>

        {/* Footer */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Agent type badge */}
            {task.agentType && task.columnId !== 'backlog' && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {agentDisplay?.emoji} {agentDisplay?.label}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Elapsed time (running) */}
            {isActive && elapsed && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {elapsed}
              </span>
            )}

            {/* Duration (completed/failed) */}
            {!isActive && (task.agentStatus === 'complete' || task.agentStatus === 'failed') && task.startedAt && task.completedAt && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatCompletedDuration(task.startedAt, task.completedAt)}
              </span>
            )}

            {/* Agent status */}
            <div className={cn('flex items-center gap-1', agentStatus.className)}>
              <StatusIcon
                className={cn(
                  'h-3.5 w-3.5',
                  task.agentStatus === 'executing' && 'animate-spin',
                  task.agentStatus === 'planning' && 'animate-pulse'
                )}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Agent working progress bar — large, pinned to the card bottom (card-states) */}
      {FC_STATE_META[fcState].working && (
        <div className="fc-card-bar" aria-hidden="true">
          <i />
        </div>
      )}

      {/* One-off green glow + confetti when the task finishes (card-states) */}
      {celebrate && <FcCelebration />}
    </div>
  );
}

export const TaskCard = memo(TaskCardComponent);
