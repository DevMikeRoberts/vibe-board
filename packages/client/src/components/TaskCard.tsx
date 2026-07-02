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
  Maximize2,
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
  { icon: React.ElementType; label: string; className: string; glowColor: string }
> = {
  idle:      { icon: Circle,       label: 'Idle',      className: 'text-muted-foreground', glowColor: 'transparent' },
  planning:  { icon: Brain,        label: 'Planning',  className: 'text-purple-400',       glowColor: 'rgba(168,85,247,0.6)' },
  executing: { icon: Cog,          label: 'Executing', className: 'text-blue-400',         glowColor: 'rgba(96,165,250,0.6)' },
  complete:  { icon: CheckCircle2, label: 'Complete',  className: 'text-emerald-400',      glowColor: 'rgba(52,211,153,0.6)' },
  failed:    { icon: AlertCircle,  label: 'Failed',    className: 'text-red-400',          glowColor: 'rgba(248,113,113,0.6)' },
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
  const StatusIcon = agentStatus.icon;
  const isActive = task.agentStatus === 'executing' || task.agentStatus === 'planning';
  const retryPending = typeof task.retryAt === 'number' && task.retryAt > Date.now();
  const retryLabel = retryPending
    ? new Date(task.retryAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';
  const priorityDisplay = getPriorityDisplay(task.priority);
  const needsInput = useNeedsInput(task.id);
  const fcState = taskToFcState(task, needsInput);

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
    if (!isActive || !task.startedAt) { setElapsed(''); return; }
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
        'group relative cursor-grab active:cursor-grabbing rounded-2xl p-3.5 transition-all duration-200',
        'hover:scale-[1.01]',
        priorityDisplay?.borderClass,
        isDragging && 'z-50 rotate-2 scale-105 shadow-2xl opacity-90',
        task.archived && 'opacity-50'
      )}
      onClick={() => { if (!wasDragging.current) onClick(); }}
    >
      {/* Hover shine overlay */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 60%)',
        }}
        aria-hidden="true"
      />

      {/* Action buttons */}
      {(onEdit || onDelete || onArchive || onUnarchive || onRetry || onExpand) && (
        <div
          className="absolute right-2 top-2 flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {onExpand && task.columnId !== 'backlog' && (
            <button
              onClick={(e) => { e.stopPropagation(); onExpand(task); }}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-primary/15 hover:text-primary"
              aria-label="Expand task view"
              title="Open full view"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          )}
          {onRetry && task.agentStatus === 'failed' && !task.archived && (
            <button
              onClick={(e) => { e.stopPropagation(); onRetry(task); }}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-amber-500/15 hover:text-amber-400"
              aria-label="Retry task"
            >
              <RotateCw className="h-3 w-3" />
            </button>
          )}
          {onEdit && !task.archived && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(task); }}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-white/8 hover:text-foreground"
              aria-label="Edit task"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          {onArchive && (task.columnId === 'done' || task.agentStatus === 'failed') && !task.archived && (
            <button
              onClick={(e) => { e.stopPropagation(); onArchive(task); }}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-white/8 hover:text-foreground"
              aria-label="Archive task"
            >
              <Archive className="h-3 w-3" />
            </button>
          )}
          {onUnarchive && task.archived && (
            <button
              onClick={(e) => { e.stopPropagation(); onUnarchive(task); }}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-white/8 hover:text-foreground"
              aria-label="Unarchive task"
            >
              <Archive className="h-3 w-3" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(task); }}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-red-500/15 hover:text-red-400"
              aria-label="Delete task"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      <div>
        {/* Title with priority emoji */}
        <h3 className="line-clamp-2 pr-16 text-[13px] font-semibold leading-snug text-card-foreground">
          {priorityDisplay && <span className="mr-1">{priorityDisplay.emoji}</span>}{task.title}
        </h3>

        {/* Description */}
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {task.description}
        </p>

        {/* State badge */}
        <div className="mt-2.5">
          <FcStateBadge state={fcState} />
        </div>

        {/* Footer */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {task.agentType && task.columnId !== 'backlog' && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#9ca3af',
                }}
              >
                {agentDisplay?.emoji} {agentDisplay?.label}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {retryPending && (
              <span
                className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' }}
                title={`Auto-retry after token limit at ${new Date(task.retryAt!).toLocaleString()}`}
              >
                <RotateCw className="h-3 w-3" />
                Retry {retryLabel}
              </span>
            )}

            {isActive && elapsed && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                <Clock className="h-3 w-3" />
                {elapsed}
              </span>
            )}

            {!isActive && (task.agentStatus === 'complete' || task.agentStatus === 'failed') && task.startedAt && task.completedAt && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatCompletedDuration(task.startedAt, task.completedAt)}
              </span>
            )}

            {/* Agent status icon with glow */}
            <div className={cn('flex items-center gap-1', agentStatus.className)}>
              <StatusIcon
                className={cn(
                  'h-3.5 w-3.5',
                  task.agentStatus === 'executing' && 'animate-spin',
                  task.agentStatus === 'planning'  && 'animate-pulse'
                )}
                style={agentStatus.glowColor !== 'transparent'
                  ? { filter: `drop-shadow(0 0 4px ${agentStatus.glowColor})` }
                  : {}}
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
    </div>
  );
}

export const TaskCard = memo(TaskCardComponent);
