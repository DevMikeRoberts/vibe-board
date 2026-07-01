---
name: repo-scan
description: Build repository context before implementing. Injected into every non-Claude agent (Copilot, Codex, OpenCode, Hermes, OpenClaw) so it understands the codebase's stack, layout, and conventions before writing code.
---

# Skill: Repo Scan — Understand Before You Implement

**Confidence:** high
**Domain:** agent-runtime
**Applies to:** every agent that is NOT Claude

## Context

Non-Claude agents tend to start editing immediately, without first learning the
repository they were dropped into. The result is changes that ignore existing
helpers, break local conventions, and land in the wrong place. Claude Code's
skills give agents a guided procedure for exactly this; this skill ports that
idea so the board's other agents (Copilot, Codex, OpenCode, Hermes, OpenClaw)
run an explicit repository-understanding pass first.

The board injects this skill into the non-Claude agent's system prompt at run
time. The authoritative injected text lives in
`packages/server/src/services/repo-scan.ts` (`buildRepoScanPromptSection`) so the
skill is self-contained and does not depend on this file existing inside the
task's target repository. Keep the two in sync; this file is the human-facing
mirror. Claude itself is exempt — it already does this — and the pass can be
turned off with the `AGENTBOARD_REPO_SCAN` environment variable.

## Pattern

### Scan procedure (run before the first edit)

1. **Read orientation docs** — `AGENTS.md`, `CLAUDE.md`, `README.md`,
   `CONTRIBUTING.md`, and any `docs/` overview. They usually state the
   architecture, conventions, and build/test commands.
2. **Read the manifest(s)** — `package.json` / `pyproject.toml` / `go.mod` /
   `Cargo.toml` / `pom.xml` — to learn the language, frameworks, scripts, and
   dependencies to reuse instead of reinventing.
3. **Map the layout** one or two levels deep so you know where source, tests,
   and config live, and where your change belongs.
4. **Locate the task-relevant files** and read them plus their neighbours to
   learn local patterns (naming, error handling, imports, module boundaries).
5. **Identify build / lint / test commands** so you can verify your change the
   way the project expects.

### Required output (before editing)

Emit a short brief in exactly this format, tags on their own lines:

```
<repo-scan>
## Stack
Languages, frameworks, and key tooling you found.
## Layout
Where the code that matters for this task lives.
## Conventions
Patterns/helpers this task should follow or reuse.
## Plan
How you will implement the task consistently with the above.
</repo-scan>
```

Prefer existing utilities and patterns over new ones, match the surrounding
code's style, and only begin editing after the brief.
