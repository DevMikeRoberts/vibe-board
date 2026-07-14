import { useMemo } from 'react';
import type { TaskGroupWithChildren } from '@/lib/api';
import { AGENT_DISPLAY } from '@/lib/agent-config';
import { PRIORITY_DISPLAY } from '@/lib/priority-config';
import { computeGroupStatus, statusIcon } from '@/lib/group-utils';
import { PixelIcon } from './PixelIcon';
import { cn } from '@/lib/utils';

interface TaskGroupCardProps {
  group: TaskGroupWithChildren;
  onClickGroup: (group: TaskGroupWithChildren) => void;
  onRunGroup: (id: string) => void;
  onStopGroup: (id: string) => void;
  onDeleteGroup: (id: string) => void;
  onEditGroup?: (group: TaskGroupWithChildren) => void;
}

export function TaskGroupCard({ group, onClickGroup, onRunGroup, onStopGroup, onDeleteGroup, onEditGroup }: TaskGroupCardProps) {
  const status = useMemo(() => computeGroupStatus(group.children), [group.children]);
  const isRunning = status.executing > 0 || status.planning > 0;
  const pct = status.total > 0 ? ((status.completed / status.total) * 100) : 0;
  const allDone = status.completed === status.total && status.total > 0;
  const failing = status.failed > 0 && status.completed === 0;
  const priorityInfo = PRIORITY_DISPLAY[group.priority];

  const agentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of group.children) {
      const type = c.agentType || 'copilot';
      counts.set(type, (counts.get(type) || 0) + 1);
    }
    return [...counts.entries()];
  }, [group.children]);

  return (
    <div
      className={cn(
        'sticker sticker-peel group relative cursor-pointer rounded-2xl border-2 border-ink bg-card max-md:p-3 md:p-3 lg:p-4',
        isRunning && 'border-b-[6px] border-b-neon-blue',
      )}
      onClick={() => onClickGroup(group)}
    >
      {/* Priority edge */}
      {priorityInfo?.accent && (
        <span
          aria-hidden="true"
          className="absolute -left-0.5 bottom-4 top-4 w-1.5 rounded-r-full"
          style={{ backgroundColor: priorityInfo.accent }}
        />
      )}

      {/* Header */}
      <div className="relative mb-2.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <PixelIcon name="layer" className="h-5 w-5 shrink-0 text-neon-purple" />
          <h3 className="font-display text-base leading-none text-foreground line-clamp-1 [text-transform:lowercase]">{group.title}</h3>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-100 md:opacity-0 transition-opacity md:group-hover:opacity-100" onPointerDown={(e) => e.stopPropagation()}>
          {!isRunning && status.idle > 0 && group.columnId !== 'done' && (
            <button
              onClick={(e) => { e.stopPropagation(); onRunGroup(group.id); }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-neon-green"
              title="Run group"
            >
              <PixelIcon name="flash" className="h-3.5 w-3.5" />
            </button>
          )}
          {isRunning && (
            <button
              onClick={(e) => { e.stopPropagation(); onStopGroup(group.id); }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
              title="Stop all"
            >
              <span className="block h-3 w-3 bg-current" aria-hidden="true" />
            </button>
          )}
          {onEditGroup && (
            <button
              onClick={(e) => { e.stopPropagation(); onEditGroup(group); }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Edit group"
            >
              <PixelIcon name="quill-ink" className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteGroup(group.id); }}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
            title="Delete group"
          >
            <PixelIcon name="bin" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="relative mb-3">
        <div className="mb-1.5 flex items-center justify-between font-pixel text-[10px]">
          <span className="text-muted-foreground">{status.completed}/{status.total} complete</span>
          {status.failed > 0 && <span className="text-destructive">{status.failed} failed</span>}
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700',
              failing ? 'bg-destructive' : allDone ? 'bg-neon-green' : 'bg-neon-blue',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Agent breakdown */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {agentCounts.map(([type, count]) => {
          const display = AGENT_DISPLAY[type as keyof typeof AGENT_DISPLAY];
          return (
            <span
              key={type}
              className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 font-pixel text-[10px] text-accent-foreground"
            >
              <PixelIcon name="chipset" className="h-3 w-3" />
              {display?.label} ({count})
            </span>
          );
        })}
      </div>

      {/* Status summary */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-pixel text-[10px] text-muted-foreground">
        {status.executing > 0 && <span className="flex items-center gap-1 text-neon-blue">{statusIcon('executing', 'h-3 w-3')} {status.executing} running</span>}
        {status.planning  > 0 && <span className="flex items-center gap-1 text-neon-purple">{statusIcon('planning',  'h-3 w-3')} {status.planning} planning</span>}
        {status.completed > 0 && <span className="flex items-center gap-1 text-neon-green">{statusIcon('complete',  'h-3 w-3')} {status.completed} done</span>}
        {status.failed    > 0 && <span className="flex items-center gap-1 text-destructive">{statusIcon('failed',    'h-3 w-3')} {status.failed} failed</span>}
        {status.idle      > 0 && <span className="text-muted-foreground/60">{status.idle} pending</span>}
      </div>

      {/* Child tasks */}
      {group.children.length > 0 && (
        <div className="mt-3 border-t-2 border-border pt-2.5 space-y-1.5">
          {group.children.map((child) => {
            const agentDisplay = AGENT_DISPLAY[child.agentType as keyof typeof AGENT_DISPLAY];
            const prio = PRIORITY_DISPLAY[child.priority];
            return (
              <div
                key={child.id}
                className={cn('rounded-xl border-2 border-border bg-accent px-2.5 py-2', prio?.borderClass)}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-xs font-semibold leading-snug text-foreground line-clamp-1">
                    {prio && <span className="mr-0.5">{prio.emoji}</span>}
                    {child.title}
                  </h4>
                  {statusIcon(child.agentStatus, 'h-3 w-3')}
                </div>
                {child.description && (
                  <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground/70 line-clamp-1">{child.description}</p>
                )}
                {agentDisplay && (
                  <span className="mt-1 inline-flex items-center gap-1 font-pixel text-[10px] text-muted-foreground">
                    <PixelIcon name="chipset" className="h-3 w-3" />
                    {agentDisplay.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
