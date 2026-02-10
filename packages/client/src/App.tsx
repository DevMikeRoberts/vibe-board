import { useState, useCallback, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { Task, ColumnId, Priority } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useTasks } from '@/hooks/useTasks';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { Header } from '@/components/Header';
import { Board } from '@/components/Board';
import { TaskDialog } from '@/components/TaskDialog';
import { AgentPanel } from '@/components/AgentPanel';
import { WorktreeDialog } from '@/components/WorktreeDialog';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';

export function App() {
  const { theme, toggleTheme } = useTheme();
  const { tasks, error, clearError, addTask, updateTask, moveTask, stopTask, deleteTask, configureAndRunTask, createPR, cleanupWorktree } = useTasks();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [worktreeDialogTaskId, setWorktreeDialogTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);

  // Derive live task from tasks array so it stays current with WS updates
  const selectedTask = useMemo(
    () => (selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) ?? null : null),
    [selectedTaskId, tasks]
  );

  // Filter tasks by search query
  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const q = searchQuery.toLowerCase();
    return tasks.filter(
      (t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    );
  }, [tasks, searchQuery]);

  const getFilteredTasksByColumn = useCallback(
    (columnId: ColumnId) => filteredTasks.filter((t) => t.columnId === columnId),
    [filteredTasks]
  );

  const handleTaskClick = useCallback((task: Task) => {
    if (task.columnId === 'backlog') return;
    setSelectedTaskId(task.id);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedTaskId(null);
  }, []);

  const handleOpenDialog = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const handleCloseDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingTask(null);
  }, []);

  const handleEditTask = useCallback((task: Task) => {
    setEditingTask(task);
    setDialogOpen(true);
  }, []);

  const handleEditSubmit = useCallback((id: string, updates: { title: string; description: string; priority: Priority }) => {
    updateTask(id, updates);
  }, [updateTask]);

  const handleDeleteTask = useCallback((task: Task) => {
    setDeletingTask(task);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (deletingTask) {
      deleteTask(deletingTask.id);
      setDeletingTask(null);
    }
  }, [deletingTask, deleteTask]);

  const handleCancelDelete = useCallback(() => {
    setDeletingTask(null);
  }, []);

  // Worktree dialog: intercept Run to show config dialog first
  const worktreeDialogTask = useMemo(
    () => (worktreeDialogTaskId ? tasks.find((t) => t.id === worktreeDialogTaskId) ?? null : null),
    [worktreeDialogTaskId, tasks]
  );

  const handleRunWithConfig = useCallback((taskId: string) => {
    setWorktreeDialogTaskId(taskId);
  }, []);

  const handleWorktreeSubmit = useCallback(
    async (config: { repoPath: string; branchName: string; baseBranch: string; useWorktree: boolean }) => {
      if (!worktreeDialogTaskId) return;
      const taskId = worktreeDialogTaskId;
      setSelectedTaskId(taskId);
      setWorktreeDialogTaskId(null);
      await configureAndRunTask(taskId, config);
    },
    [worktreeDialogTaskId, configureAndRunTask]
  );

  const handleCloseWorktreeDialog = useCallback(() => {
    setWorktreeDialogTaskId(null);
  }, []);

  // Keyboard shortcuts
  const handleCloseAll = useCallback(() => {
    if (deletingTask) {
      setDeletingTask(null);
    } else if (worktreeDialogTaskId) {
      setWorktreeDialogTaskId(null);
    } else if (dialogOpen) {
      setDialogOpen(false);
    } else if (selectedTaskId) {
      setSelectedTaskId(null);
    }
  }, [deletingTask, worktreeDialogTaskId, dialogOpen, selectedTaskId]);

  const isAnyOpen = useCallback(
    () => dialogOpen || selectedTaskId !== null || worktreeDialogTaskId !== null || deletingTask !== null,
    [dialogOpen, selectedTaskId, worktreeDialogTaskId, deletingTask]
  );

  useKeyboardShortcuts({
    onNewTask: handleOpenDialog,
    onCloseAll: handleCloseAll,
    isAnyOpen,
  });

  // Auto-dismiss error toast
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(clearError, 5000);
    return () => clearTimeout(timer);
  }, [error, clearError]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header
        theme={theme}
        toggleTheme={toggleTheme}
        taskCount={tasks.length}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <main className="flex-1 overflow-hidden">
        <Board
          tasks={filteredTasks}
          getTasksByColumn={getFilteredTasksByColumn}
          onMoveTask={moveTask}
          onTaskClick={handleTaskClick}
          onEditTask={handleEditTask}
          onDeleteTask={handleDeleteTask}
          onAddTask={handleOpenDialog}
          // onDropInProgress receives the pre-move task object, but task.id is stable.
          // React batches this setState with the WS-driven tasks array update from moveTask,
          // so selectedTask (derived via useMemo) resolves to the already-moved task.
          onDropInProgress={(task) => setSelectedTaskId(task.id)}
        />
      </main>

      <TaskDialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        onSubmit={addTask}
        editTask={editingTask}
        onEditSubmit={handleEditSubmit}
      />

      <AgentPanel task={selectedTask} onClose={handleClosePanel} onRun={handleRunWithConfig} onStop={stopTask} onCreatePR={createPR} onCleanupWorktree={cleanupWorktree} />

      <WorktreeDialog
        open={worktreeDialogTaskId !== null}
        task={worktreeDialogTask}
        onClose={handleCloseWorktreeDialog}
        onSubmit={handleWorktreeSubmit}
      />

      <DeleteConfirmDialog
        open={deletingTask !== null}
        taskTitle={deletingTask?.title ?? ''}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />

      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 shadow-lg backdrop-blur-sm"
          >
            <span>{error}</span>
            <button onClick={clearError} className="ml-1 shrink-0 text-red-400 hover:text-red-300">
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
