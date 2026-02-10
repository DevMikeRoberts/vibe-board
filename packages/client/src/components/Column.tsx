import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useDroppable } from '@dnd-kit/core';
import {
  Inbox,
  Loader2,
  Eye,
  CheckCircle2,
  Plus,
} from 'lucide-react';
import type { Column as ColumnType, Task } from '@/types';
import { TaskCard } from './TaskCard';
import { cn } from '@/lib/utils';

const iconMap: Record<string, React.ElementType> = {
  inbox: Inbox,
  loader: Loader2,
  eye: Eye,
  'check-circle': CheckCircle2,
};

interface ColumnProps {
  column: ColumnType;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  onDeleteTask?: (task: Task) => void;
  onAddTask?: () => void;
}

export function Column({ column, tasks, onTaskClick, onEditTask, onDeleteTask, onAddTask }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const Icon = iconMap[column.icon] || Inbox;

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
    <div className="flex h-full w-full shrink-0 flex-col md:w-72 lg:w-80 max-md:h-auto max-md:min-h-48">
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

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex flex-1 flex-col gap-2 overflow-y-auto rounded-xl p-2 transition-colors duration-200',
          isOver
            ? 'bg-primary/5 ring-2 ring-primary/20 ring-inset'
            : 'bg-muted/40'
        )}
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onClick={() => onTaskClick(task)}
            onEdit={onEditTask}
            onDelete={onDeleteTask}
          />
        ))}

        {tasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-8">
            <div className="text-center">
              <Icon className="mx-auto h-8 w-8 text-muted-foreground/30" />
              <p className="mt-2 text-xs text-muted-foreground/50">
                No tasks
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
