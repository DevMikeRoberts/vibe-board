# Frontend image for the AI Agent Board: builds the Vite bundle and serves it
# from nginx. Build context must be the repo root (the client imports the
# `shared` workspace):
#   docker build -f packages/client/Dockerfile -t agentboard-web .
#
# No VITE_API_BASE / VITE_API_KEY is baked in. The bundle is served from the
# same origin as the API, so it uses relative /api and /ws, and the reverse
# proxy injects the backend's bearer token — the browser never receives it.

FROM node:22-bookworm-slim AS build

# Fallback toolchain for workspace dependencies without a matching prebuild
# (better-sqlite3); npm ci installs every workspace, not just the client.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The e2e workspace pulls in Playwright; the browsers are useless here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV npm_config_fund=false
ENV npm_config_audit=false

WORKDIR /app

# Manifests first so dependency installation caches independently of sources.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/
COPY packages/e2e/package.json ./packages/e2e/
RUN npm ci

COPY . .
RUN npm run build:shared && npm run build:client

FROM nginx:1.27-alpine

COPY packages/client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/client/dist /usr/share/nginx/html

EXPOSE 80
