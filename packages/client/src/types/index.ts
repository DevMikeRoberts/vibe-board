// Re-export all types and constants from the shared module
export type {
  Priority,
  ColumnId,
  AgentStatus,
  Task,
  AgentEventType,
  AgentEvent,
  Column,
  WSMessage,
} from '../../../../shared/types.ts';

export { VALID_TRANSITIONS } from '../../../../shared/constants.ts';
