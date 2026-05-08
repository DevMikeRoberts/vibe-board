# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Architecture & shared contracts | Morpheus | Cross-package types, task lifecycle, repository interfaces, route boundaries, review gates |
| Frontend | Trinity | Board UI, cards, groups panel, filters, dialogs, terminal/xterm, themes, drag/drop |
| Backend | Tank | Express routes, middleware, DB init/migrations, repositories, REST API shape |
| Agent runtime | Neo | AgentManager, provider detection, SDK sessions, event mapping, tool hooks, worktree path rewriting |
| Testing & QA | Switch | Playwright e2e, API tests, validation edge cases, task group/agent/git workflows, accessibility |
| DevOps & production | Dozer | k8s manifests, systemd production, Docker/PostgreSQL, CI/CD, deployment docs |
| Security | Cypher | API key auth, WebSocket auth, repo-root whitelist, path traversal, secrets, shell/tool permissions |
| Independent critique | Oracle | Plan critique, code review, hidden assumptions, second-model perspective |
| Deep reasoning review | Seraph | Hard architecture/security/debugging escalation, failure analysis |
| Code review | Morpheus + Switch | Morpheus reviews architecture/contracts; Switch reviews test quality and gate evidence |
| Shared types | Morpheus + Trinity + Tank + Neo | `shared/` changes affecting client, server, and agent runtime |
| Task groups | Morpheus + Tank + Trinity + Switch | Queue semantics, group cards, concurrency, auto-advance, group e2e coverage |
| Git operations | Neo + Cypher + Switch | Worktree isolation, merge-local, PR creation, cleanup, path safety, regression tests |
| Event streaming | Neo + Tank + Trinity | Agent events persisted, cached, broadcast, rendered, and coalesced correctly |
| Observability/process audit | Dozer + Scribe/Ralph | Logs, heartbeat, orchestration-log coverage, telemetry evidence |
| Scope & priorities | Morpheus | What to build next, trade-offs, decisions |
| Session logging | Scribe | Automatic after substantial work |
| Work queue/backlog | Ralph | GitHub issues, PRs, stale work, board monitoring |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Morpheus |
| `squad:morpheus` | Architecture/review work | Morpheus |
| `squad:trinity` | Frontend work | Trinity |
| `squad:tank` | Backend/API/DB work | Tank |
| `squad:neo` | Agent runtime/git worktree work | Neo |
| `squad:switch` | Testing/QA work | Switch |
| `squad:dozer` | DevOps/production work | Dozer |
| `squad:cypher` | Security work | Cypher |
| `squad:oracle` | Independent review | Oracle |
| `squad:seraph` | Deep reasoning review | Seraph |
| `squad:ralph` | Work queue, stale issue, PR, and board monitoring | Ralph |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, Morpheus triages it: analyze content, assign the right `squad:{member}` label, and comment with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the inbox for untriaged issues.

## TDD / Impact / P0 Routing

These rules are additive to the routing table above.

| Situation | Action | Who |
|-----------|--------|-----|
| P0 behavior changes | Require explicit risk classification, targeted test evidence, and reviewer sign-off | Morpheus + Switch |
| Agent runtime changes | Require focused agent/session/event tests and Neo ownership | Neo + Switch |
| Git/worktree changes | Require path safety review and git operation tests | Neo + Cypher + Switch |
| Auth/whitelist/path handling changes | Require security review | Cypher |
| Shared type changes | Coordinate client/server/runtime consumers | Morpheus + Trinity + Tank + Neo |
| Guardrail files changed (`.squad/**`, `.copilot/**`, `.github/**`) | Require routing consistency validation and Scribe/Ralph awareness | Morpheus + Scribe |

## Rules

1. **Eager by default** - spawn all agents who could usefully start work, including downstream tests/reviews.
2. **Scribe always runs** after substantial work, always as background. Never blocks.
3. **Quick facts -> coordinator answers directly.** Do not spawn for simple status checks.
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." -> fan-out.** Spawn relevant agents in parallel.
6. **Anticipate downstream work.** If implementation starts, Switch can start test planning from requirements.
7. **Reviewer rejection lockout applies.** A rejected artifact must be revised by a different agent.
8. **Second-opinion escalation is explicit.** Oracle/Seraph run for high-risk, stuck, or model-diverse review work, not every task.
9. **Significant work requires a completion summary.** User-facing batch summaries include `Asked:`, `Completed:`, and `Open issues:`.
