import { useState, useCallback, useEffect } from 'react';
import type { Task, AgentType, ColumnId, Priority } from '@/types';
import { VALID_TRANSITIONS } from '@/types';
import { api, connectWS } from '@/lib/api';

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  // const loaded = useRef(false); // unused

  // Fetch tasks on mount and when showArchived changes
  useEffect(() => {
    api.getTasks(showArchived).then(setTasks).catch((err) => {
      setError(`Failed to load tasks: ${err.message}`);
    });
  }, [showArchived]);

  // WebSocket: live task updates from server
  useEffect(() => {
    return connectWS((msg) => {
      if (msg.type === 'task_updated') {
        setTasks((prev) => {
          const exists = prev.some((t) => t.id === msg.payload.id);
          if (exists) return prev.map((t) => (t.id === msg.payload.id ? msg.payload : t));
          return [...prev, msg.payload];
        });
      }
      if (msg.type === 'task_deleted') {
        setTasks((prev) => prev.filter((t) => t.id !== msg.payload.id));
      }
    });
  }, []);

  const addTask = useCallback(async (task: Omit<Task, 'id' | 'createdAt' | 'agentStatus'> & { autoRun?: boolean }) => {
    try {
      const newTask = await api.createTask(task);
      // Deduplicate: WS broadcast may have already added this task
      setTasks((prev) =>
        prev.some((t) => t.id === newTask.id) ? prev : [...prev, newTask]
      );
      return newTask;
    } catch (err) {
      setError(`Failed to create task: ${(err as Error).message}`);
      return undefined;
    }
  }, []);

  const batchCreate = useCallback(async (
    taskDefs: Array<{ title: string; description?: string; priority?: Priority; columnId?: ColumnId; agentType?: AgentType; repoPath?: string; branchName?: string; baseBranch?: string; useWorktree?: boolean; autoRun?: boolean }>
  ) => {
    try {
      const { tasks: newTasks } = await api.batchCreateTasks(taskDefs);
      setTasks((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const toAdd = newTasks.filter((t) => !existingIds.has(t.id));
        return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
      });
      return newTasks;
    } catch (err) {
      setError(`Failed to create tasks: ${(err as Error).message}`);
      return undefined;
    }
  }, []);

  const moveTask = useCallback((taskId: string, targetColumn: ColumnId) => {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === taskId);
      if (!task) return prev;
      // Block invalid transitions
      if (!VALID_TRANSITIONS[task.columnId]?.includes(targetColumn)) return prev;

      return prev.map((t) => {
        if (t.id !== taskId) return t;
        const updates: Partial<Task> = { columnId: targetColumn };
        // Reset agent state when moving to in-progress
        if (targetColumn === 'in-progress') {
          updates.agentStatus = 'idle';
          updates.startedAt = undefined;
          updates.completedAt = undefined;
        }
        return { ...t, ...updates };
      });
    });
    // Sync to server (server also validates + resets)
    api.updateTask(taskId, { columnId: targetColumn }).catch((err) => {
      console.error('[moveTask] server rejected:', err);
      setError(`Move failed: ${err.message}`);
      // Revert optimistic update by re-fetching
      api.getTasks().then(setTasks).catch((fetchErr) => {
        console.error('[moveTask] re-fetch also failed:', fetchErr);
        setError(`Move failed and could not refresh: ${fetchErr.message}`);
      });
    });
  }, []);

  const runTask = useCallback(async (id: string) => {
    try {
      const updated = await api.runTask(id);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      setError(`Failed to start agent: ${(err as Error).message}`);
    }
  }, []);

  const configureAndRunTask = useCallback(async (
    id: string,
    config: { repoPath: string; branchName: string; baseBranch: string; useWorktree: boolean; agentType?: AgentType }
  ) => {
    try {
      const configured = await api.configureTask(id, config);
      setTasks((prev) => prev.map((t) => (t.id === id ? configured : t)));
      const updated = await api.runTask(id);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      setError(`Failed to start agent: ${(err as Error).message}`);
    }
  }, []);

  const createPR = useCallback(async (id: string) => {
    try {
      const result = await api.createPR(id);
      return result.url;
    } catch (err) {
      setError(`Failed to create PR: ${(err as Error).message}`);
      return undefined;
    }
  }, []);

  const cleanupWorktree = useCallback(async (id: string) => {
    try {
      await api.cleanupWorktree(id);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, worktreePath: undefined } : t)));
    } catch (err) {
      setError(`Failed to clean up worktree: ${(err as Error).message}`);
    }
  }, []);

  const stopTask = useCallback(async (id: string) => {
    try {
      const updated = await api.stopTask(id);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      setError(`Failed to stop agent: ${(err as Error).message}`);
    }
  }, []);

  const updateTask = useCallback(async (id: string, updates: Partial<Task>) => {
    try {
      const updated = await api.updateTask(id, updates);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      setError(`Failed to update task: ${(err as Error).message}`);
    }
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    try {
      await api.deleteTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(`Failed to delete task: ${(err as Error).message}`);
    }
  }, []);

  const archiveTask = useCallback(async (id: string) => {
    try {
      const updated = await api.archiveTask(id);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      setError(`Failed to archive task: ${(err as Error).message}`);
    }
  }, []);

  const unarchiveTask = useCallback(async (id: string) => {
    try {
      const updated = await api.unarchiveTask(id);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      setError(`Failed to unarchive task: ${(err as Error).message}`);
    }
  }, []);

  const getTasksByColumn = useCallback(
    (columnId: ColumnId) => tasks.filter((t) => t.columnId === columnId),
    [tasks]
  );

  const clearError = useCallback(() => setError(null), []);

  return { tasks, error, clearError, showArchived, setShowArchived, addTask, batchCreate, updateTask, moveTask, runTask, stopTask, deleteTask, archiveTask, unarchiveTask, getTasksByColumn, configureAndRunTask, createPR, cleanupWorktree };
}
