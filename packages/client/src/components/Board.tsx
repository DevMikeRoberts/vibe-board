import { useCallback, useState, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  CollisionDetection,
} from '@dnd-kit/core';
import { motion } from 'framer-motion';
import type { Task, ColumnId, Column as ColumnType } from '@/types';
import { VALID_TRANSITIONS } from '@/types';
import { columns as baseColumns } from '@/lib/columns';
import { Column } from './Column';
import { TaskCard } from './TaskCard';
import { TaskGroupCard } from './TaskGroupCard';
import type { TaskGroupWithChildren } from '@/lib/api';


interface BoardProps {
  tasks: Task[];
  groups?: TaskGroupWithChildren[];
  getTasksByColumn: (columnId: ColumnId) => Task[];
  onMoveTask: (taskId: string, targetColumn: ColumnId) => void;
  onTaskClick: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  onDeleteTask?: (task: Task) => void;
  onArchiveTask?: (task: Task) => void;
  onUnarchiveTask?: (task: Task) => void;
  onRetryTask?: (task: Task) => void;
  onExpandTask?: (task: Task) => void;
  onAddTask: () => void;
  onDropInProgress?: (task: Task) => void;
  showArchived?: boolean;
  onClickGroup?: (group: TaskGroupWithChildren) => void;
  onRunGroup?: (id: string) => void;
  onStopGroup?: (id: string) => void;
  onDeleteGroup?: (id: string) => void;
  onEditGroup?: (group: TaskGroupWithChildren) => void;
}

const kanbanCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

export function Board({
  tasks,
  groups = [],
  getTasksByColumn,
  onMoveTask,
  onTaskClick,
  onEditTask,
  onDeleteTask,
  onArchiveTask,
  onUnarchiveTask,
  onRetryTask,
  onExpandTask,
  onAddTask,
  onDropInProgress,
  showArchived = false,
  onClickGroup,
  onRunGroup,
  onStopGroup,
  onDeleteGroup,
  onEditGroup,
}: BoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const columns = useMemo(() => {
    if (!showArchived) return baseColumns;
    return [
      ...baseColumns,
      {
        id: 'archived' as ColumnId,
        title: 'Archived',
        color: 'bg-zinc-500',
        icon: 'archive'
      } as ColumnType
    ];
  }, [showArchived]);

  const getTasksForColumn = useCallback((columnId: ColumnId | string) => {
    if (columnId === 'archived') return tasks.filter(t => t.archived === true);
    return getTasksByColumn(columnId as ColumnId);
  }, [tasks, getTasksByColumn]);

  const getGroupsForColumn = useCallback((columnId: ColumnId | string) => {
    return groups.filter(g => g.columnId === columnId && !g.archived);
  }, [groups]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    if (task) setActiveTask(task);
    document.body.style.cursor = 'grabbing';
  }, [tasks]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    document.body.style.cursor = '';
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const overId = over.id as string;
    const draggedTask = tasks.find((t) => t.id === taskId);
    if (!draggedTask) return;

    const isColumn = columns.some((c) => c.id === overId);
    let targetColumn: ColumnId;
    if (isColumn) {
      targetColumn = overId as ColumnId;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask) return;
      targetColumn = overTask.columnId;
    }

    if (draggedTask.archived) return;
    if ((targetColumn as string) === 'archived') return;
    if (targetColumn === draggedTask.columnId) return;
    if (!VALID_TRANSITIONS[draggedTask.columnId]?.includes(targetColumn)) return;

    onMoveTask(taskId, targetColumn);
    if (targetColumn === 'in-progress' && onDropInProgress) {
      onDropInProgress(draggedTask);
    }
  }, [onMoveTask, onDropInProgress, tasks, columns]);

  const handleDragCancel = useCallback(() => {
    document.body.style.cursor = '';
    setActiveTask(null);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={kanbanCollision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* Board area with ambient glow background */}
      <div className="board-ambient flex h-full gap-4 overflow-x-auto p-4 pb-4 max-md:flex-col max-md:overflow-x-hidden max-md:overflow-y-auto md:p-5">
        {columns.map((column, index) => (
          <motion.div
            key={column.id}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="flex h-full flex-col"
            style={{ minWidth: 0 }}
          >
            <Column
              column={column}
              tasks={getTasksForColumn(column.id)}
              onTaskClick={onTaskClick}
              onEditTask={onEditTask}
              onDeleteTask={onDeleteTask}
              onArchiveTask={onArchiveTask}
              onUnarchiveTask={onUnarchiveTask}
              onRetryTask={onRetryTask}
              onExpandTask={onExpandTask}
              onAddTask={column.id === 'backlog' ? onAddTask : undefined}
              extraContent={
                getGroupsForColumn(column.id).map((g) => (
                  <TaskGroupCard
                    key={g.id}
                    group={g}
                    onClickGroup={onClickGroup ?? (() => {})}
                    onRunGroup={onRunGroup ?? (() => {})}
                    onStopGroup={onStopGroup ?? (() => {})}
                    onDeleteGroup={onDeleteGroup ?? (() => {})}
                    onEditGroup={onEditGroup}
                  />
                ))
              }
            />
          </motion.div>
        ))}
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeTask && (
          <div className="w-full max-w-80 rotate-2 opacity-90 scale-105">
            <TaskCard task={activeTask} onClick={() => {}} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
