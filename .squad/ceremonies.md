# Ceremonies

> Team meetings and gates that keep ai-agent-board work safe, reviewed, and verifiable.

## Design Review

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | before |
| **Condition** | multi-agent task involving shared client/server/runtime contracts |
| **Facilitator** | Morpheus |
| **Participants** | all-relevant |
| **Enabled** | yes |

**Agenda:**
1. Confirm requirement and affected domains.
2. Agree on shared interfaces and risk tier.
3. Assign implementation, test, and review owners.

---

## Pre-Flight Baseline

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | before |
| **Condition** | first task of a new feature batch or any P0 change |
| **Facilitator** | Switch |
| **Participants** | Switch, Dozer |
| **Skill** | `.squad/skills/gate-enforcement/SKILL.md` |
| **Enabled** | yes |

**Agenda:**
1. Identify affected risk surface from `.squad/coverage-matrix.md`.
2. Run the smallest meaningful existing baseline command.
3. If baseline is red, separate baseline failure from feature work before continuing.

---

## Per-Task Gate

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | after |
| **Condition** | any code-producing task |
| **Facilitator** | Switch |
| **Participants** | task owner |
| **Skill** | `.squad/skills/gate-enforcement/SKILL.md` |
| **Enabled** | yes |

**Agenda:**
1. Run targeted tests for the changed surface.
2. Run `npm run build:server` for server/shared/runtime changes.
3. Run `npm run build:client` for client/shared changes.
4. For browser workflow or client-server behavior changes, run a deterministic e2e command and record the exact command as evidence; if app processes, local paths, or setup are not portable enough to run it, the gate fails until fixed.
5. Enforce the fix-loop ceiling: 3 attempts or 5 minutes on the same failure class before escalation.

---

## Agent Runtime Safety Review

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | before and after |
| **Condition** | changes touching agent sessions, tool hooks, event mapping, worktrees, merge-local, PR creation, or repo path rewriting |
| **Facilitator** | Neo |
| **Participants** | Neo, Cypher, Switch |
| **Enabled** | yes |

**Agenda:**
1. Identify the runtime safety boundary.
2. Confirm path/auth/permission behavior stays fail-closed.
3. Require focused regression evidence or explicit documented limitation.

---

## Process Hygiene Sweep

| Field | Value |
|-------|-------|
| **Trigger** | auto or user request |
| **When** | after |
| **Condition** | Playwright/browser/dev-server bursts, long-running test sessions, or "cleanup procs" request |
| **Facilitator** | Dozer |
| **Skill** | `.squad/skills/process-hygiene/SKILL.md` |
| **Enabled** | yes |

**Agenda:**
1. Identify orphaned test/browser/dev-server processes by PID.
2. Preserve IDE, shell, MCP, and user-owned processes.
3. Stop only confirmed orphaned processes.

---

## Squad Drift / Delegation Audit

| Field | Value |
|-------|-------|
| **Trigger** | manual or after large work batch |
| **When** | after |
| **Condition** | user asks for audit/status or major team state changes occurred |
| **Facilitator** | Ralph |
| **Participants** | Scribe, Morpheus |
| **Enabled** | yes |

**Agenda:**
1. Check heartbeat freshness.
2. Check orchestration-log coverage for significant work.
3. Confirm routing matched `routing.md`.
4. File follow-ups as decisions inbox entries or GitHub issues when connected.

---

## Retrospective

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | after |
| **Condition** | build failure, test failure, reviewer rejection, or repeated fix-loop ceiling |
| **Facilitator** | Morpheus |
| **Participants** | all-involved |
| **Enabled** | yes |

**Agenda:**
1. What happened? Facts only.
2. Root cause.
3. What changes in routing, skills, tests, or implementation?
4. Record action items in decisions inbox or GitHub issues.
