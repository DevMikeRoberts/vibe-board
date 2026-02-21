import type { ColumnId, Priority, AgentStatus, AgentType } from './types.js';
export declare const VALID_PRIORITIES: readonly Priority[];
export declare const VALID_COLUMNS: readonly ColumnId[];
export declare const VALID_AGENT_STATUSES: readonly AgentStatus[];
export declare const VALID_AGENT_TYPES: readonly AgentType[];
/** Allowed column transitions. Key = current column, value = columns you can move to. */
export declare const VALID_TRANSITIONS: Record<ColumnId, readonly ColumnId[]>;
export declare function isValidPriority(value: unknown): value is Priority;
export declare function isValidColumnId(value: unknown): value is ColumnId;
export declare function isValidAgentStatus(value: unknown): value is AgentStatus;
export declare function isValidAgentType(value: unknown): value is AgentType;
export declare const MAX_TITLE_LENGTH = 200;
export declare const MAX_DESCRIPTION_LENGTH = 5000;
//# sourceMappingURL=constants.d.ts.map