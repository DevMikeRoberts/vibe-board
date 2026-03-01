import { useMemo, useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useDroppable } from '@dnd-kit/core';
import {
  Inbox,
  Loader2,
  Eye,
  CheckCircle2,
  Plus,
  Archive,
} from 'lucide-react';
import type { Column as ColumnType, Task } from '@/types';
import { TaskCard } from './TaskCard';
import { cn } from '@/lib/utils';

const iconMap: Record<string, React.ElementType> = {
  inbox: Inbox,
  loader: Loader2,
  eye: Eye,
  'check-circle': CheckCircle2,
  archive: Archive,
};

interface ColumnProps {
  column: ColumnType;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  onDeleteTask?: (task: Task) => void;
  onArchiveTask?: (task: Task) => void;
  onUnarchiveTask?: (task: Task) => void;
  onRetryTask?: (task: Task) => void;
  onAddTask?: () => void;
}

export function Column({ column, tasks, onTaskClick, onEditTask, onDeleteTask, onArchiveTask, onUnarchiveTask, onRetryTask, onAddTask }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const Icon = iconMap[column.icon] || Inbox;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      setCanScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', check); ro.disconnect(); };
  }, [tasks.length]);

  const dotColor = useMemo(() => {
    const map: Record<string, string> = {
      'bg-zinc-500': 'bg-zinc-400',
      'bg-blue-500': 'bg-blue-500',
      'bg-amber-500': 'bg-amber-500',
      'bg-emerald-500': 'bg-emerald-500',
    };
    return map[column.color] || 'bg-zinc-400';
  }, [column.color]);

  return (
    <div className="flex h-full w-full shrink-0 flex-col md:w-72 lg:w-80 max-md:h-auto max-md:min-h-48" data-column={column.id}>
      {/* Column header */}
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', dotColor)} />
          <h2 className="text-base font-medium text-foreground">
            {column.title}
          </h2>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">
            {tasks.length}
          </span>
        </div>
        {column.id === 'backlog' && onAddTask && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onAddTask}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </motion.button>
        )}
      </div>

      {/* Drop zone with scroll fade */}
      <div className="relative flex-1 overflow-hidden rounded-xl">
        <div
          ref={(node) => { setNodeRef(node); (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node; }}
          className={cn(
            'flex h-full flex-col gap-2 overflow-y-auto p-2 transition-colors duration-200',
            isOver
              ? 'bg-primary/5 ring-2 ring-primary/20 ring-inset'
              : 'bg-[var(--column-bg)]'
          )}
        >
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick(task)}
              onEdit={onEditTask}
              onDelete={onDeleteTask}
              onArchive={onArchiveTask}
              onUnarchive={onUnarchiveTask}
              onRetry={onRetryTask}
            />
          ))}

          {tasks.length === 0 && (
            <div className="flex flex-1 items-center justify-center py-4">
              <div className="text-center">
                <Icon className="mx-auto h-6 w-6 text-muted-foreground/30" />
                <p className="mt-1 text-xs text-muted-foreground/50">
                  No tasks
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Scroll fade indicator */}
        {canScrollDown && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-xl bg-gradient-to-t from-[var(--column-bg)] to-transparent" />
        )}
      </div>
    </div>
  );
}
