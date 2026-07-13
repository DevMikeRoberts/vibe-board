import type { Task, AgentStatus } from '@/types';
import { PixelIcon } from '@/components/PixelIcon';
import { cn } from '@/lib/utils';

export interface GroupStatus {
  total: number;
  completed: number;
  failed: number;
  executing: number;
  planning: number;
  idle: number;
}

export function computeGroupStatus(children: Task[]): GroupStatus {
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

export function statusIcon(status: AgentStatus, size = 'h-4 w-4') {
  switch (status) {
    case 'executing': return <PixelIcon name="loading-circle-1" className={cn(size, 'animate-px-spin-fast text-neon-blue')} />;
    case 'planning': return <PixelIcon name="light-bulb" className={cn(size, 'animate-px-blink text-neon-purple')} />;
    case 'complete': return <PixelIcon name="rating-star-1" className={cn(size, 'text-neon-green')} />;
    case 'failed': return <PixelIcon name="alert-triangle-1" className={cn(size, 'text-destructive')} />;
    default: return <PixelIcon name="alarm-bell-sleep" className={cn(size, 'text-muted-foreground')} />;
  }
}
