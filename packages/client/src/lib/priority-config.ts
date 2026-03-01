import type { Priority } from '@/types';

export const PRIORITY_DISPLAY: Record<Priority, { label: string; emoji: string; color: string; borderClass: string }> = {
  critical: { label: 'Critical', emoji: '🔴', color: 'text-red-500', borderClass: 'border-l-4 border-l-red-500' },
  high:     { label: 'High',     emoji: '🟠', color: 'text-amber-500', borderClass: 'border-l-4 border-l-amber-500' },
  medium:   { label: 'Medium',   emoji: '🔵', color: 'text-blue-500', borderClass: '' },
  low:      { label: 'Low',      emoji: '⚪', color: 'text-slate-400', borderClass: 'border-l-4 border-l-slate-400' },
};

/** Weight for sorting — lower = higher priority */
export const PRIORITY_WEIGHT: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Safe lookup — returns undefined for unknown priorities */
export function getPriorityDisplay(priority: string): { label: string; emoji: string; color: string; borderClass: string } | undefined {
  return PRIORITY_DISPLAY[priority as Priority];
}
