# Critical-Behavior Coverage Matrix

**Owner:** Switch, with Morpheus and Oracle review at major gates.

This matrix is the canonical behavior-risk guide for ai-agent-board. A row does not require a test for every doc-only change, but code changes touching a listed surface must provide targeted evidence. For browser workflow or client-server behavior changes, affected e2e coverage is a hard gate; portability/setup gaps are blockers, not explicit limitations.

## Legend

- P0: must not regress; requires focused test evidence and reviewer sign-off.
- P1: important workflow; requires targeted test or build evidence.
- P2: lower-risk behavior; validate with appropriate local checks.

## P0 Surfaces

| Behavior | Owner | Expected evidence |
|---|---|---|
| Agent provider detection preserves `copilot`, `claude`, `codex`, `opencode` behavior | Neo | Agent SDK/provider tests or focused runtime test |
| Agent session lifecycle handles timeout, failure, cleanup, follow-up, and graceful shutdown | Neo | Focused server tests or integration reproduction |
| Agent events are persisted, cached, broadcast, and rendered without loss/duplication | Neo + Tank + Trinity | Server event tests plus UI/WebSocket evidence where relevant |
| Git worktree isolation, path rewriting, merge-local mutex, conflict abort, PR creation, and cleanup remain safe | Neo + Cypher | Git operation tests/e2e plus path safety review |
| API key auth protects API and WebSocket when `API_KEY` is set | Cypher + Tank | Middleware/API/WebSocket auth tests |
| `ALLOWED_REPO_ROOTS` prevents unsafe repo paths and traversal | Cypher + Neo | Path validation tests |
| Task group queue enforces max concurrency and auto-advances only when all children complete | Morpheus + Tank + Trinity + Switch | Group route/unit/e2e tests |
| SQLite and PostgreSQL repository behavior stays aligned across migrations | Tank | Repository tests or migration verification |
| Windows Local Path task creation, repo path entry, and browser-to-server path validation remain portable | Trinity + Tank + Switch | Deterministic Playwright e2e evidence on Windows or fixed portability blockers before approval |

## P1 Surfaces

| Behavior | Owner | Expected evidence |
|---|---|---|
| Task CRUD and status transitions obey `VALID_TRANSITIONS` | Tank + Trinity | API tests and board e2e |
| Template CRUD stays compatible across backends | Tank | Repository/API tests |
| Group CRUD and archive/run/stop behavior remain consistent | Tank + Trinity | Route tests and group UI e2e |
| Smart PR/merge buttons reflect remote availability | Trinity + Neo | UI/API tests or e2e |
| Agent selector and retry/follow-up flows preserve selected provider | Trinity + Neo | Component/e2e coverage |
| Event coalescing in AgentPanel remains readable without hiding failures | Trinity | Component/UI tests |

## P2 Surfaces

| Behavior | Owner | Expected evidence |
|---|---|---|
| Theme, filters, sorting, priority display, and keyboard shortcuts remain usable | Trinity + Switch | Component/e2e checks |
| Production docs and k8s manifests stay accurate | Dozer | Review plus manifest validation when changed |
| Copy buttons and terminal display avoid leaks/timer regressions | Trinity | Component tests when changed |
