import type { AgentType } from '@/types';

export const AGENT_DISPLAY: Record<AgentType, { emoji: string; label: string }> = {
  copilot: { emoji: '🔵', label: 'Copilot' },
  claude: { emoji: '🟠', label: 'Claude' },
  codex: { emoji: '🟢', label: 'Codex' },
  opencode: { emoji: '🟣', label: 'OpenCode' },
};

/** Safe lookup — returns undefined for unknown agent types */
export function getAgentDisplay(agentType: string): { emoji: string; label: string } | undefined {
  return AGENT_DISPLAY[agentType as AgentType];
}
