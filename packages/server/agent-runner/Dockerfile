# Per-task agent image. The backend launches one ephemeral container of this
# image per task; it runs the Claude agent against the mounted /repo workspace
# and commits the result. The backend then pushes the branch + opens the PR.
#
# Build (context = repo root):
#   docker build -f packages/server/agent-runner/Dockerfile -t agentboard-agent-runner .
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl bash \
  && rm -rf /var/lib/apt/lists/*

# Claude Code CLI (provides the `claude` binary).
RUN npm install -g @anthropic-ai/claude-code

COPY packages/server/agent-runner/entrypoint.sh /usr/local/bin/agent-entrypoint
RUN chmod +x /usr/local/bin/agent-entrypoint

WORKDIR /repo
ENTRYPOINT ["/usr/local/bin/agent-entrypoint"]
