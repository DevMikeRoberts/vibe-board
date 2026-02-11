# Kanban Board API Improvements — Orchestration-Ready

## Goal
Make the API clean enough for programmatic orchestration: create a task, assign an agent, run it, and get notified on completion — all with minimal friction.

---

## 1. Single-Call Task Creation + Run

### Problem
Creating and running a task requires 3 API calls: POST create → PATCH set agentType/repoPath → POST run.

### Solution
Extend `POST /api/tasks` to accept all fields including `agentType`, `repoPath`, `branchName`, `baseBranch`, `useWorktree`. Add an optional `autoRun: true` field that immediately starts the agent after creation.

**Changes:**
- `packages/server/src/routes/tasks.ts` — POST handler: accept `agentType`, `repoPath`, `branchName`, `baseBranch`, `useWorktree`, `autoRun` in the request body
- When `autoRun: true` AND `columnId` is `in-progress`:
  - Set the task's agentType, repoPath, etc. on creation
  - Call `agentManager.startAgent()` immediately after insert
  - Return the task with `agentStatus: 'planning'` or `'executing'`
- Validate `agentType` against available agents before auto-running
- If `autoRun` is true but agent is unavailable, still create the task but return it with `agentStatus: 'failed'` and an error in the response

**Example request:**
```json
POST /api/tasks
{
  "title": "Fix login bug",
  "description": "The login form doesn't validate email format...",
  "priority": "high",
  "columnId": "in-progress",
  "agentType": "claude",
  "repoPath": "/root/projects/my-app",
  "autoRun": true
}
```

**Example response:**
```json
{
  "id": "abc-123",
  "title": "Fix login bug",
  "agentType": "claude",
  "agentStatus": "executing",
  "repoPath": "/root/projects/my-app",
  ...
}
```

---

## 2. Completion Callback via WebSocket Events

### Problem
No way to know when a task finishes without polling.

### Solution
The WebSocket already broadcasts `task_updated` events. Add a dedicated `agent_complete` message type that fires when an agent finishes (success or failure), containing the task ID, final status, and a summary.

**Changes:**
- `packages/server/src/services/agent-manager.ts` — In the completion paths (`terminateOnce`), broadcast a new WS message:
  ```typescript
  broadcast({
    type: 'agent_complete',
    payload: {
      taskId: task.id,
      status: 'complete' | 'failed',
      agentType: task.agentType,
      duration: Date.now() - startTime,
      eventCount: this.getEvents(task.id).length,
    }
  });
  ```
- `shared/types.ts` — Add `agent_complete` to the `WSMessage` union type
- Track `startTime` when `startAgent()` is called (add to `ManagedSession`)

This doesn't require a new endpoint — any WebSocket client (including me via a script) can listen for `agent_complete` events.

---

## 3. Polling Endpoint: GET /api/tasks/:id/status

### Problem
Getting task status requires fetching the full task object. For polling, a lightweight status endpoint is better.

### Solution
Add `GET /api/tasks/:id/status` that returns just the essential status info.

**Changes:**
- `packages/server/src/routes/tasks.ts` — New route:
  ```typescript
  router.get('/:id/status', (req, res) => {
    const task = repo.getById(paramId(req));
    if (!task) return res.status(404).json({ error: 'not found' });
    res.json({
      id: task.id,
      agentStatus: task.agentStatus,
      agentType: task.agentType,
      columnId: task.columnId,
      isRunning: agentManager.isRunning(task.id),
    });
  });
  ```

---

## 4. Batch Create + Run

### Problem
Fanning out to multiple agents requires N×3 API calls.

### Solution
Add `POST /api/tasks/batch` that accepts an array of task definitions and creates + optionally runs them all.

**Changes:**
- `packages/server/src/routes/tasks.ts` — New route:
  ```typescript
  router.post('/batch', (req, res) => {
    const { tasks } = req.body; // Array of task definitions
    // Validate all tasks first (fail fast)
    // Create all tasks
    // If any have autoRun: true, start their agents
    // Return array of created tasks
  });
  ```

**Example request:**
```json
POST /api/tasks/batch
{
  "tasks": [
    {
      "title": "Fix bug in auth",
      "description": "...",
      "priority": "high",
      "columnId": "in-progress",
      "agentType": "copilot",
      "repoPath": "/root/projects/my-app",
      "autoRun": true
    },
    {
      "title": "Add unit tests",
      "description": "...",
      "priority": "medium",
      "columnId": "in-progress",
      "agentType": "claude",
      "repoPath": "/root/projects/my-app",
      "autoRun": true
    }
  ]
}
```

---

## 5. Task Result Summary in Events

### Problem
Events are raw agent output — hard to parse programmatically for "what happened?"

### Solution
When an agent completes, generate a structured summary event as the final event.

**Changes:**
- `packages/server/src/services/agent-manager.ts` — In `terminateOnce('complete')`, emit a summary event:
  ```typescript
  this.emitEvent(task.id, {
    id: uuid(),
    taskId: task.id,
    type: 'complete',
    content: 'Task completed successfully.',
    timestamp: Date.now(),
    metadata: {
      agentType: task.agentType,
      duration: Date.now() - startTime,
    }
  });
  ```
- For failures, include the error message in the final event's metadata.

---

## Implementation Order

1. **Single-call create + run** (highest impact — reduces 3 calls to 1)
2. **agent_complete WebSocket event** (enables fire-and-forget)
3. **Lightweight status endpoint** (cheap polling fallback)
4. **Batch endpoint** (multi-agent fan-out)
5. **Summary events** (structured completion data)

## Files to Modify

- `packages/server/src/routes/tasks.ts` — Items 1, 3, 4
- `packages/server/src/services/agent-manager.ts` — Items 2, 5
- `shared/types.ts` — Item 2 (WSMessage union)
- `packages/server/src/index.ts` — Pass agentManager to routes (if not already)

## Testing

- Update existing E2E tests to use the new single-call create+run
- Add new tests:
  - `autoRun: true` creates and immediately starts agent
  - `autoRun: true` with unavailable agent returns created task with failed status
  - `/batch` creates multiple tasks and runs them
  - `/status` returns lightweight status
  - WebSocket receives `agent_complete` event
- All existing 17 tests must still pass

## Constraints

- Don't break existing API — all current endpoints must work as before
- `autoRun` defaults to `false` so existing clients are unaffected
- Batch endpoint validates all tasks before creating any (atomic)
