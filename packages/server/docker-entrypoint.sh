#!/usr/bin/env bash
# Backend entrypoint: wire up git/gh auth from env (so the auto-PR pipeline can
# push branches and open PRs), then start the server.
set -e

if [ -n "${GH_TOKEN:-}" ]; then
  # Use the token for GitHub HTTPS pushes (works for git and gh).
  git config --global url."https://x-access-token:${GH_TOKEN}@github.com/".insteadOf "https://github.com/" || true
  # Also route SSH-style origins through the tokenized HTTPS endpoint (no SSH key
  # in the container), so push works regardless of the repo's origin format.
  git config --global url."https://x-access-token:${GH_TOKEN}@github.com/".insteadOf "git@github.com:" || true
  git config --global url."https://x-access-token:${GH_TOKEN}@github.com/".insteadOf "ssh://git@github.com/" || true
  gh auth setup-git 2>/dev/null || true
fi

git config --global user.name "${GIT_AUTHOR_NAME:-AI Agent Board}" || true
git config --global user.email "${GIT_AUTHOR_EMAIL:-agent@agentboard.local}" || true
# Mounted repos/clones may be owned by a different uid — trust them all.
git config --global --add safe.directory '*' || true

# Optional Homebrew bootstrap onto the persistent volume, so agents can install
# more tools themselves and keep them across deploys. No-op unless
# AGENTBOARD_ENABLE_BREW=1; never fatal, because a package manager that failed
# to install is not a reason to refuse to serve the board.
if [ -x /opt/agentboard-toolbox/install-brew.sh ]; then
  /opt/agentboard-toolbox/install-brew.sh || echo "[entrypoint] brew bootstrap failed, continuing"
fi

# Report what the agents will actually find, so a missing CLI is visible in the
# logs at boot rather than as a puzzling "unavailable" in the UI.
for cli in claude copilot codex opencode openclaw hermes; do
  if command -v "$cli" >/dev/null 2>&1; then
    echo "[entrypoint] agent CLI present: $cli -> $(command -v "$cli")"
  else
    echo "[entrypoint] agent CLI missing: $cli"
  fi
done

exec node packages/server/dist/index.js
