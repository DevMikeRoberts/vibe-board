import { useState, useEffect } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  Clock,
  Brain,
  Cog,
  CheckCircle2,
  AlertCircle,
  Circle,
  Pencil,
} from 'lucide-react';
import type { Task, Priority, AgentStatus } from '@/types';
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
}

export function TaskCard({ task, onClick, onEdit }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id });

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
      className={cn(
        'group relative cursor-pointer rounded-lg border border-border bg-card p-3 shadow-sm transition-all',
        'hover:border-primary/30 hover:shadow-md',
        isDragging && 'z-50 rotate-2 scale-105 shadow-xl opacity-90',
        isActive && 'border-primary/20'
      )}
      onClick={onClick}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="absolute left-1 top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground/40" />
      </div>

      {/* Edit button — top right, visible on hover */}
      {onEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(task);
          }}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/0 transition-all group-hover:text-muted-foreground hover:!bg-accent hover:!text-foreground"
          aria-label="Edit task"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}

      <div className="pl-4">
        {/* Title */}
        <h3 className="pr-6 text-sm font-medium leading-snug text-card-foreground">
          {task.title}
        </h3>

        {/* Description preview */}
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
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
                  isActive && 'animate-spin'
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
