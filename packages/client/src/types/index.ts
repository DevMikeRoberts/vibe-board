// Re-export all types and constants from the shared module
export type {
  Priority,
  ColumnId,
  AgentStatus,
  AgentType,
  ReviewStatus,
  AgentInfo,
  Project,
  ProjectTaskCounts,
  ProjectConfig,
  ProjectPathValidation,
  CreateProjectRequest,
  UpdateProjectRequest,
  Task,
  TaskAttachment,
  TaskGroup,
  TaskTemplate,
  AgentEventType,
  AgentEvent,
  Column,
  WSMessage,
} from '../../../../shared/types.js';

export { VALID_TRANSITIONS, MAX_GROUP_CHILDREN, MIN_GROUP_CHILDREN } from '../../../../shared/constants.js';
