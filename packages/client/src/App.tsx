import { useState, useCallback, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { Task, ColumnId } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useTasks } from '@/hooks/useTasks';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { Header } from '@/components/Header';
import { Board } from '@/components/Board';
import { TaskDialog } from '@/components/TaskDialog';
import { AgentPanel } from '@/components/AgentPanel';
import { WorktreeDialog } from '@/components/WorktreeDialog';

export function App() {
  const { theme, toggleTheme } = useTheme();
  const { tasks, error, clearError, addTask, moveTask, stopTask, deleteTask, configureAndRunTask, createPR, cleanupWorktree } = useTasks();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [worktreeDialogTaskId, setWorktreeDialogTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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
      setWorktreeDialogTaskId(null);
      await configureAndRunTask(worktreeDialogTaskId, config);
    },
    [worktreeDialogTaskId, configureAndRunTask]
  );

  const handleCloseWorktreeDialog = useCallback(() => {
    setWorktreeDialogTaskId(null);
  }, []);

  // Keyboard shortcuts
  const handleCloseAll = useCallback(() => {
    if (worktreeDialogTaskId) {
      setWorktreeDialogTaskId(null);
    } else if (dialogOpen) {
      setDialogOpen(false);
    } else if (selectedTaskId) {
      setSelectedTaskId(null);
    }
  }, [worktreeDialogTaskId, dialogOpen, selectedTaskId]);

  const isAnyOpen = useCallback(
    () => dialogOpen || selectedTaskId !== null || worktreeDialogTaskId !== null,
    [dialogOpen, selectedTaskId, worktreeDialogTaskId]
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
          onAddTask={handleOpenDialog}
        />
      </main>

      <TaskDialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        onSubmit={addTask}
      />

      <AgentPanel task={selectedTask} onClose={handleClosePanel} onRun={handleRunWithConfig} onStop={stopTask} onDelete={deleteTask} onCreatePR={createPR} onCleanupWorktree={cleanupWorktree} />

      <WorktreeDialog
        open={worktreeDialogTaskId !== null}
        task={worktreeDialogTask}
        onClose={handleCloseWorktreeDialog}
        onSubmit={handleWorktreeSubmit}
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
