# Backend image for the AI Agent Board server.
# Runs the Express + WebSocket server, drives git/gh, and — with the host Docker
# socket mounted — launches per-task agent containers (see review-pipeline /
# container-runner). Build context must be the repo root:
#   docker build -f packages/server/Dockerfile -t agentboard-server .
FROM node:22-bookworm

# System deps: git, GitHub CLI (gh), Docker CLI (talks to the mounted host
# socket to spawn sibling per-task containers), and build tools as a fallback
# for native modules (better-sqlite3) when no prebuild matches the platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl gnupg build-essential python3 \
  && install -m 0755 -d /etc/apt/keyrings \
  # GitHub CLI apt repo
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | gpg --dearmor -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  # Docker CLI apt repo (client only — uses the mounted host daemon socket)
  && curl -fsSL https://download.docker.com/linux/debian/gpg \
       | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && chmod go+r /etc/apt/keyrings/docker.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
       > /etc/apt/sources.list.d/docker.list \
  && apt-get update && apt-get install -y --no-install-recommends gh docker-ce-cli \
  && rm -rf /var/lib/apt/lists/*

# The agent toolbox: the CLIs the board spawns (claude, copilot, codex,
# opencode, openclaw) plus the shell tools they reach for. Driven by a single
# editable list — infra/deploy/toolbox.manifest — so adding a tool is a one-line
# change, not a Dockerfile edit. Copied before the app sources so a change to
# application code does not invalidate this (slow) layer.
COPY infra/deploy/toolbox.manifest infra/deploy/install-toolbox.sh /opt/agentboard-toolbox/
RUN chmod +x /opt/agentboard-toolbox/install-toolbox.sh \
  && /opt/agentboard-toolbox/install-toolbox.sh --channel apt \
  && /opt/agentboard-toolbox/install-toolbox.sh --channel npm

# Homebrew is deliberately not installed here — it is bootstrapped at runtime
# onto the persistent volume so agent-installed tools survive redeploys, and so
# this image stays small enough for a free-tier root volume. See
# infra/deploy/install-brew.sh.
COPY infra/deploy/install-brew.sh /opt/agentboard-toolbox/
RUN chmod +x /opt/agentboard-toolbox/install-brew.sh \
  && useradd -m -s /bin/bash linuxbrew \
  && mkdir -p /home/linuxbrew \
  && chown -R linuxbrew:linuxbrew /home/linuxbrew

# Homebrew's prefix, so anything installed there is reachable by the agents.
ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"

WORKDIR /app

# Install deps first for better layer caching: copy only workspace manifests.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/
COPY packages/e2e/package.json ./packages/e2e/
RUN npm ci

# Copy sources and build the shared lib + server.
COPY . .
RUN npm run build:shared && npm run build:server \
  && cp packages/server/docker-entrypoint.sh /usr/local/bin/agentboard-entrypoint \
  && chmod +x /usr/local/bin/agentboard-entrypoint

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# The SQLite DB and cloned repos persist via mounted volumes (see
# docker-compose.yml). DATABASE_URL switches to Postgres when set.
# The entrypoint wires up git/gh auth from GH_TOKEN before starting the server.
ENTRYPOINT ["/usr/local/bin/agentboard-entrypoint"]
