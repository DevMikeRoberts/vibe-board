export const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
export const VALID_COLUMNS = ['backlog', 'in-progress', 'review', 'done'];
export const VALID_AGENT_STATUSES = ['idle', 'planning', 'executing', 'complete', 'failed'];
export const VALID_AGENT_TYPES = ['copilot', 'claude', 'codex', 'opencode'];
/** Allowed column transitions. Key = current column, value = columns you can move to. */
export const VALID_TRANSITIONS = {
    'backlog': ['in-progress'],
    'in-progress': ['backlog', 'review'],
    'review': ['done', 'in-progress'],
    'done': ['in-progress'],
};
export function isValidPriority(value) {
    return typeof value === 'string' && VALID_PRIORITIES.includes(value);
}
export function isValidColumnId(value) {
    return typeof value === 'string' && VALID_COLUMNS.includes(value);
}
export function isValidAgentStatus(value) {
    return typeof value === 'string' && VALID_AGENT_STATUSES.includes(value);
}
export function isValidAgentType(value) {
    return typeof value === 'string' && VALID_AGENT_TYPES.includes(value);
}
export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 5000;
export const MAX_GROUP_CHILDREN = 20;
export const MIN_GROUP_CHILDREN = 2;
export function isValidMaxConcurrency(value, childCount) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= childCount;
}
