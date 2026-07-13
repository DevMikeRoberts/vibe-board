import { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useDroppable } from '@dnd-kit/core';
import type { Column as ColumnType, Task } from '@/types';
import { TaskCard } from './TaskCard';
import { PixelIcon } from './PixelIcon';
import { cn } from '@/lib/utils';

/** Neon hue per column color name — drives the panel tint + sticker pill. */
const PANEL_HUES: Record<string, string> = {
  yellow: 'var(--color-neon-yellow)',
  blue: 'var(--color-neon-blue)',
  purple: 'var(--color-neon-purple)',
  green: 'var(--color-neon-green)',
  pink: 'var(--color-neon-pink)',
  slate: '#8b87a0',
};

/** Pill text color — ink on bright hues, cream on the deep blue/purple. */
const PILL_TEXT: Record<string, string> = {
  yellow: 'var(--color-ink)',
  blue: 'var(--color-cream)',
  purple: 'var(--color-ink)',
  green: 'var(--color-ink)',
  pink: 'var(--color-ink)',
  slate: 'var(--color-ink)',
};

const EMPTY_HINTS: Record<string, { desktop: string; mobile: string }> = {
  backlog: { desktop: 'Press N for a task, G for a group', mobile: 'Add a task or group' },
  'in-progress': { desktop: 'Drag tasks here to wake the agents', mobile: 'Drag tasks here' },
  review: { desktop: 'Finished work lands here for review', mobile: 'Completed tasks' },
  done: { desktop: 'Park reviewed tasks here. Confetti included.', mobile: 'Reviewed tasks' },
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
  extraContent?: React.ReactNode;
}

export function Column({ column, tasks, onTaskClick, onEditTask, onDeleteTask, onArchiveTask, onUnarchiveTask, onRetryTask, onAddTask, extraContent }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const hue = PANEL_HUES[column.color] || PANEL_HUES.slate;
  const pillText = PILL_TEXT[column.color] || 'var(--color-ink)';
  const hint = EMPTY_HINTS[column.id];

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

  return (
    <div
      className="flex h-full w-full shrink-0 flex-col md:w-[21rem] lg:w-[23rem] xl:w-[25rem] max-md:h-auto max-md:min-h-64"
      data-column={column.id}
      style={{ '--panel': hue } as React.CSSProperties}
    >
      {/* The whole column is one giant neon panel */}
      <div
        className={cn(
          'panel-neon relative flex h-full flex-col overflow-hidden rounded-[1.75rem] transition-shadow duration-200',
          isOver && 'panel-neon-glow'
        )}
      >
        {/* Column header — fat sticker pill */}
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
          <div
            className="sticker-sm flex min-w-0 items-center gap-2.5 rounded-full py-2 pl-3.5 pr-2"
            style={{ backgroundColor: hue, color: pillText }}
          >
            <PixelIcon name={column.icon} className="h-5 w-5" />
            <h2 className="truncate font-display text-base leading-none tracking-wide [text-transform:lowercase]">
              {column.title}
            </h2>
            <span
              className="flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 font-pixel text-xs leading-none"
              style={{ backgroundColor: 'var(--color-ink)', color: hue }}
            >
              {tasks.length}
            </span>
          </div>

          {column.id === 'backlog' && onAddTask && (
            <motion.button
              whileTap={{ scale: 0.88, rotate: 90 }}
              onClick={onAddTask}
              className="sticker-sm sticker-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-display text-lg leading-none text-primary-foreground"
              aria-label="New task"
              title="New task (N)"
            >
              +
            </motion.button>
          )}
        </div>

        {/* Drop zone */}
        <div className="relative flex-1 overflow-hidden">
          <div
            ref={(node) => { setNodeRef(node); (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node; }}
            className={cn(
              'flex h-full flex-col gap-3.5 overflow-y-auto px-4 pb-4 pt-2 transition-[background-color] duration-200',
              isOver && 'bg-[color-mix(in_oklab,var(--panel)_10%,transparent)]'
            )}
          >
            {/* Group cards rendered before tasks */}
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
              />
            ))}

            {tasks.length === 0 && (!extraContent || (Array.isArray(extraContent) && extraContent.length === 0)) && (
              <div className="flex flex-1 items-center justify-center py-8">
                <div className="flex flex-col items-center gap-3 text-center">
                  <PixelIcon
                    name={column.icon}
                    className="animate-px-bob h-9 w-9 opacity-40 md:h-11 md:w-11"
                    style={{ backgroundColor: hue }}
                  />
                  <p className="max-w-52 font-pixel text-[11px] leading-relaxed text-muted-foreground">
                    {hint ? (
                      <>
                        <span className="hidden md:inline">{hint.desktop}</span>
                        <span className="md:hidden">{hint.mobile}</span>
                      </>
                    ) : (
                      'No tasks'
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Scroll fade indicator */}
          {canScrollDown && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[color-mix(in_oklab,var(--panel)_14%,var(--color-background))] to-transparent" />
          )}
        </div>
      </div>
    </div>
  );
}
