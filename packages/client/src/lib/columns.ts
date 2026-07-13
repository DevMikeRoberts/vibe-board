import type { Column } from '@/types';

// color = neon panel hue (see PANEL_HUES in Column.tsx), icon = pixel icon name.
export const columns: Column[] = [
  { id: 'backlog', title: 'Backlog', color: 'yellow', icon: 'alarm-bell-sleep' },
  { id: 'in-progress', title: 'In Progress', color: 'blue', icon: 'hammer-1' },
  { id: 'review', title: 'Review', color: 'purple', icon: 'iris-scan-approved' },
  { id: 'done', title: 'Done', color: 'green', icon: 'rating-star-1' },
];
