# Dozer History

## Seed Context

- Project: ai-agent-board.
- Production notes live in `AGENTS.md`.
- Production uses systemd services for server and client and PostgreSQL via Docker.
- Kubernetes manifests live in `k8s/`.
- User: Copilot.

## Learnings

- Existing build commands are `npm run build:client` and `npm run build:server`.
- Do not add deployment tooling unless it is already part of the repo or explicitly requested.
- 2026-05-07T16:38:29.692-07:00 local dev: Windows optional native npm packages may need repair after install (`@rollup/rollup-win32-x64-msvc`, `lightningcss-win32-x64-msvc`, `@tailwindcss/oxide-win32-x64-msvc`), and shared workspace artifacts require `npx tsc -b .\shared\tsconfig.json` before the server can import `@ai-agent-board/shared`.
- 2026-05-07T16:38:29.692-07:00 local dev: the checked-in Vite/server config defaults to 8081/8080, but this session launched experimental servers on documented ports with `PORT=3001` for server and `API_URL=http://localhost:3001 npm run dev -w @ai-agent-board/client -- --port 4175 --host 0.0.0.0` for client.
- 2026-05-08T06:01:23.732-07:00 local dev: detached PowerShell starts should set process environment with `[Environment]::SetEnvironmentVariable(...)`; `$env:...` assignments can be stripped by the detach wrapper before npm starts.
- 2026-05-08T12:19:35.686-07:00 gates: use `npm run gate:required` as the deterministic local/CI gate; it builds client and server, then runs required Playwright E2E without discretionary skips.
