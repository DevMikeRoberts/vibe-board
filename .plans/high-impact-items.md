---
shaping: true
---

# High-Impact Features — Shaping

## Requirements (R)

| ID | Requirement | Status |
|----|-------------|--------|
| **R0** | Users can retry failed tasks without re-entering configuration | Core goal |
| **R1** | Users can choose between one-click retry (same config) or reconfigure-then-retry | Must-have |
| **R2** | Users can save and reuse task templates with pre-filled fields | Core goal |
| **R3** | Templates are stored in the database (shared across devices/browsers) | Must-have |
| **R4** | Users can set priority (low/medium/high/critical) when creating or editing a task | Core goal |
| **R5** | Priority is visually indicated on task cards via a colored left border | Must-have |
| **R6** | Users can sort tasks within columns by priority, creation date, or agent status | Core goal |
| **R7** | Sort preference is global (applies to all columns) and persists via localStorage | Must-have |
| **R8** | Users can filter tasks by agent type and/or agent status using clickable chips | Core goal |
| **R9** | Filters are combinable (e.g., "Claude" + "Failed") and persist via localStorage | Must-have |

---

## Shape A: Incremental UI + Thin Backend

A single shape (not comparing alternatives) — each feature is a component with well-defined boundaries.

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **A1** | **Re-run Failed Tasks** | |
| A1.1 | Retry button (↻ icon) on TaskCard for failed tasks — calls existing `POST /api/tasks/:id/run` | |
| A1.2 | AgentPanel: swap Play icon → RotateCw icon when `agentStatus === 'failed'`, title becomes "Retry agent" | |
| A1.3 | "Reconfigure" button on AgentPanel opens WorktreeDialog pre-filled with task's existing config, then runs | |
| A1.4 | Backend: no changes needed — `POST /:id/run` already resets events and re-starts the agent | |
| **A2** | **Task Templates (DB-backed)** | |
| A2.1 | New `templates` table: `id`, `name`, `title`, `description`, `priority`, `agentType`, `repoPath`, `baseBranch`, `useWorktree`, `createdAt`. No `branchPattern` — users set branch per task. | |
| A2.2 | New `TemplateRepository` interface (separate from `TaskRepository` — SRP) with `getAll()`, `getById()`, `create()`, `update()`, `delete()` | |
| A2.3 | API routes: `GET /api/templates`, `POST /api/templates`, `PATCH /api/templates/:id`, `DELETE /api/templates/:id` | |
| A2.4 | "Save as Template" button in TaskDialog (edit mode) — saves current field values as a named template | |
| A2.5 | Template picker dropdown in TaskDialog (create mode) — selecting a template pre-fills all fields | |
| A2.6 | Template management: small "Manage Templates" link opens a list with rename/delete actions | |
| **A3** | **Priority Selector** | |
| A3.1 | Add `priority` state to TaskDialog, default `'medium'`. Custom dropdown (matching Agent selector style) between Description and Agent fields | |
| A3.2 | Priority colors: `low` → slate/gray, `medium` → blue, `high` → amber, `critical` → red. Applied as `border-l-4` on TaskCard outermost div | |
| A3.3 | Update `handleSubmit` in TaskDialog to pass `priority` state instead of hardcoded `'medium'` | |
| A3.4 | Edit mode: pre-populate priority from `editTask.priority` | |
| **A4** | **Task Sorting** | |
| A4.1 | Sort state in App.tsx: `sortBy: 'title' | 'priority' | 'created' | 'status'`, `sortDir: 'asc' | 'desc'`, persisted to localStorage. **Default: title A→Z** | |
| A4.2 | Sort control in Header: small dropdown or segmented buttons next to search (Sort: Title ▼) — options: Title, Priority, Created, Status | |
| A4.3 | Sort logic applied in `getFilteredTasksByColumn` memo — `title` uses localeCompare, `priority` uses weight map (critical=0, high=1, medium=2, low=3), `created` uses `createdAt`, `status` uses agent status weight (executing=0, planning=1, failed=2, idle=3, complete=4) | |
| **A5** | **Filter Chips** | |
| A5.1 | Filter state in App.tsx: `activeAgentTypes: AgentType[]`, `activeStatuses: AgentStatus[]`, persisted to localStorage | |
| A5.2 | Chip row below search bar in Header: agent type chips (⚙️ Copilot, 🟠 Claude, 🟢 Codex, 🔵 OpenCode) + status chips (Running, Failed, Complete). "Running" maps to `planning` OR `executing`. Idle tasks always visible (no chip). | |
| A5.3 | Chips are toggle-able — active chips get `bg-primary text-primary-foreground`, inactive get `bg-muted` | |
| A5.4 | Filter logic in `filteredTasks` memo: **AND between groups, OR within groups** — e.g., (Claude OR Copilot) AND (Failed OR Running). When any agent chips active, only show tasks matching those agents; same for status chips. Empty group = no filter (show all). Idle tasks pass through status filter when no status chips are active. | |
| A5.5 | "Clear filters" button appears when any filter is active | |

