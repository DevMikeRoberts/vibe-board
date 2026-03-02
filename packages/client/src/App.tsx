import { useState, useCallback, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { Task, AgentType, Priority, ColumnId } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useTasks } from '@/hooks/useTasks';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useDebounce } from '@/hooks/useDebounce';
import { useTaskGroups } from '@/hooks/useTaskGroups';
import { PRIORITY_WEIGHT } from '@/lib/priority-config';
import { Header } from '@/components/Header';
import type { StatusFilter } from '@/components/FilterChips';
import { statusFilterToStatuses } from '@/components/FilterChips';
import { Board } from '@/components/Board';
import { TaskDialog } from '@/components/TaskDialog';
import { TaskGroupDialog } from '@/components/TaskGroupDialog';
import { GroupPanel } from '@/components/GroupPanel';
import { AgentPanel } from '@/components/AgentPanel';
import type { TaskGroupWithChildren } from '@/lib/api';
import { WorktreeDialog } from '@/components/WorktreeDialog';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';

export function App() {
  const { theme, toggleTheme } = useTheme();
  const { tasks, error, clearError, showArchived, setShowArchived, addTask, updateTask, moveTask, runTask, stopTask, deleteTask, archiveTask, unarchiveTask, configureAndRunTask, createPR, mergeLocal, cleanupWorktree } = useTasks();
  const { groups, createGroup, runGroup, stopGroup, deleteGroup, refreshGroup } = useTaskGroups();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [worktreeDialogTaskId, setWorktreeDialogTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [sortBy, setSortBy] = useState<'title' | 'priority' | 'created' | 'status'>(
    () => (localStorage.getItem('kanban-sort-by') as 'title' | 'priority' | 'created' | 'status') || 'title'
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(
    () => (localStorage.getItem('kanban-sort-dir') as 'asc' | 'desc') || 'asc'
  );
  const [activeAgentTypes, setActiveAgentTypes] = useState<AgentType[]>(
    () => { try { return JSON.parse(localStorage.getItem('kanban-filter-agents') || '[]'); } catch { return []; } }
  );
  const [activeStatuses, setActiveStatuses] = useState<StatusFilter[]>(
    () => { try { return JSON.parse(localStorage.getItem('kanban-filter-statuses') || '[]'); } catch { return []; } }
  );

  // Debounce search query
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Persist sort preferences
  useEffect(() => {
    localStorage.setItem('kanban-sort-by', sortBy);
    localStorage.setItem('kanban-sort-dir', sortDir);
  }, [sortBy, sortDir]);

  // Persist filter preferences
  useEffect(() => {
    localStorage.setItem('kanban-filter-agents', JSON.stringify(activeAgentTypes));
    localStorage.setItem('kanban-filter-statuses', JSON.stringify(activeStatuses));
  }, [activeAgentTypes, activeStatuses]);

  // Derive live task from tasks array so it stays current with WS updates
  const selectedTask = useMemo(
    () => {
      if (!selectedTaskId) return null;
      // Search standalone tasks first, then group children
      const standalone = tasks.find((t) => t.id === selectedTaskId);
      if (standalone) return standalone;
      for (const g of groups) {
        const child = g.children.find((c) => c.id === selectedTaskId);
        if (child) return child;
      }
      return null;
    },
    [selectedTaskId, tasks, groups]
  );

  const selectedGroup = useMemo(
    () => (selectedGroupId ? groups.find((g) => g.id === selectedGroupId) ?? null : null),
    [selectedGroupId, groups]
  );

  const handleClickGroup = useCallback((group: TaskGroupWithChildren) => {
    setSelectedGroupId(group.id);
    setSelectedTaskId(null);
  }, []);

  const handleRunGroup = useCallback(async (id: string) => {
    await runGroup(id);
  }, [runGroup]);

  const handleStopGroup = useCallback(async (id: string) => {
    await stopGroup(id);
  }, [stopGroup]);

  const handleDeleteGroup = useCallback(async (id: string) => {
    await deleteGroup(id);
    if (selectedGroupId === id) setSelectedGroupId(null);
  }, [deleteGroup, selectedGroupId]);

  const handleRetryChild = useCallback(async (taskId: string) => {
    await runTask(taskId);
    if (selectedGroupId) refreshGroup(selectedGroupId);
  }, [runTask, selectedGroupId, refreshGroup]);

  const handleChildClick = useCallback((task: Task) => {
    setSelectedGroupId(null);
    setSelectedTaskId(task.id);
  }, []);

  // Filter tasks by search query, agent type, and status
  const filteredTasks = useMemo(() => {
    let result = tasks;

    // Text search
    if (debouncedSearchQuery.trim()) {
      const q = debouncedSearchQuery.toLowerCase();
      result = result.filter(
        (t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
      );
    }

    // Agent type filter (OR within group)
    if (activeAgentTypes.length > 0) {
      result = result.filter((t) => t.agentType && activeAgentTypes.includes(t.agentType));
    }

    // Status filter (OR within group) — "running" maps to planning|executing
    if (activeStatuses.length > 0) {
      const matchingStatuses = activeStatuses.flatMap(statusFilterToStatuses);
      result = result.filter((t) => matchingStatuses.includes(t.agentStatus));
    }

    return result;
  }, [tasks, debouncedSearchQuery, activeAgentTypes, activeStatuses]);

  // Sort comparator
  const STATUS_WEIGHT: Record<string, number> = { executing: 0, planning: 1, failed: 2, idle: 3, complete: 4 };
  const sortTasks = useCallback((a: Task, b: Task): number => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortBy) {
      case 'title':
        return dir * a.title.localeCompare(b.title);
      case 'priority':
        return dir * ((PRIORITY_WEIGHT[a.priority] ?? 2) - (PRIORITY_WEIGHT[b.priority] ?? 2));
      case 'created':
        return dir * (a.createdAt - b.createdAt);
      case 'status':
        return dir * ((STATUS_WEIGHT[a.agentStatus] ?? 3) - (STATUS_WEIGHT[b.agentStatus] ?? 3));
      default:
        return 0;
    }
  }, [sortBy, sortDir]);

  const getFilteredTasksByColumn = useCallback(
    (columnId: ColumnId) => filteredTasks.filter((t) => t.columnId === columnId).sort(sortTasks),
    [filteredTasks, sortTasks]
  );

  const handleToggleAgentType = useCallback((agentType: AgentType) => {
    setActiveAgentTypes((prev) =>
      prev.includes(agentType) ? prev.filter((t) => t !== agentType) : [...prev, agentType]
    );
  }, []);

  const handleToggleStatus = useCallback((status: StatusFilter) => {
    setActiveStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  }, []);

  const handleClearFilters = useCallback(() => {
    setActiveAgentTypes([]);
    setActiveStatuses([]);
  }, []);

  const handleTaskClick = useCallback((task: Task) => {
    if (task.columnId === 'backlog') return;
    setSelectedTaskId(task.id);
  }, []);

  const handleClosePanel = useCallback(() => {
    // If viewing a grouped child, return to its group panel
    if (selectedTaskId) {
      for (const g of groups) {
        if (g.children.some((c) => c.id === selectedTaskId)) {
          setSelectedTaskId(null);
          setSelectedGroupId(g.id);
          return;
        }
      }
    }
    setSelectedTaskId(null);
  }, [selectedTaskId, groups]);

  const handleOpenDialog = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const handleOpenGroupDialog = useCallback(() => {
    setGroupDialogOpen(true);
  }, []);

  const handleCloseDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingTask(null);
  }, []);

  const handleEditTask = useCallback((task: Task) => {
    setEditingTask(task);
    setDialogOpen(true);
  }, []);

  const handleEditSubmit = useCallback((id: string, updates: { title: string; description: string; priority: Priority; agentType: AgentType }) => {
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

  const handleArchiveTask = useCallback((task: Task) => {
    archiveTask(task.id);
  }, [archiveTask]);

  const handleUnarchiveTask = useCallback((task: Task) => {
    unarchiveTask(task.id);
  }, [unarchiveTask]);

  // Worktree dialog: intercept Run to show config dialog first
  const worktreeDialogTask = useMemo(
    () => (worktreeDialogTaskId ? tasks.find((t) => t.id === worktreeDialogTaskId) ?? null : null),
    [worktreeDialogTaskId, tasks]
  );

  const handleRunWithConfig = useCallback((taskId: string) => {
    setWorktreeDialogTaskId(taskId);
  }, []);

  const handleRetryTask = useCallback((task: Task) => {
    setSelectedTaskId(task.id);
    runTask(task.id);
  }, [runTask]);

  const handleReconfigureRetry = useCallback((taskId: string) => {
    setWorktreeDialogTaskId(taskId);
  }, []);

  const handleWorktreeSubmit = useCallback(
    async (config: { repoPath: string; branchName: string; baseBranch: string; useWorktree: boolean; agentType?: AgentType }) => {
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
    } else if (groupDialogOpen) {
      setGroupDialogOpen(false);
    } else if (dialogOpen) {
      setDialogOpen(false);
    } else if (selectedGroupId) {
      setSelectedGroupId(null);
    } else if (selectedTaskId) {
      setSelectedTaskId(null);
    }
  }, [deletingTask, worktreeDialogTaskId, groupDialogOpen, dialogOpen, selectedGroupId, selectedTaskId]);

  const isAnyOpen = useCallback(
    () => dialogOpen || groupDialogOpen || selectedTaskId !== null || selectedGroupId !== null || worktreeDialogTaskId !== null || deletingTask !== null,
    [dialogOpen, groupDialogOpen, selectedTaskId, selectedGroupId, worktreeDialogTaskId, deletingTask]
  );

  useKeyboardShortcuts({
    onNewTask: handleOpenDialog,
    onNewGroup: handleOpenGroupDialog,
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
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived(!showArchived)}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortByChange={setSortBy}
        onSortDirChange={setSortDir}
        activeAgentTypes={activeAgentTypes}
        activeStatuses={activeStatuses}
        onToggleAgentType={handleToggleAgentType}
        onToggleStatus={handleToggleStatus}
        onClearFilters={handleClearFilters}
        onNewTask={handleOpenDialog}
        onNewGroup={handleOpenGroupDialog}
      />

      <main className="flex-1 overflow-hidden">
        <Board
          tasks={filteredTasks}
          groups={groups}
          getTasksByColumn={getFilteredTasksByColumn}
          onMoveTask={moveTask}
          onTaskClick={handleTaskClick}
          onEditTask={handleEditTask}
          onDeleteTask={handleDeleteTask}
          onArchiveTask={handleArchiveTask}
          onUnarchiveTask={handleUnarchiveTask}
          onRetryTask={handleRetryTask}
          onAddTask={handleOpenDialog}
          showArchived={showArchived}
          onDropInProgress={(task) => setSelectedTaskId(task.id)}
          onClickGroup={handleClickGroup}
          onRunGroup={handleRunGroup}
          onStopGroup={handleStopGroup}
          onDeleteGroup={handleDeleteGroup}
        />
      </main>

      <TaskDialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        onSubmit={addTask}
        editTask={editingTask}
        onEditSubmit={handleEditSubmit}
      />

      <TaskGroupDialog
        open={groupDialogOpen}
        onClose={() => setGroupDialogOpen(false)}
        onSubmit={createGroup}
      />

      <AgentPanel task={selectedTask} onClose={handleClosePanel} onRun={handleRunWithConfig} onStop={stopTask} onCreatePR={createPR} onMergeLocal={mergeLocal} onCleanupWorktree={cleanupWorktree} onReconfigureRetry={handleReconfigureRetry} theme={theme} />

      <GroupPanel
        group={selectedGroup}
        onClose={() => setSelectedGroupId(null)}
        onRunGroup={handleRunGroup}
        onStopGroup={handleStopGroup}
        onRetryChild={handleRetryChild}
        onChildClick={handleChildClick}
      />

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
