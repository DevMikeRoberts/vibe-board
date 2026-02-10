import { useCallback, useState } from 'react';
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
import type { Task, ColumnId } from '@/types';
import { VALID_TRANSITIONS } from '@/types';
import { columns } from '@/lib/columns';
import { Column } from './Column';
import { TaskCard } from './TaskCard';

interface BoardProps {
  tasks: Task[];
  getTasksByColumn: (columnId: ColumnId) => Task[];
  onMoveTask: (taskId: string, targetColumn: ColumnId) => void;
  onTaskClick: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  onDeleteTask?: (task: Task) => void;
  onAddTask: () => void;
  onDropInProgress?: (task: Task) => void;
}

// Use pointerWithin first (ideal for dropping into columns),
// fall back to rectIntersection if pointer isn't inside any droppable.
const kanbanCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

export function Board({
  tasks,
  getTasksByColumn,
  onMoveTask,
  onTaskClick,
  onEditTask,
  onDeleteTask,
  onAddTask,
  onDropInProgress,
}: BoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id);
      if (task) setActiveTask(task);
    },
    [tasks]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTask(null);
      const { active, over } = event;
      if (!over) return;

      const taskId = active.id as string;
      const overId = over.id as string;
      const draggedTask = tasks.find((t) => t.id === taskId);
      if (!draggedTask) return;

      // Resolve target column
      const isColumn = columns.some((c) => c.id === overId);
      let targetColumn: ColumnId;
      if (isColumn) {
        targetColumn = overId as ColumnId;
      } else {
        const overTask = tasks.find((t) => t.id === overId);
        if (!overTask) return;
        targetColumn = overTask.columnId;
      }

      // Validate transition before moving
      if (targetColumn === draggedTask.columnId) return;
      if (!VALID_TRANSITIONS[draggedTask.columnId]?.includes(targetColumn)) return;

      onMoveTask(taskId, targetColumn);

      // Auto-open agent panel when dropped into in-progress
      if (targetColumn === 'in-progress' && onDropInProgress) {
        onDropInProgress(draggedTask);
      }
    },
    [onMoveTask, onDropInProgress, tasks]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={kanbanCollision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full gap-4 overflow-x-auto p-4 pb-4 max-md:flex-col max-md:overflow-x-hidden max-md:overflow-y-auto md:p-6">
        {columns.map((column, index) => (
          <motion.div
            key={column.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1, duration: 0.3 }}
          >
            <Column
              column={column}
              tasks={getTasksByColumn(column.id)}
              onTaskClick={onTaskClick}
              onEditTask={onEditTask}
              onDeleteTask={onDeleteTask}
              onAddTask={column.id === 'backlog' ? onAddTask : undefined}
            />
          </motion.div>
        ))}
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeTask && (
          <div className="w-full max-w-80 rotate-3 opacity-90">
            <TaskCard task={activeTask} onClick={() => {}} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
