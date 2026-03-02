import { useMemo } from 'react';
import { Layers, Play, Square, Trash2, CheckCircle2, AlertCircle, Cog, Brain } from 'lucide-react';
import type { Task, AgentStatus } from '@/types';
import type { TaskGroupWithChildren } from '@/lib/api';
import { AGENT_DISPLAY } from '@/lib/agent-config';
import { PRIORITY_DISPLAY } from '@/lib/priority-config';
import { cn } from '@/lib/utils';

interface TaskGroupCardProps {
  group: TaskGroupWithChildren;
  onClickGroup: (group: TaskGroupWithChildren) => void;
  onRunGroup: (id: string) => void;
  onStopGroup: (id: string) => void;
  onDeleteGroup: (id: string) => void;
}

interface GroupStatus {
  total: number;
  completed: number;
  failed: number;
  executing: number;
  planning: number;
  idle: number;
}

function computeStatus(children: Task[]): GroupStatus {
  const s: GroupStatus = { total: children.length, completed: 0, failed: 0, executing: 0, planning: 0, idle: 0 };
  for (const c of children) {
    if (c.agentStatus === 'complete') s.completed++;
    else if (c.agentStatus === 'failed') s.failed++;
    else if (c.agentStatus === 'executing') s.executing++;
    else if (c.agentStatus === 'planning') s.planning++;
    else s.idle++;
  }
  return s;
}

function statusIcon(status: AgentStatus) {
  switch (status) {
    case 'executing': return <Cog className="h-3 w-3 animate-spin text-blue-400" />;
    case 'planning': return <Brain className="h-3 w-3 animate-pulse text-purple-400" />;
    case 'complete': return <CheckCircle2 className="h-3 w-3 text-emerald-400" />;
    case 'failed': return <AlertCircle className="h-3 w-3 text-red-400" />;
    default: return <div className="h-3 w-3 rounded-full border border-zinc-500" />;
  }
}

export function TaskGroupCard({ group, onClickGroup, onRunGroup, onStopGroup, onDeleteGroup }: TaskGroupCardProps) {
  const status = useMemo(() => computeStatus(group.children), [group.children]);
  const isRunning = status.executing > 0 || status.planning > 0;
  const pct = status.total > 0 ? ((status.completed / status.total) * 100) : 0;
  const priorityInfo = PRIORITY_DISPLAY[group.priority];

  // Agent breakdown
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
        'group relative cursor-pointer rounded-lg border bg-zinc-800/80 p-3 transition-all hover:border-zinc-500 hover:shadow-lg',
        priorityInfo?.borderClass || 'border-zinc-700',
        isRunning && 'border-b-2 border-b-blue-500',
      )}
      onClick={() => onClickGroup(group)}
    >
      {/* Header row */}
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-medium text-zinc-100 line-clamp-1">{group.title}</h3>
        </div>
        {/* Action buttons (visible on hover) */}
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {!isRunning && status.idle > 0 && group.columnId !== 'done' && (
            <button
              onClick={(e) => { e.stopPropagation(); onRunGroup(group.id); }}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-emerald-400"
              title="Run group"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {isRunning && (
            <button
              onClick={(e) => { e.stopPropagation(); onStopGroup(group.id); }}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-red-400"
              title="Stop all"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteGroup(group.id); }}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-red-400"
            title="Delete group"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
          <span>{status.completed}/{status.total} complete</span>
          {status.failed > 0 && <span className="text-red-400">{status.failed} failed</span>}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-700">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              status.failed > 0 && status.completed === 0 ? 'bg-red-500' :
              status.completed === status.total ? 'bg-emerald-500' : 'bg-blue-500',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Agent breakdown */}
      <div className="mb-2 flex flex-wrap gap-2">
        {agentCounts.map(([type, count]) => {
          const display = AGENT_DISPLAY[type as keyof typeof AGENT_DISPLAY];
          return (
            <span key={type} className="flex items-center gap-1 text-xs text-zinc-400">
              <span>{display?.emoji}</span>
              <span>{display?.label} ({count})</span>
            </span>
          );
        })}
      </div>

      {/* Child status summary */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
        {status.executing > 0 && <span className="flex items-center gap-1"><Cog className="h-3 w-3 animate-spin text-blue-400" /> {status.executing} running</span>}
        {status.planning > 0 && <span className="flex items-center gap-1"><Brain className="h-3 w-3 text-purple-400" /> {status.planning} planning</span>}
        {status.completed > 0 && <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> {status.completed} done</span>}
        {status.failed > 0 && <span className="flex items-center gap-1"><AlertCircle className="h-3 w-3 text-red-400" /> {status.failed} failed</span>}
        {status.idle > 0 && <span className="text-zinc-500">{status.idle} pending</span>}
      </div>

      {/* Child task cards */}
      {group.children.length > 0 && (
        <div className="mt-2 border-t border-zinc-700/50 pt-2 space-y-1.5">
          {group.children.map((child) => {
            const agentDisplay = AGENT_DISPLAY[child.agentType as keyof typeof AGENT_DISPLAY];
            const priorityInfo = PRIORITY_DISPLAY[child.priority];
            return (
              <div
                key={child.id}
                className={cn(
                  'rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1.5',
                  priorityInfo?.borderClass,
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-xs font-medium leading-snug text-zinc-200 line-clamp-1">
                    {priorityInfo && <span className="mr-0.5">{priorityInfo.emoji}</span>}
                    {child.title}
                  </h4>
                  {statusIcon(child.agentStatus)}
                </div>
                {child.description && (
                  <p className="mt-0.5 text-[10px] leading-snug text-zinc-500 line-clamp-1">{child.description}</p>
                )}
                <div className="mt-1 flex items-center gap-2">
                  {agentDisplay && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500">
                      {agentDisplay.emoji} {agentDisplay.label}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
