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
import { columns } from '@/lib/mock-data';
import { Column } from './Column';
import { TaskCard } from './TaskCard';

interface BoardProps {
  tasks: Task[];
  getTasksByColumn: (columnId: ColumnId) => Task[];
  onMoveTask: (taskId: string, targetColumn: ColumnId) => void;
  onTaskClick: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  onAddTask: () => void;
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
  onAddTask,
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
      const activeTask = tasks.find((t) => t.id === taskId);
      if (!activeTask) return;

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
      if (targetColumn === activeTask.columnId) return;
      if (!VALID_TRANSITIONS[activeTask.columnId]?.includes(targetColumn)) return;

      onMoveTask(taskId, targetColumn);
    },
    [onMoveTask, tasks]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={kanbanCollision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full gap-4 overflow-x-auto p-6 pb-4">
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
              onAddTask={column.id === 'backlog' ? onAddTask : undefined}
            />
          </motion.div>
        ))}
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeTask && (
          <div className="w-72 lg:w-80 rotate-3 opacity-90">
            <TaskCard task={activeTask} onClick={() => {}} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
