import type { AgentType } from '../types.js';

/**
 * Repo-scan pre-step for non-Claude agents.
 *
 * Non-Claude agents (Copilot, Codex, OpenCode, Hermes, OpenClaw) tend to dive
 * straight into edits without first building an understanding of the repository
 * they were dropped into, which produces changes that ignore existing
 * conventions, helpers, and structure. Claude Code ships a "skills" workflow for
 * exactly this kind of guided procedure; here we port that idea by injecting a
 * Claude-native repo-scan skill into the system prompt of every agent that is
 * NOT Claude, forcing an explicit repository-understanding pass before any code
 * is written.
 *
 * This module is the single source of truth for the injected skill text. The
 * human-readable mirror lives at `.claude/skills/repo-scan/SKILL.md` (board
 * documentation / Claude Code discoverability); the constant below is what
 * actually reaches the agent, so the skill is self-contained and never depends
 * on that file existing inside the task's target repository.
 */

/** Env var toggling the repo-scan pre-step. Default ON; set to a falsey value to disable. */
export const REPO_SCAN_ENV = 'AGENTBOARD_REPO_SCAN';

const FALSEY = new Set(['0', 'false', 'no', 'off']);

/** Claude is already good at understanding repos, so it is exempt from the pre-step. */
export function isClaudeAgent(agentType: AgentType): boolean {
  return agentType === 'claude';
}

/** Whether the repo-scan pre-step is enabled (default on unless explicitly disabled). */
export function isRepoScanEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env[REPO_SCAN_ENV] ?? '').trim().toLowerCase();
  if (raw === '') return true; // unset → enabled by default
  return !FALSEY.has(raw);
}

/** True when a repo-scan skill should be injected for this agent. */
export function shouldRunRepoScan(agentType: AgentType, env: NodeJS.ProcessEnv = process.env): boolean {
  return isRepoScanEnabled(env) && !isClaudeAgent(agentType);
}

/**
 * Build the repo-scan skill block to splice into a non-Claude agent's system
 * prompt. Returns an empty string when the pre-step does not apply (Claude, or
 * disabled), so callers can inject it unconditionally.
 */
export function buildRepoScanPromptSection(
  agentType: AgentType,
  workingDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!shouldRunRepoScan(agentType, env)) return '';
  return `
<repo-scan-skill>
BEFORE writing or editing ANY code, run this repository-understanding pass. Do
not skip it — implementing without context produces changes that fight the
codebase's existing conventions.

Scan procedure (work in ${workingDirectory}):
1. Read the orientation docs if present: AGENTS.md, CLAUDE.md, README.md,
   CONTRIBUTING.md, and any docs/ overview. They usually state the architecture,
   conventions, and the build/test commands.
2. Read the manifest(s) — package.json / pyproject.toml / go.mod / Cargo.toml /
   pom.xml — to learn the language, frameworks, scripts, and dependencies you
   should reuse instead of reinventing.
3. Map the directory layout at least one or two levels deep so you know where
   source, tests, and config live and where your change belongs.
4. Locate the files most relevant to THIS task and read them, plus their nearby
   neighbours, to learn the local patterns (naming, error handling, imports,
   module boundaries) you must match.
5. Identify how the project is built, linted, and tested so you can verify your
   change the way the project expects.

Then, before your first edit, emit a short brief in EXACTLY this format (keep
the tags on their own lines):
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

Prefer existing utilities and patterns over new ones. Match the surrounding
code's style. Only after the brief should you begin editing.
</repo-scan-skill>
`;
}
