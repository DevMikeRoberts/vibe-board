# Contributing

Thanks for your interest in contributing to AI Agent Board!

## Getting Started

See the [README](README.md) for setup instructions. The quickest path is:

```bash
npm install
npm run dev:server   # Terminal 1 — port 8080
npm run dev:client   # Terminal 2 — port 8081
```

## Running Tests

```bash
# Deterministic required gate (client build, server build, E2E)
npm run gate:required

# Required E2E only
npm run test:e2e:required
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run gate:required` to verify nothing is broken
4. Submit a pull request

### Pull Request Guidelines

- Keep the scope focused — one concern per PR
- Describe what changed and why in the PR description
- If adding a new feature, include test coverage where practical

### Code Style

- TypeScript with `strict` mode enabled
- Shared types live in `shared/` — both client and server import from there
- Server uses the repository pattern (`repositories/`) and provider pattern (`services/`)
- Follow existing patterns in the codebase rather than introducing new ones

## Project Structure

```
packages/
  client/    # React 19 + Vite 8 + Tailwind CSS 4 + Framer Motion
  server/    # Express + multi-agent SDKs + SQLite/PostgreSQL + WebSocket
  e2e/       # Playwright tests
shared/      # Shared TypeScript types and validation constants
```
