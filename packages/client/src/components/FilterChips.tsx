import type { AgentType, AgentStatus } from '@/types';
import { AGENT_DISPLAY } from '@/lib/agent-config';
import { PixelIcon } from './PixelIcon';
import { cn } from '@/lib/utils';

export type StatusFilter = 'running' | 'failed' | 'complete';

const STATUS_CHIPS: { value: StatusFilter; label: string; hue: string }[] = [
  { value: 'running', label: 'running', hue: 'var(--color-neon-blue)' },
  { value: 'failed', label: 'failed', hue: 'var(--color-destructive)' },
  { value: 'complete', label: 'complete', hue: 'var(--color-neon-green)' },
];

const AGENT_CHIPS: { value: AgentType; label: string }[] = (
  Object.entries(AGENT_DISPLAY) as [AgentType, { emoji: string; label: string }][]
).map(([value, { label }]) => ({ value, label }));

/** Map StatusFilter to actual AgentStatus values */
export function statusFilterToStatuses(filter: StatusFilter): AgentStatus[] {
  switch (filter) {
    case 'running': return ['planning', 'executing'];
    case 'failed': return ['failed'];
    case 'complete': return ['complete'];
  }
}

interface FilterChipsProps {
  activeAgentTypes: AgentType[];
  activeStatuses: StatusFilter[];
  onToggleAgentType: (agentType: AgentType) => void;
  onToggleStatus: (status: StatusFilter) => void;
  onClear: () => void;
}

const chipBase =
  'rounded-full border-2 px-3 py-1.5 font-pixel text-[10px] leading-none transition-all';
const chipIdle =
  'border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground';

export function FilterChips({ activeAgentTypes, activeStatuses, onToggleAgentType, onToggleStatus, onClear }: FilterChipsProps) {
  const hasActiveFilters = activeAgentTypes.length > 0 || activeStatuses.length > 0;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Agent type chips */}
      {AGENT_CHIPS.map((chip) => {
        const active = activeAgentTypes.includes(chip.value);
        return (
          <button
            key={chip.value}
            onClick={() => onToggleAgentType(chip.value)}
            className={cn(
              chipBase,
              'flex items-center gap-1.5',
              active ? 'sticker-sm border-ink' : chipIdle
            )}
            style={active ? { backgroundColor: 'var(--color-neon-pink)', color: 'var(--color-ink)' } : undefined}
          >
            <PixelIcon name="chipset" className="h-3 w-3" />
            {chip.label}
          </button>
        );
      })}

      <span className="mx-0.5 h-5 w-0.5 rounded bg-border" />

      {/* Status chips */}
      {STATUS_CHIPS.map((chip) => {
        const active = activeStatuses.includes(chip.value);
        return (
          <button
            key={chip.value}
            onClick={() => onToggleStatus(chip.value)}
            className={cn(chipBase, active ? 'sticker-sm border-ink' : chipIdle)}
            style={active ? { backgroundColor: chip.hue, color: 'var(--color-ink)' } : undefined}
          >
            {chip.label}
          </button>
        );
      })}

      {/* Clear button */}
      {hasActiveFilters && (
        <button
          onClick={onClear}
          className={cn(chipBase, chipIdle, 'flex items-center gap-1.5 ml-1')}
        >
          <PixelIcon name="recycle" className="h-3 w-3" />
          clear
        </button>
      )}
    </div>
  );
}
