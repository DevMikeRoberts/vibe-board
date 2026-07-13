import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Task, AgentStatus } from '@/types';
import type { TaskGroupWithChildren } from '@/lib/api';
import { AGENT_DISPLAY } from '@/lib/agent-config';
import { computeGroupStatus, statusIcon } from '@/lib/group-utils';
import { cn, formatDuration } from '@/lib/utils';
import { PixelIcon } from '@/components/PixelIcon';

interface GroupPanelProps {
  group: TaskGroupWithChildren | null;
  onClose: () => void;
  onRunGroup: (id: string) => void;
  onStopGroup: (id: string) => void;
  onRetryChild: (taskId: string) => void;
  onChildClick: (task: Task) => void;
}

function statusLabel(status: AgentStatus): string {
  switch (status) {
    case 'executing': return 'Running';
    case 'planning': return 'Planning';
    case 'complete': return 'Complete';
    case 'failed': return 'Failed';
    default: return 'Pending';
  }
}

export function GroupPanel({ group, onClose, onRunGroup, onStopGroup, onRetryChild, onChildClick }: GroupPanelProps) {
  const status = useMemo(() => group ? computeGroupStatus(group.children) : null, [group]);

  if (!group || !status) return null;

  const isRunning = status.executing > 0 || status.planning > 0;
  const pct = status.total > 0 ? (status.completed / status.total) * 100 : 0;
  const elapsed = group.startedAt ? Date.now() - group.startedAt : 0;

  return (
    <AnimatePresence>
      <motion.div
        key="group-panel"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 18, stiffness: 260, mass: 0.9 }}
        className="panel-neon fixed right-0 top-0 z-[60] flex h-full w-full max-w-md flex-col overflow-hidden rounded-l-[1.75rem] bg-background shadow-2xl"
        style={{ '--panel': 'var(--color-neon-purple)' } as React.CSSProperties}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b-2 border-[color-mix(in_oklab,var(--panel)_35%,transparent)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="sticker-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
              style={{ backgroundColor: 'var(--color-neon-purple)', color: 'var(--color-ink)' }}
            >
              <PixelIcon name="layer" className="h-5 w-5" />
            </div>
            <h2 className="truncate font-display text-lg leading-none text-foreground [text-transform:lowercase]">{group.title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            {!isRunning && status.idle > 0 && (
              <button
                onClick={() => onRunGroup(group.id)}
                className="sticker-sm sticker-press flex h-10 items-center gap-2 rounded-full px-4 font-display text-sm [text-transform:lowercase]"
                style={{ backgroundColor: 'var(--color-neon-green)', color: 'var(--color-ink)' }}
              >
                <PixelIcon name="flash" className="h-4 w-4" /> run
              </button>
            )}
            {isRunning && (
              <button
                onClick={() => onStopGroup(group.id)}
                className="sticker-sm sticker-press flex h-10 items-center gap-2 rounded-full bg-destructive px-4 font-display text-sm text-primary-foreground [text-transform:lowercase]"
              >
                <span aria-hidden="true" className="h-3 w-3 rounded-[3px] bg-current" /> stop all
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-border bg-card font-pixel text-sm text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
              aria-label="Close panel"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Progress summary */}
        <div className="border-b-2 border-[color-mix(in_oklab,var(--panel)_22%,transparent)] px-5 py-4">
          <div className="mb-2 flex items-center justify-between font-pixel text-[11px] text-muted-foreground">
            <span>{status.completed}/{status.total} complete</span>
            {isRunning && elapsed > 0 && (
              <span className="flex items-center gap-1.5 text-neon-blue">
                <PixelIcon name="clock" className="h-3.5 w-3.5" /> {formatDuration(elapsed)}
              </span>
            )}
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                status.failed > 0 && status.completed === 0 ? 'bg-destructive' :
                status.completed === status.total ? 'bg-neon-green' : 'bg-neon-blue',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5 font-pixel text-[10px] text-muted-foreground">
            {status.executing > 0 && <span className="flex items-center gap-1 text-neon-blue"><PixelIcon name="flash" className="h-3 w-3" /> {status.executing} running</span>}
            {status.planning > 0 && <span className="flex items-center gap-1 text-neon-purple"><PixelIcon name="light-bulb" className="h-3 w-3" /> {status.planning} planning</span>}
            {status.completed > 0 && <span className="flex items-center gap-1 text-neon-green"><PixelIcon name="rating-star-1" className="h-3 w-3" /> {status.completed} done</span>}
            {status.failed > 0 && <span className="flex items-center gap-1 text-destructive"><PixelIcon name="alert-triangle-1" className="h-3 w-3" /> {status.failed} failed</span>}
            {status.idle > 0 && <span className="flex items-center gap-1"><PixelIcon name="alarm-bell-sleep" className="h-3 w-3" /> {status.idle} pending</span>}
          </div>
          {group.description && (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{group.description}</p>
          )}
        </div>

        {/* Child task list */}
        <div className="flex-1 overflow-y-auto">
          {group.children.map((child, idx) => {
            const agentDisplay = AGENT_DISPLAY[child.agentType as keyof typeof AGENT_DISPLAY];
            const duration = child.completedAt && child.startedAt
              ? formatDuration(child.completedAt - child.startedAt) : null;
            const elapsed = child.startedAt && !child.completedAt
              ? formatDuration(Date.now() - child.startedAt) : null;

            return (
              <div
                key={child.id}
                className={cn(
                  'group flex cursor-pointer items-center gap-3.5 border-b-2 border-[color-mix(in_oklab,var(--panel)_14%,transparent)] px-5 py-4 transition-colors hover:bg-[color-mix(in_oklab,var(--panel)_12%,transparent)]',
                  child.agentStatus === 'executing' && 'bg-[color-mix(in_oklab,var(--color-neon-blue)_8%,transparent)]',
                  child.agentStatus === 'failed' && 'bg-[color-mix(in_oklab,var(--color-destructive)_8%,transparent)]',
                )}
                onClick={() => onChildClick(child)}
              >
                {/* Order number */}
                <span className="w-5 text-right font-pixel text-[11px] text-muted-foreground">{idx + 1}</span>

                {/* Status icon */}
                {statusIcon(child.agentStatus)}

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-base font-bold leading-snug tracking-tight text-foreground">{child.title}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-pixel text-[10px] text-muted-foreground">
                    <span>{agentDisplay?.emoji} {agentDisplay?.label}</span>
                    <span>· {statusLabel(child.agentStatus)}</span>
                    {duration && <span>· {duration}</span>}
                    {elapsed && <span className="text-neon-blue">· {elapsed}</span>}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  {child.agentStatus === 'failed' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onRetryChild(child.id); }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-neon-yellow"
                      title="Retry"
                    >
                      <PixelIcon name="recycle" className="h-4 w-4" />
                    </button>
                  )}
                  <span aria-hidden="true" className="font-pixel text-sm text-muted-foreground transition-colors group-hover:text-foreground">›</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer info */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t-2 border-[color-mix(in_oklab,var(--panel)_35%,transparent)] px-5 py-3 font-pixel text-[10px] text-muted-foreground">
          {group.repoPath && (
            <span className="flex items-center gap-1.5">
              <PixelIcon name="global-public" className="h-3.5 w-3.5" /> {group.repoPath}
            </span>
          )}
          {group.baseBranch && (
            <span className="flex items-center gap-1.5">
              <PixelIcon name="flag" className="h-3.5 w-3.5" /> {group.baseBranch}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <PixelIcon name="hierarchy-2" className="h-3.5 w-3.5" /> concurrency {group.maxConcurrency}
          </span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
