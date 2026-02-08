import { useState, useCallback, useEffect, useRef } from 'react';
import type { Task, ColumnId } from '@/types';
import { VALID_TRANSITIONS } from '@/types';
import { api, connectWS } from '@/lib/api';

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  // Fetch tasks on mount
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    api.getTasks().then(setTasks).catch((err) => {
      setError(`Failed to load tasks: ${err.message}`);
    });
  }, []);

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
    });
  }, []);

  const addTask = useCallback(async (task: Omit<Task, 'id' | 'createdAt' | 'agentStatus'>) => {
    try {
      const newTask = await api.createTask(task);
      setTasks((prev) => [...prev, newTask]);
      return newTask;
    } catch (err) {
      setError(`Failed to create task: ${(err as Error).message}`);
      return undefined;
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
      });
    });
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    try {
      await api.deleteTask(id);
      setTasks((prev) => prev.filter((task) => task.id !== id));
    } catch (err) {
      setError(`Failed to delete task: ${(err as Error).message}`);
    }
  }, []);

  const runTask = useCallback(async (id: string) => {
    try {
      const updated = await api.runTask(id);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      setError(`Failed to start agent: ${(err as Error).message}`);
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

  const getTasksByColumn = useCallback(
    (columnId: ColumnId) => tasks.filter((t) => t.columnId === columnId),
    [tasks]
  );

  const clearError = useCallback(() => setError(null), []);

  return { tasks, error, clearError, addTask, updateTask, moveTask, deleteTask, runTask, stopTask, getTasksByColumn };
}
