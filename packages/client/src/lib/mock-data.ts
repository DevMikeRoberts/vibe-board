import type { Column } from '@/types';

export const columns: Column[] = [
  { id: 'backlog', title: 'Backlog', color: 'bg-zinc-500', icon: 'inbox' },
  { id: 'in-progress', title: 'In Progress', color: 'bg-blue-500', icon: 'loader' },
  { id: 'review', title: 'Review', color: 'bg-amber-500', icon: 'eye' },
  { id: 'done', title: 'Done', color: 'bg-emerald-500', icon: 'check-circle' },
];
