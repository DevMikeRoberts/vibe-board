# Subscription Model Plan

## Core Principle

Gate features that scale with **team size**, **usage volume**, or **advanced workflows** — while keeping the solo developer experience compelling enough to get hooked.

---

## Free Tier — Solo Developer

Everything the app does today: single board, all 4 agents, drag-and-drop, priority, sorting, filters, retry. Enough to be genuinely useful.

**Limits:**
- 1 board / workspace
- 3 concurrent agent runs
- 7-day event history (auto-purge older logs)
- Community agents only (Copilot, Claude, Codex, OpenCode)

---

## Pro Tier — Power User / Small Team

| Feature | Why it's worth paying for |
|---------|--------------------------|
| **Multiple boards/workspaces** | Separate boards per project (frontend, backend, infra) |
| **Agent duration dashboard** | Cost visibility — "Claude spent 47 min this week" drives ROI decisions |
| **Unlimited event history + export** | Full audit trail, downloadable logs for compliance/debugging |
| **Project presets** (template pivot) | Save WorktreeDialog config per repo — time saver for multi-project devs |
| **"Done" → Reopen transition** | Iterate on completed work without recreating tasks |
| **Keyboard shortcuts** | Power user velocity — these users are the ones who pay |
| **Custom agent models** | Override model per task (e.g., use Opus for complex, Haiku for simple) |
| **Webhook notifications** | Slack/Discord/email when agent completes or fails |

---

## Team Tier — Organizations

| Feature | Why it's worth paying for |
|---------|--------------------------|
| **Multi-user with roles** | Shared board, assign tasks to team members, RBAC |
| **Task dependencies** | Complex workflows: "deploy after tests pass" |
| **Agent queue/orchestration** | Batch 20 tasks, run sequentially, get a report |
| **Shared project presets** | Team-wide repo configs, not per-user localStorage |
| **Usage analytics** | Who ran what, how much time/cost per person, per project |
| **SSO / SAML** | Enterprise auth requirement |
| **Audit log** | Who changed what, when — compliance requirement |
| **API access** | Integrate with CI/CD, create tasks programmatically |
| **Priority support** | SLA on response time |

---

## Features to Keep Free (Never Gate)

- Agent selection (all 4 agents) — this is the hook
- Priority, sorting, filters — basic UX shouldn't be paywalled
- Drag-and-drop, retry — core functionality
- Single board with unlimited tasks — let users go deep before upgrading

---

## Build Order for Subscription Readiness

Priority order — each step unlocks the next:

1. **Multi-user auth + boards** — hard prerequisite for any paid tier
2. **Usage tracking/limits** — need metering before you can enforce limits
3. **Agent duration dashboard** — immediate visible value, easy upsell trigger
4. **Webhook notifications** — low effort, high perceived value
5. **Export event log** — already have the data, just need a button
6. **Project presets in WorktreeDialog** — pivot existing template backend
7. **Task dependencies** — unlock Team tier workflows
8. **Agent queue/orchestration** — batch runs for power users and teams

---

## Open Source + Commercial Strategy

### Recommended: Open Core Model

Public repo (MIT) contains the free tier. Private repo extends it with pro/team features.

```
copilot-kanban-agent/          ← Public repo (MIT)
  packages/client/
  packages/server/
  shared/

copilot-kanban-pro/            ← Private repo (commercial)
  packages/pro-server/         ← Extends server (auth, webhooks, analytics)
  packages/pro-client/         ← Pro UI components (dashboard, SSO)
  shared/pro-types/
```

### How the Repos Connect

The private repo **consumes** the public repo as a dependency — it does NOT fork it.

```
copilot-kanban-pro/package.json:
  "dependencies": {
    "copilot-kanban-agent": "github:DanWahlin/copilot-kanban-agent"
  }
```

The public repo exposes **plugin hooks** (registration functions, component slots) that the pro package uses. The public repo never imports from or knows about the private one.

### How Sync Works in Practice

**Key insight: there's no bidirectional sync.** The relationship is one-way:

```
Public repo (upstream) → Private repo (downstream consumer)
     ↑                         |
Community PRs              Depends on public
go here                    via npm/git dependency
```

1. **Community PRs** land in the public repo normally
2. **Private repo** pins to a version/tag of the public repo
3. When public repo releases a new version, private repo updates its dependency (like any npm update)
4. **Pro features** are developed entirely in the private repo — they never touch the public one
5. **CI in private repo** runs tests against the latest public repo to catch breaking changes early

### What Companies Actually Do This?

Yes, many — it's the dominant model for VC-backed open source:

| Company | Public Repo | Private/Commercial | License |
|---------|------------|-------------------|---------|
| **GitLab** | gitlab-ce (Community) | gitlab-ee (Enterprise) | MIT + proprietary |
| **Sentry** | sentry (self-host) | SaaS features | BSL |
| **Cal.com** | cal.com | Enterprise features | AGPLv3 + commercial |
| **Supabase** | supabase | Cloud platform features | Apache 2.0 + proprietary |
| **Ghost** | Ghost (core) | Ghost(Pro) hosting | MIT + commercial |
| **n8n** | n8n (workflow engine) | n8n.cloud features | Sustainable Use License |
| **Metabase** | metabase (core) | Enterprise features | AGPL + commercial |

### GitLab's Approach (Most Relevant to Us)

GitLab pioneered the cleanest version of this. They used to literally have two repos (CE and EE) and merge CE into EE on every release. They eventually **merged into one repo** with feature flags because the two-repo sync was painful.

Their current approach: **single repo, dual license**. All code is visible, but EE features are behind license checks. This eliminates the sync problem entirely.

### Practical Recommendation for This Project

**Start with two repos** (simpler to set up, clearer separation):

1. Public repo stays as-is
2. Private repo is a thin wrapper that:
   - Installs the public package
   - Adds pro middleware, routes, and components
   - Builds a single Docker image that includes everything
3. Use **semantic versioning** on the public repo — private repo pins to `^major.minor`
4. Private repo CI runs `npm update copilot-kanban-agent && npm test` nightly to catch breaks

**Migrate to single repo later** if the sync overhead becomes too much (GitLab's lesson). At that point, move to a monorepo with a `packages/pro/` directory and license-gated feature flags.

### Plugin Architecture in the Public Repo

To make this work, add lightweight extension points now:

```typescript
// packages/server/src/plugins.ts
type Plugin = { routes?: Router; middleware?: RequestHandler[] };
const plugins: Plugin[] = [];
export function registerPlugin(plugin: Plugin) { plugins.push(plugin); }
export function getPlugins() { return plugins; }
```

```typescript
// packages/server/src/index.ts
for (const plugin of getPlugins()) {
  if (plugin.middleware) plugin.middleware.forEach(m => app.use(m));
  if (plugin.routes) app.use('/api', plugin.routes);
}
```

The pro package calls `registerPlugin()` at startup. The public repo works fine without any plugins registered.