---

## Fit Check: R × A

| Req | Requirement | Status | A |
|-----|-------------|--------|:-:|
| R0 | Users can retry failed tasks without re-entering configuration | Core goal | ✅ |
| R1 | Users can choose between one-click retry or reconfigure-then-retry | Must-have | ✅ |
| R2 | Users can save and reuse task templates with pre-filled fields | Core goal | ✅ |
| R3 | Templates are stored in the database (shared across devices/browsers) | Must-have | ✅ |
| R4 | Users can set priority when creating or editing a task | Core goal | ✅ |
| R5 | Priority visually indicated via colored left border on task cards | Must-have | ✅ |
| R6 | Users can sort tasks within columns by priority, date, or status | Core goal | ✅ |
| R7 | Sort is global, persists via localStorage | Must-have | ✅ |
| R8 | Users can filter by agent type and/or status using clickable chips | Core goal | ✅ |
| R9 | Filters are combinable and persist via localStorage | Must-have | ✅ |

---

## Implementation Details

### A1: Re-run Failed Tasks

**Files changed:**
- `packages/client/src/components/TaskCard.tsx` — Add ↻ (RotateCw) button in action buttons area (after Archive, before Delete) for `task.agentStatus === 'failed'`
- `packages/client/src/components/AgentPanel.tsx` — Swap Play → RotateCw icon when failed; add "Reconfigure & Retry" button that opens WorktreeDialog
- `packages/client/src/App.tsx` — Wire new `onRetry` (one-click) and `onReconfigureRetry` (opens dialog) callbacks

**Backend:** Zero changes. `POST /api/tasks/:id/run` already calls `resetEvents()` and starts fresh.

### A2: Task Templates (DB-backed)

**Files changed:**
- `shared/types.ts` — Add `TaskTemplate` interface (includes `priority` field from A3)
- `packages/server/src/db.ts` — Add `templates` table migration
- `packages/server/src/repositories/template-types.ts` — New `TemplateRepository` interface (separate from `TaskRepository` for SRP)
- `packages/server/src/repositories/sqlite-templates.ts` — Implement template methods for SQLite
- `packages/server/src/repositories/postgres-templates.ts` — Implement template methods for PostgreSQL
- `packages/server/src/routes/templates.ts` — New router: GET, POST, PATCH, DELETE with validation (name required, unique, max 100 chars)
- `packages/server/src/index.ts` — Mount template router
- `packages/client/src/lib/api.ts` — Add template API calls
- `packages/client/src/components/TaskDialog.tsx` — Template picker dropdown + "Save as Template" button (both create and edit modes)

### A3: Priority Selector

**Files changed:**
- `packages/client/src/components/TaskDialog.tsx` — Add priority dropdown (same style as Agent selector), update `handleSubmit` to use state instead of hardcoded `'medium'`
- `packages/client/src/components/TaskCard.tsx` — Add `border-l-4` with priority color class to outermost div's `cn()` call
- `packages/client/src/lib/priority-config.ts` — New file: priority color map + display config (label, color, weight)

### A4: Task Sorting

**Files changed:**
- `packages/client/src/App.tsx` — Add `sortBy`/`sortDir` state with localStorage persistence; extend `getFilteredTasksByColumn` to apply sort
- `packages/client/src/components/Header.tsx` — Add sort dropdown/control next to search
- `packages/client/src/lib/priority-config.ts` — Export priority weight map for sort comparisons

### A5: Filter Chips

**Files changed:**
- `packages/client/src/App.tsx` — Add `activeAgentTypes`/`activeStatuses` state with localStorage persistence; extend `filteredTasks` memo to apply filters
- `packages/client/src/components/Header.tsx` — Add chip row below search bar
- `packages/client/src/components/FilterChips.tsx` — New component: renders agent type + status chips with toggle behavior and clear button

---

## Task List

### Feature 1: Re-run Failed Tasks
- [ ] **A1.1** Add `onRetry` prop + RotateCw button to TaskCard for failed tasks
- [ ] **A1.2** Update AgentPanel: swap Play→RotateCw icon for failed tasks, update title text
- [ ] **A1.3** Add "Reconfigure & Retry" button to AgentPanel that opens WorktreeDialog pre-filled
- [ ] **A1.4** Wire callbacks in App.tsx (`onRetry` calls `runTask`, `onReconfigureRetry` opens WorktreeDialog then runs)
- [ ] **A1.5** E2E test: create task → run → force fail → retry button visible → click retry → agent restarts

