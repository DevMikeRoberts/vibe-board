# Squad Team

> ai-agent-board

## Casting Model

The team uses **The Matrix** universe for 9 casted domain agents. **Scribe** and **Ralph** are exempt core infrastructure roles (not counted against universe capacity).

| Member Count | Notes |
|---|---|
| 9 | Casted domain agents from The Matrix universe |
| 2 | Exempt core infrastructure (Scribe, Ralph) |
| **11** | **Total active team members** |

---

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Morpheus | Lead / Architect | `.squad/agents/morpheus/charter.md` | 🏗️ Active |
| Trinity | Frontend Dev | `.squad/agents/trinity/charter.md` | ⚛️ Active |
| Tank | Backend Dev | `.squad/agents/tank/charter.md` | 🔧 Active |
| Neo | Agent Runtime Specialist | `.squad/agents/neo/charter.md` | 🧠 Active |
| Switch | Tester / QA | `.squad/agents/switch/charter.md` | 🧪 Active |
| Dozer | DevOps / Production | `.squad/agents/dozer/charter.md` | ⚙️ Active |
| Cypher | Security Engineer | `.squad/agents/cypher/charter.md` | 🔒 Active |
| Oracle | Independent Reviewer | `.squad/agents/oracle/charter.md` | 🧠 Active |
| Seraph | Deep Reasoning Reviewer | `.squad/agents/seraph/charter.md` | 🧠 Active |
| Scribe | Session Logger | `.squad/agents/scribe/charter.md` | 📋 Active |
| Ralph | Work Monitor | `.squad/agents/ralph/charter.md` | 🔄 Active |

## Model Policy

Squad members use the most cost-effective model that meets quality requirements.

| Task type | Model | Rationale |
|---|---|---|
| Routine reads, file moves, docs, logs | `claude-haiku-4.5` | Fast and cheap for mechanical work |
| Implementation, refactoring, tests | `claude-sonnet-4.6` | Standard quality for code-writing work |
| Normal architecture and reviews | `claude-sonnet-4.6` | High quality without premium cost |
| Independent GPT critique | `gpt-5.5` | Oracle only; model-diverse blind-spot detection |
| Deep reasoning critique | `claude-opus-4.7-xhigh` | Seraph only; hard architecture/security/debugging escalation |

**Default for normal `task` calls:** `claude-sonnet-4.6`.

**Second-opinion escalation:** Normal members stay on Sonnet 4.6. If they are stuck, hit repeated failures, face architecture/security/debugging uncertainty, or need model-diverse critique, they ask the coordinator to route Oracle and/or Seraph. Oracle and Seraph are escalation reviewers, not routine implementers.

## Project Context

- **Project:** ai-agent-board
- **User:** Copilot
- **Created:** 2026-05-07
- **Casting:** The Matrix (9 casted domain agents; Scribe & Ralph are exempt core infrastructure)
- **Stack:** React 19 + Vite + Tailwind 4 + Framer Motion + xterm.js client; Express + TypeScript server; `@codewithdan/agent-sdk-core`; SQLite/PostgreSQL repositories; WebSocket event streaming; Playwright e2e.
- **Architecture:** Monorepo with `packages/client`, `packages/server`, `packages/e2e`, `shared`, `scripts`, and `k8s`.
- **Core behaviors:** Kanban task lifecycle, multi-agent provider selection, agent session orchestration, event persistence/broadcast, task groups, git worktree isolation, local merge, PR creation, and production deployment notes.
