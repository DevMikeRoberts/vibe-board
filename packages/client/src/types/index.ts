// Re-export all types and constants from the shared module
export type {
  Priority,
  ColumnId,
  AgentStatus,
  AgentType,
  AgentInfo,
  Task,
  AgentEventType,
  AgentEvent,
  Column,
  WSMessage,
} from '../../../../shared/types.js';

export { VALID_TRANSITIONS } from '../../../../shared/constants.js';
