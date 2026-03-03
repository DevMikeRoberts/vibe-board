# Security Policy

## About This Project

Agentic AI Kanban Board is a **local development tool** that orchestrates AI coding agents on your machine. It is designed to run on `localhost` and is not intended to be exposed to the public internet.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Use [GitHub's private vulnerability reporting](https://github.com/YOUR_USERNAME/agentic-ai-kanban-board/security/advisories/new) to submit a report
3. Include steps to reproduce the issue and any relevant details

You should receive an initial response within 72 hours.

## Scope

Security concerns relevant to this project include:

- Command injection via task fields passed to agent SDKs or git commands
- Path traversal bypassing `ALLOWED_REPO_ROOTS` restrictions
- Cross-site scripting (XSS) in rendered agent output
- Unauthorized access to the API or WebSocket when running on a network

Out of scope:

- Vulnerabilities in upstream agent SDKs (report those to their respective maintainers)
- Issues that require physical access to the machine running the tool
