import type { Task, AgentEvent, AgentInfo, AgentType, ColumnId, Priority } from '@/types';

export type { AgentInfo };

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

  getArchivedTasks: () => request<Task[]>('/tasks/archived'),

  createTask: (data: { title: string; description: string; priority: Priority; columnId: ColumnId }) =>
    request<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),

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
};

// --- WebSocket (shared singleton) ---

export type WSMessageHandler = (msg: { type: string; payload: any }) => void;

const listeners = new Set<WSMessageHandler>();
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

  ws.onopen = () => console.log('[WS] connected');

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
 */
export function connectWS(onMessage: WSMessageHandler): () => void {
  listeners.add(onMessage);
  ensureConnection();

  return () => {
    listeners.delete(onMessage);
    // Close the socket only when no listeners remain
    if (listeners.size === 0) {
      disposed = true;
      clearTimeout(reconnectTimer);
      ws?.close();
      ws = null;
    }
  };
}
