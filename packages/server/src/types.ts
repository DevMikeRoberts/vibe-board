// Re-export all types and validation utilities from the shared module
export type {
  Priority,
  ColumnId,
  AgentStatus,
  Task,
  AgentEventType,
  AgentEvent,
  WSMessage,
} from '../../../shared/types.js';

export {
  VALID_PRIORITIES,
  VALID_COLUMNS,
  VALID_AGENT_STATUSES,
  VALID_TRANSITIONS,
  isValidPriority,
  isValidColumnId,
  isValidAgentStatus,
} from '../../../shared/constants.js';
