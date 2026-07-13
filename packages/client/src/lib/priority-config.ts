import type { Priority } from '@/types';

export const PRIORITY_DISPLAY: Record<Priority, { label: string; emoji: string; color: string; borderClass: string; accent: string }> = {
  critical: { label: 'Critical', emoji: '🔥', color: 'text-neon-pink',   borderClass: 'border-l-4 border-l-neon-pink',   accent: 'var(--color-neon-pink)' },
  high:     { label: 'High',     emoji: '⚡', color: 'text-neon-yellow', borderClass: 'border-l-4 border-l-neon-yellow', accent: 'var(--color-neon-yellow)' },
  medium:   { label: 'Medium',   emoji: '💠', color: 'text-neon-blue',   borderClass: '',                                accent: '' },
  low:      { label: 'Low',      emoji: '🫧', color: 'text-muted-foreground', borderClass: 'border-l-4 border-l-muted-foreground', accent: 'color-mix(in srgb, var(--color-muted-foreground) 60%, transparent)' },
};

/** Weight for sorting — lower = higher priority */
export const PRIORITY_WEIGHT: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Dropdown-friendly array derived from PRIORITY_DISPLAY */
export const PRIORITY_OPTIONS: { value: Priority; label: string; emoji: string }[] = (
  Object.entries(PRIORITY_DISPLAY) as [Priority, { emoji: string; label: string }][]
).map(([value, { emoji, label }]) => ({ value, label, emoji }));

/** Safe lookup — returns undefined for unknown priorities */
export function getPriorityDisplay(priority: string): { label: string; emoji: string; color: string; borderClass: string; accent: string } | undefined {
  return PRIORITY_DISPLAY[priority as Priority];
}
