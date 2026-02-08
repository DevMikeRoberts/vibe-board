import type { ColumnId, Priority, AgentStatus } from './types.ts';
export declare const VALID_PRIORITIES: readonly Priority[];
export declare const VALID_COLUMNS: readonly ColumnId[];
export declare const VALID_AGENT_STATUSES: readonly AgentStatus[];
/** Allowed column transitions. Key = current column, value = columns you can move to. */
export declare const VALID_TRANSITIONS: Record<ColumnId, readonly ColumnId[]>;
export declare function isValidPriority(value: unknown): value is Priority;
export declare function isValidColumnId(value: unknown): value is ColumnId;
export declare function isValidAgentStatus(value: unknown): value is AgentStatus;
