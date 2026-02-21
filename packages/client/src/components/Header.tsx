import { Kanban, Search, Archive } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

interface HeaderProps {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  taskCount: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
}

export function Header({ theme, toggleTheme, taskCount, searchQuery, onSearchChange, showArchived, onToggleArchived }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-700/30 bg-zinc-900 shadow-md">
      <div className="flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500">
            <Kanban className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">
              Copilot Kanban
            </h1>
            <p className="text-sm text-zinc-400">
              AI Agent Task Board
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-300" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search tasks..."
              className="h-8 w-48 rounded-lg border border-zinc-700 bg-zinc-800 pl-8 pr-3 text-xs text-zinc-200 placeholder:text-zinc-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
            />
          </div>

          {/* Archive toggle */}
          <button
            onClick={onToggleArchived}
            className={`flex items-center gap-1.5 px-3 h-8 rounded-lg border transition-colors text-xs font-medium ${
              showArchived
                ? 'border-zinc-500 bg-zinc-700 text-zinc-100'
                : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
            }`}
            aria-label={showArchived ? 'Hide archived' : 'Show archived'}
          >
            <Archive className="h-3.5 w-3.5" />
            {showArchived ? 'Hide' : 'Show'} Archived
          </button>

          <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
        </div>
      </div>
    </header>
  );
}
