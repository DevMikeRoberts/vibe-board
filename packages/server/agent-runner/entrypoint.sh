#!/usr/bin/env bash
# Per-task agent entrypoint: run the Claude agent against the mounted /repo
# workspace, then commit. The backend pushes the branch + opens the PR.
set -uo pipefail

cd /repo
git config --global --add safe.directory /repo || true
git config user.name "${GIT_AUTHOR_NAME:-AI Agent Board}" || true
git config user.email "${GIT_AUTHOR_EMAIL:-agent@agentboard.local}" || true

echo "[runner] starting Claude agent for: ${TASK_TITLE:-task}"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "[runner] ERROR: ANTHROPIC_API_KEY is not set"
  exit 1
fi

# Build the CLI args (array form so prompts with spaces/newlines stay intact).
ARGS=(-p "${TASK_PROMPT:-}" --dangerously-skip-permissions)
[ -n "${CLAUDE_SYSTEM_PROMPT:-}" ] && ARGS+=(--append-system-prompt "${CLAUDE_SYSTEM_PROMPT}")
[ -n "${ANTHROPIC_MODEL:-}" ] && ARGS+=(--model "${ANTHROPIC_MODEL}")

claude "${ARGS[@]}"
CLAUDE_EXIT=$?

if [ "$CLAUDE_EXIT" -ne 0 ]; then
  echo "[runner] claude exited with code ${CLAUDE_EXIT}"
  exit "$CLAUDE_EXIT"
fi

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit --no-verify \
    -m "${TASK_TITLE:-AI Agent Board task}" \
    -m "Automated commit from AI Agent Board (containerized Claude agent)"
  echo "[runner] committed changes"
else
  echo "[runner] no file changes produced by the agent"
fi

echo "[runner] done"
