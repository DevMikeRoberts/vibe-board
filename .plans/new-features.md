# New Feature Recommendations

## Current State Summary

The app is a well-architected Kanban board that delegates coding tasks to AI agents (Copilot, Claude, Codex, OpenCode). It has solid foundations: real-time WebSocket updates, drag-and-drop, multi-agent support, git worktree isolation, and event streaming. The code is clean with good separation of concerns.

---

## 🔥 HIGH IMPACT — Should Do

### 1. Re-run Failed Tasks (one-click retry)

Currently, when an agent fails, the user has to manually reconfigure and re-run. A "Retry" button on failed tasks that preserves the config and clears old events would be a huge UX win. The backend already supports `resetEvents` + `run` — this is mostly a UI addition.

### 2. Task Templates / Quick-Create

Power users will run similar tasks often (e.g., "fix bug in X", "add tests for Y", "refactor Z"). Templates with pre-filled repo path, agent type, and description patterns would save time. Could be localStorage-based to keep it simple.

### 3. Priority Selector in Task Creation

The `priority` field exists on the Task type but is always hardcoded to `'medium'` in the TaskDialog. It's already supported end-to-end (validation, DB, API) — just needs a dropdown in the create/edit form, and visual priority indicators on TaskCards (colored left border or badge).

### 4. Task Sorting Within Columns

Currently tasks have no ordering within a column. Adding sort by priority, creation date, or agent status would make larger boards manageable. This is UI-only — no backend changes needed.

### 5. Filter by Agent Type / Status

The Header has search (title/description) but no filters. Quick-filter chips for "Running", "Failed", "Copilot", "Claude" etc. would help when managing many tasks. Again, this is pure client-side filtering.

---

## ⚡ MEDIUM IMPACT — Worth Adding

### 6. Agent Cost/Duration Dashboard

The `duration` metadata already exists on `agent_complete` events. A small stats bar or dashboard showing total agent time, success rate, avg duration per agent would provide valuable insight without adding complexity.

### 7. Persistent Repo Path per Project

The WorktreeDialog already saves `lastRepo` to localStorage, but it's a single global value. If users work across multiple projects, remembering repo paths per task title pattern or per workspace would reduce friction.

### 8. "Done" → Reopen Transition

`VALID_TRANSITIONS` locks tasks in "done" with no way to reopen. Adding `'done': ['in-progress']` would let users retry or iterate on completed tasks.

### 9. Keyboard Shortcuts for Task Navigation

Only `N` (new task) and `Esc` (close) exist. Adding arrow-key navigation between tasks, `Enter` to open, `R` to run, `D` to delete would make the app keyboard-first for power users.

### 10. Export Event Log

The AgentPanel shows rich event history, but there's no way to export it. A "Copy log" or "Download as markdown" button would help debugging and documentation.

---

## 🧠 NICE-TO-HAVE — Consider Later

### 11. Multi-task Agent Orchestration

Run multiple tasks sequentially on the same agent (queue them up). The backend already supports concurrent sessions — a queue abstraction on top would enable "batch agent runs."

### 12. Task Dependencies

Let tasks depend on other tasks (e.g., "write tests" depends on "implement feature"). This would unlock more complex workflows but adds significant UI complexity.

### 13. WebSocket Re-sync on Reconnect

Already noted as a known issue — when the WS reconnects, there's no catch-up mechanism. A `since` timestamp on reconnect that fetches missed events would make the app more resilient.

### 14. Dark/Light Terminal Theme Sync

The TerminalView uses a hardcoded dark theme. Syncing it with the app's theme toggle would be a polish item.

---

## Recommended Starting Point

The highest ROI trio is: **Priority selector (#3)** + **Re-run failed tasks (#1)** + **Task sorting (#4)**. They're all low-effort, high-impact, and keep the app simple while making it noticeably more powerful.
