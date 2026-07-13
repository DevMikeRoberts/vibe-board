import type { AgentType } from '../types.js';

/**
 * Cost / locality tier for an agent, used to prefer free or local models when a
 * task has to fall back. Ordered cheapest-and-safest first:
 *
 *  - `local`        — runs on your own hardware at no cost (e.g. OpenCode driving
 *                     a local Ollama model). Can never be "out of credits".
 *  - `subscription` — flat-rate plan, usually still usable when metered API
 *                     budgets are exhausted (Copilot, Hermes, OpenClaw).
 *  - `metered`      — pay-per-token API that can run out of credits (Claude, Codex).
 */
export type AgentTier = 'local' | 'subscription' | 'metered';

/**
 * Tier for each known agent. OpenCode can be pointed at a local Ollama model —
 * free, and immune to credit exhaustion — so it is the preferred safety net
 * when a paid agent is unavailable. See the README ("Agent availability
 * fallback") for how to wire OpenCode to Ollama on an always-on host.
 */
export const AGENT_TIERS: Record<AgentType, AgentTier> = {
  opencode: 'local',
  copilot: 'subscription',
  hermes: 'subscription',
  openclaw: 'subscription',
  claude: 'metered',
  codex: 'metered',
};

const TIER_RANK: Record<AgentTier, number> = { local: 0, subscription: 1, metered: 2 };

/** Stable tie-breaker within a tier (lower index = tried first). */
const STABLE_ORDER: readonly AgentType[] = ['opencode', 'copilot', 'hermes', 'openclaw', 'claude', 'codex'];

/** Environment variable an operator can set to pin a preferred fallback agent. */
export const FALLBACK_AGENT_ENV = 'AGENTBOARD_FALLBACK_AGENT';

/**
 * Minimal availability shape the resolver needs. Structurally compatible with
 * the SDK's `AgentInfo`, so `AgentManager.availableAgents` can be passed in
 * directly.
 */
export interface AgentAvailability {
  name: AgentType;
  displayName?: string;
  available: boolean;
  reason?: string;
}

export interface ResolveAgentInput {
  /** The agent the task asked for. */
  requested: AgentType;
  /** Availability snapshot for every known agent. */
  agents: readonly AgentAvailability[];
  /**
   * Optional explicit fallback preference (e.g. from {@link FALLBACK_AGENT_ENV}).
   * Used first when the requested agent is down and this one is available.
   */
  preferredFallback?: AgentType;
}

export interface AgentSelection {
  /** Agent that should run, or `null` when nothing is available. */
  agentType: AgentType | null;
  /** The originally requested agent. */
  requested: AgentType;
  /** True when the resolved agent differs from the requested one. */
  fellBack: boolean;
  /** Human-readable explanation of the decision (surfaced in the task event log). */
  reason?: string;
}

function label(agents: readonly AgentAvailability[], type: AgentType): string {
  return agents.find(a => a.name === type)?.displayName || type;
}

/** Sort key: lower tier first, then stable order within the tier. */
function rank(name: AgentType): [number, number] {
  return [TIER_RANK[AGENT_TIERS[name]], STABLE_ORDER.indexOf(name)];
}

function tierNote(tier: AgentTier): string {
  switch (tier) {
    case 'local':
      return 'free/local model';
    case 'subscription':
      return 'flat-rate subscription agent';
    case 'metered':
      return 'metered API agent';
  }
}

/**
 * Decide which agent should actually pick up a task. Returns the requested
 * agent when it is available; otherwise selects the best available fallback,
 * preferring a free/local model (lowest tier). Returns `agentType: null` when
 * nothing is available so the caller can fail the task with a clear reason.
 *
 * This is a pure function — it does not start anything — so it is easy to unit
 * test and reuse.
 */
export function resolveAgentSelection(input: ResolveAgentInput): AgentSelection {
  const { requested, agents, preferredFallback } = input;

  const requestedInfo = agents.find(a => a.name === requested);
  if (requestedInfo?.available) {
    return { agentType: requested, requested, fellBack: false };
  }

  const requestedReason = requestedInfo?.reason || 'not installed or not authenticated';

  const candidates = agents
    .filter(a => a.available && a.name !== requested)
    .map(a => a.name);

  if (candidates.length === 0) {
    return {
      agentType: null,
      requested,
      fellBack: false,
      reason: `Agent "${label(agents, requested)}" is unavailable (${requestedReason}) and no other agent is available to fall back to. Install/authenticate an agent, or run a local model via OpenCode + Ollama.`,
    };
  }

  // Prefer an explicit, available preference; otherwise pick the lowest tier
  // (free/local first), tie-broken by a stable order.
  let chosen: AgentType;
  if (preferredFallback && preferredFallback !== requested && candidates.includes(preferredFallback)) {
    chosen = preferredFallback;
  } else {
    chosen = [...candidates].sort((a, b) => {
      const [ta, sa] = rank(a);
      const [tb, sb] = rank(b);
      return ta - tb || sa - sb;
    })[0];
  }

  return {
    agentType: chosen,
    requested,
    fellBack: true,
    reason: `Requested agent "${label(agents, requested)}" is unavailable (${requestedReason}); falling back to "${label(agents, chosen)}" (${tierNote(AGENT_TIERS[chosen])}).`,
  };
}

/**
 * Read the operator's preferred fallback agent from the environment. Returns
 * `undefined` when unset or invalid, in which case tier ranking decides.
 */
export function getConfiguredFallbackAgent(env: NodeJS.ProcessEnv = process.env): AgentType | undefined {
  const raw = env[FALLBACK_AGENT_ENV]?.trim().toLowerCase();
  if (!raw) return undefined;
  return (Object.keys(AGENT_TIERS) as AgentType[]).find(name => name === raw);
}
