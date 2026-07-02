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
  onExpandTask?: (task: Task) => void;
  onAddTask?: () => void;
  extraContent?: React.ReactNode;
}

/* Column accent color data */
const COLUMN_META: Record<string, { glow: string; dotColor: string; badgeColor: string; label: string }> = {
  'bg-zinc-500':    { glow: 'rgba(113,113,122,0.45)',  dotColor: '#71717a', badgeColor: 'rgba(113,113,122,0.15)', label: '#a1a1aa' },
  'bg-blue-500':    { glow: 'rgba(59,130,246,0.50)',   dotColor: '#60a5fa', badgeColor: 'rgba(59,130,246,0.14)',  label: '#93c5fd' },
  'bg-amber-500':   { glow: 'rgba(245,158,11,0.50)',   dotColor: '#fbbf24', badgeColor: 'rgba(245,158,11,0.14)', label: '#fcd34d' },
  'bg-emerald-500': { glow: 'rgba(16,185,129,0.50)',   dotColor: '#34d399', badgeColor: 'rgba(16,185,129,0.14)', label: '#6ee7b7' },
};

export function Column({ column, tasks, onTaskClick, onEditTask, onDeleteTask, onArchiveTask, onUnarchiveTask, onRetryTask, onExpandTask, onAddTask, extraContent }: ColumnProps) {
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

  const meta = useMemo(() => COLUMN_META[column.color] || COLUMN_META['bg-zinc-500'], [column.color]);

  return (
    <div className="flex h-full w-full shrink-0 flex-col md:w-72 lg:w-80 max-md:h-auto max-md:min-h-52" data-column={column.id}>
      {/* Column header */}
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2.5">
          {/* Glowing dot */}
          <div className="relative flex h-3 w-3 items-center justify-center">
            <span
              className="absolute h-3 w-3 rounded-full opacity-30 animate-ping"
              style={{ background: meta.dotColor }}
            />
            <span
              className="relative h-2 w-2 rounded-full"
              style={{ background: meta.dotColor, boxShadow: `0 0 8px ${meta.glow}` }}
            />
          </div>

          <h2 className="text-sm font-bold tracking-wide text-foreground">
            {column.title}
          </h2>

          {/* Task count badge */}
          <span
            className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
            style={{ background: meta.badgeColor, color: meta.label, border: `1px solid ${meta.glow.replace('0.', '0.2')}` }}
          >
            {tasks.length}
          </span>
        </div>

        {column.id === 'backlog' && onAddTask && (
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={onAddTask}
            className="flex h-7 w-7 items-center justify-center rounded-xl text-zinc-500 transition-all hover:bg-orange-500/12 hover:text-orange-400"
            style={{ border: '1px solid transparent', transition: 'all 0.2s ease' }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.border = '1px solid rgba(249,115,22,0.35)';
              (e.currentTarget as HTMLElement).style.boxShadow = '0 0 10px rgba(249,115,22,0.15)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.border = '1px solid transparent';
              (e.currentTarget as HTMLElement).style.boxShadow = '';
            }}
          >
            <Plus className="h-4 w-4" />
          </motion.button>
        )}
      </div>

      {/* Drop zone */}
      <div className="relative flex-1 overflow-hidden rounded-2xl">
        <div
          ref={(node) => {
            setNodeRef(node);
            (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
          }}
          className={cn(
            'flex h-full flex-col gap-2.5 overflow-y-auto p-2.5 transition-all duration-300',
            isOver ? 'column-drop-over' : ''
          )}
          style={
            !isOver
              ? {
                  background: 'var(--column-bg)',
                  borderRadius: '1rem',
                  border: '1px solid rgba(255,255,255,0.04)',
                  backdropFilter: 'blur(12px)',
                }
              : {
                  borderRadius: '1rem',
                }
          }
        >
          {/* Group cards first */}
          {extraContent}

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
              onExpand={onExpandTask}
            />
          ))}

          {tasks.length === 0 && (!extraContent || (Array.isArray(extraContent) && extraContent.length === 0)) && (
            <div className="flex flex-1 items-center justify-center py-6">
              <div className="text-center">
                <div
                  className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl"
                  style={{ background: meta.badgeColor, border: `1px solid ${meta.glow.replace('0.', '0.15')}` }}
                >
                  <Icon
                    className="h-5 w-5 md:h-5 md:w-5"
                    style={{ color: meta.label, opacity: 0.5 }}
                  />
                </div>
                <p className="mt-2 text-[11px] font-medium text-muted-foreground/50">
                  {column.id === 'backlog'     && <><span className="hidden md:inline">Press N to create a task or G for a group</span><span className="md:hidden">Add a task or group</span></>}
                  {column.id === 'in-progress' && <><span className="hidden md:inline">Drag tasks here to start AI agents</span><span className="md:hidden">Drag tasks here</span></>}
                  {column.id === 'review'      && <><span className="hidden md:inline">Completed tasks appear here for review</span><span className="md:hidden">Completed tasks</span></>}
                  {column.id === 'done'        && <><span className="hidden md:inline">Move reviewed tasks here when finished</span><span className="md:hidden">Reviewed tasks</span></>}
                  {!['backlog', 'in-progress', 'review', 'done'].includes(column.id) && 'No tasks'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Scroll fade */}
        {canScrollDown && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-2xl"
            style={{ background: 'linear-gradient(to top, var(--column-bg) 0%, transparent 100%)' }}
          />
        )}
      </div>
    </div>
  );
}
