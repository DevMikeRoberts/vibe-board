import type { Task, TaskGroup, TaskTemplate, AgentEvent, AgentInfo, AgentType, ColumnId, Priority } from '@/types';

export type { AgentInfo };

export interface TaskGroupWithChildren extends TaskGroup {
  children: Task[];
}

export interface CreateGroupChild {
  title: string;
  description?: string;
  agentType?: AgentType;
  useWorktree?: boolean;
}

const BASE = '/api';
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }
  return headers;
}

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: authHeaders(),
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// --- Task CRUD ---

export const api = {
  getTasks: (includeArchived = false) =>
    request<Task[]>(`/tasks${includeArchived ? '?includeArchived=true' : ''}`),

  createTask: (data: { title: string; description?: string; priority?: Priority; columnId?: ColumnId; agentType?: AgentType; repoPath?: string; branchName?: string; baseBranch?: string; useWorktree?: boolean; autoRun?: boolean }) =>
    request<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),

  batchCreateTasks: (tasks: Array<{ title: string; description?: string; priority?: Priority; columnId?: ColumnId; agentType?: AgentType; repoPath?: string; branchName?: string; baseBranch?: string; useWorktree?: boolean; autoRun?: boolean }>) =>
    request<{ tasks: Task[] }>('/tasks/batch', { method: 'POST', body: JSON.stringify({ tasks }) }),

  updateTask: (id: string, data: Partial<Task>) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteTask: (id: string) =>
    request<void>(`/tasks/${id}`, { method: 'DELETE' }),

  runTask: (id: string) =>
    request<Task>(`/tasks/${id}/run`, { method: 'POST' }),

  stopTask: (id: string) =>
    request<Task>(`/tasks/${id}/stop`, { method: 'POST' }),

  getEvents: (id: string) =>
    request<AgentEvent[]>(`/tasks/${id}/events`),

  getAgents: () => request<AgentInfo[]>('/agents'),

  configureTask: (id: string, config: { repoPath: string; branchName: string; baseBranch: string; useWorktree: boolean; agentType?: AgentType }) =>
    request<Task>(`/tasks/${id}/configure`, { method: 'POST', body: JSON.stringify(config) }),

  createPR: (id: string) =>
    request<{ url: string }>(`/tasks/${id}/create-pr`, { method: 'POST' }),

  cleanupWorktree: (id: string) =>
    request<{ success: boolean }>(`/tasks/${id}/cleanup-worktree`, { method: 'POST' }),

  sendMessage: (id: string, message: string) =>
    request<{ success: boolean }>(`/tasks/${id}/message`, { method: 'POST', body: JSON.stringify({ message }) }),

  archiveTask: (id: string) =>
    request<Task>(`/tasks/${id}/archive`, { method: 'PATCH' }),

  unarchiveTask: (id: string) =>
    request<Task>(`/tasks/${id}/unarchive`, { method: 'PATCH' }),

  // --- Templates ---
  getTemplates: () =>
    request<TaskTemplate[]>('/templates'),

  createTemplate: (data: { name: string; title?: string; description?: string; priority?: Priority; agentType?: AgentType; repoPath?: string; baseBranch?: string; useWorktree?: boolean }) =>
    request<TaskTemplate>('/templates', { method: 'POST', body: JSON.stringify(data) }),

  updateTemplate: (id: string, data: Partial<Omit<TaskTemplate, 'id' | 'createdAt'>>) =>
    request<TaskTemplate>(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteTemplate: (id: string) =>
    request<void>(`/templates/${id}`, { method: 'DELETE' }),

  // --- Groups ---
  getGroups: (includeArchived = false) =>
    request<TaskGroupWithChildren[]>(`/groups${includeArchived ? '?archived=true' : ''}`),

  getGroup: (id: string) =>
    request<TaskGroupWithChildren>(`/groups/${id}`),

  createGroup: (data: {
    title: string;
    description?: string;
    priority?: Priority;
    repoPath?: string;
    baseBranch?: string;
    maxConcurrency: number;
    children: CreateGroupChild[];
    autoRun?: boolean;
  }) => request<TaskGroupWithChildren>('/groups', { method: 'POST', body: JSON.stringify(data) }),

  updateGroup: (id: string, data: Partial<TaskGroup>) =>
    request<TaskGroupWithChildren>(`/groups/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteGroup: (id: string) =>
    request<void>(`/groups/${id}`, { method: 'DELETE' }),

  runGroup: (id: string) =>
    request<TaskGroupWithChildren>(`/groups/${id}/run`, { method: 'POST' }),

  stopGroup: (id: string) =>
    request<{ stopped: boolean }>(`/groups/${id}/stop`, { method: 'POST' }),
};

// --- WebSocket (shared singleton) ---

export type WSMessageHandler = (msg: { type: string; payload: any }) => void;
type ReconnectHandler = () => void;

const listeners = new Set<WSMessageHandler>();
const reconnectListeners = new Set<ReconnectHandler>();
let ws: WebSocket | null = null;
let disposed = false;
let reconnectTimer: ReturnType<typeof setTimeout>;

function ensureConnection() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let url = `${proto}//${location.host}/ws`;
  if (API_KEY) {
    url += `?token=${encodeURIComponent(API_KEY)}`;
  }
  disposed = false;

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[WS] connected');
    // Notify listeners to re-sync state after reconnect
    reconnectListeners.forEach((fn) => fn());
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
      listeners.forEach((fn) => fn(msg));
    } catch { /* ignore malformed messages */ }
  };

  ws.onclose = () => {
    if (!disposed && listeners.size > 0) {
      console.log('[WS] disconnected, reconnecting in 2s');
      reconnectTimer = setTimeout(ensureConnection, 2000);
    }
  };

  ws.onerror = () => ws?.close();
}

/**
 * Subscribe to WebSocket messages. Returns an unsubscribe function.
 * All callers share a single underlying connection.
 * onReconnect is called after each reconnect so callers can re-fetch state.
 */
export function connectWS(onMessage: WSMessageHandler, onReconnect?: ReconnectHandler): () => void {
  listeners.add(onMessage);
  if (onReconnect) reconnectListeners.add(onReconnect);
  ensureConnection();

  return () => {
    listeners.delete(onMessage);
    if (onReconnect) reconnectListeners.delete(onReconnect);
    if (listeners.size === 0) {
      disposed = true;
      clearTimeout(reconnectTimer);
      ws?.close();
      ws = null;
    }
  };
}