### Feature 2: Task Templates (DB-backed)
- [ ] **A2.1** Add `TaskTemplate` type to `shared/types.ts` (includes `priority`, drops `branchPattern`)
- [ ] **A2.2** Add `templates` table migration to `db.ts` (SQLite + PostgreSQL)
- [ ] **A2.3** Create `TemplateRepository` interface in `repositories/template-types.ts` (separate from TaskRepository)
- [ ] **A2.4** Implement template methods in `sqlite-templates.ts`
- [ ] **A2.5** Implement template methods in `postgres-templates.ts`
- [ ] **A2.6** Create `routes/templates.ts` — GET, POST, PATCH, DELETE endpoints with validation (name required, unique, max 100 chars)
- [ ] **A2.7** Mount template router in `index.ts`
- [ ] **A2.8** Add template API calls to `lib/api.ts`
- [ ] **A2.9** Add template picker dropdown to TaskDialog (create mode) — fetches templates on open
- [ ] **A2.10** Add "Save as Template" button to TaskDialog (both create and edit modes) — prompts for template name, saves via API
- [ ] **A2.11** Add template management UI (list with rename/delete/edit) — accessible from TaskDialog
- [ ] **A2.12** E2E test: create template → new task from template → fields pre-filled → delete template

### Feature 3: Priority Selector
- [ ] **A3.1** Create `lib/priority-config.ts` — color map, display config, weight map
- [ ] **A3.2** Add priority state + custom dropdown to TaskDialog (between Description and Agent)
- [ ] **A3.3** Update `handleSubmit` to use priority state instead of hardcoded `'medium'`
- [ ] **A3.4** Pre-populate priority from `editTask.priority` in edit mode
- [ ] **A3.5** Add `border-l-4` with priority color to TaskCard outermost div
- [ ] **A3.6** E2E test: create task with high priority → card shows amber left border → edit → change priority → border updates

### Feature 4: Task Sorting
- [ ] **A4.1** Add `sortBy`/`sortDir` state to App.tsx with localStorage read/write — default: title A→Z
- [ ] **A4.2** Add sort dropdown UI to Header (next to search) — options: Title, Priority, Created, Status
- [ ] **A4.3** Implement sort comparator in `getFilteredTasksByColumn` using localeCompare (title), priority weights, `createdAt`, and agent status weights
- [ ] **A4.4** E2E test: create tasks with different priorities → change sort → verify order changes

### Feature 5: Filter Chips
- [ ] **A5.1** Create `FilterChips.tsx` component — renders chips for agent types + statuses with toggle + clear
- [ ] **A5.2** Add `activeAgentTypes`/`activeStatuses` state to App.tsx with localStorage persistence
- [ ] **A5.3** Integrate FilterChips into Header below search bar
- [ ] **A5.4** Extend `filteredTasks` memo to apply agent type + status filters (empty = show all)
- [ ] **A5.5** E2E test: create tasks with different agents → click "Claude" chip → only Claude tasks shown → clear → all shown

---

## Recommended Build Order

Build in this sequence — each feature stands alone, but this order minimizes rework:

1. **Priority Selector (A3)** — Unlocks sorting by priority; smallest scope, pure UI + config
2. **Task Sorting (A4)** — Builds on priority weights from A3; pure client-side
3. **Filter Chips (A5)** — Shares Header real estate with sort control; design them together
4. **Re-run Failed Tasks (A1)** — Independent; no backend changes; high user value
5. **Task Templates (A2)** — Largest scope (DB + API + UI); do last to benefit from all other UI patterns

---

## Resolved Decisions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| D1 | Retry: same config or allow reconfigure? | Both — one-click retry + reconfigure option | Maximum flexibility without clutter |
| D2 | Templates: localStorage or DB? | Database-backed | Shared across devices/browsers |
| D3 | Priority visual: border, badge, or both? | Colored left border (`border-l-4`) | Subtle, always visible, no clutter |
| D4 | Sort: global or per-column? | Global | Simpler UX, one control |
| D5 | Filter UI: chips, dropdown, or collapsible? | Clickable chips below search bar | Visible, fast, minimal clicks |
| D6 | Persist sort/filters? | Yes, via localStorage | Survives page reload |
| D7 | Template `branchPattern` field? | Dropped — users set branch per task | Simpler; branch names are too context-specific |
| D8 | Default sort order? | Title A→Z | User preference |
| D9 | Status filter chips? | Running + Failed + Complete only | Actionable statuses; idle passes through |
| D10 | Filter combination logic? | AND between groups, OR within groups | Standard faceted filter pattern |
| D11 | Template includes priority? | Yes | A3 adds priority; templates should capture it |
| D12 | Template repository? | Separate `TemplateRepository` (not mixed into `TaskRepository`) | SRP — templates are a distinct entity |
