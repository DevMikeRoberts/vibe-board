import { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import type { Task, Priority, AgentStatus } from '@/types';
import { getAgentDisplay } from '@/lib/agent-config';
import { cn } from '@/lib/utils';

const priorityConfig: Record<Priority, { label: string; className: string }> = {
  low: { label: 'Low', className: 'bg-zinc-500/10 text-zinc-500' },
  medium: { label: 'Medium', className: 'bg-blue-500/10 text-blue-500' },
  high: { label: 'High', className: 'bg-amber-500/10 text-amber-500' },
  critical: { label: 'Critical', className: 'bg-red-500/10 text-red-500' },
};


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
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
}

export function TaskCard({ task, onClick, onEdit, onDelete }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id });

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

  const priority = priorityConfig[task.priority];
  const agentStatus = agentStatusConfig[task.agentStatus];
  const StatusIcon = agentStatus.icon;
  const isActive = task.agentStatus === 'executing' || task.agentStatus === 'planning';

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
      className={cn(
        'group relative cursor-grab active:cursor-grabbing rounded-lg border border-border bg-card p-3 shadow-sm transition-all',
        'hover:border-primary/30 hover:shadow-md',
        isDragging && 'z-50 rotate-2 scale-105 shadow-xl opacity-90',
        isActive && 'border-primary/20'
      )}
      onClick={() => { if (!wasDragging.current) onClick(); }}
    >

      {/* Action buttons — top right, visible on hover */}
      {(onEdit || onDelete) && (
        <div
          className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {onEdit && (
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
        {/* Title — truncated with ellipsis to avoid icon overlap */}
        <h3 className="truncate pr-14 text-base font-medium leading-snug text-card-foreground">
          {task.title}
        </h3>

        {/* Description preview */}
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {task.description}
        </p>

        {/* Footer */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Priority badge */}
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                priority.className
              )}
            >
              {priority.label}
            </span>

            {/* Agent type badge */}
            {task.agentType && task.columnId !== 'backlog' && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {getAgentDisplay(task.agentType)?.emoji} {getAgentDisplay(task.agentType)?.label}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Elapsed time */}
            {isActive && elapsed && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {elapsed}
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

      {/* Active indicator bar */}
      {isActive && (
        <div
          className="absolute inset-x-0 bottom-0 h-0.5 rounded-b-lg bg-primary"
        />
      )}
    </div>
  );
}
