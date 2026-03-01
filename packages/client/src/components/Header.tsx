import { useState } from 'react';
import { Kanban, Search, Archive, ArrowUpDown, Filter } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { FilterChips, type StatusFilter } from './FilterChips';
import type { AgentType } from '@/types';

export type SortBy = 'title' | 'priority' | 'created' | 'status';
export type SortDir = 'asc' | 'desc';

interface HeaderProps {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  sortBy: SortBy;
  sortDir: SortDir;
  onSortByChange: (sortBy: SortBy) => void;
  onSortDirChange: (sortDir: SortDir) => void;
  activeAgentTypes: AgentType[];
  activeStatuses: StatusFilter[];
  onToggleAgentType: (agentType: AgentType) => void;
  onToggleStatus: (status: StatusFilter) => void;
  onClearFilters: () => void;
}

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'priority', label: 'Priority' },
  { value: 'created', label: 'Created' },
  { value: 'status', label: 'Status' },
];

export function Header({ theme, toggleTheme, searchQuery, onSearchChange, showArchived, onToggleArchived, sortBy, sortDir, onSortByChange, onSortDirChange, activeAgentTypes, activeStatuses, onToggleAgentType, onToggleStatus, onClearFilters }: HeaderProps) {
  const [showFilters, setShowFilters] = useState(false);
  const hasActiveFilters = activeAgentTypes.length > 0 || activeStatuses.length > 0;

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

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 h-8 rounded-lg border transition-colors text-xs font-medium ${
              showFilters || hasActiveFilters
                ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
            }`}
            aria-label="Toggle filters"
          >
            <Filter className="h-3.5 w-3.5" />
            Filter{hasActiveFilters ? ` (${activeAgentTypes.length + activeStatuses.length})` : ''}
          </button>

          {/* Sort control */}
          <div className="flex items-center gap-1">
            <ArrowUpDown className="h-3.5 w-3.5 text-zinc-400" />
            <select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value as SortBy)}
              className="h-8 rounded-lg border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
              aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
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

      {/* Collapsible filter chips row */}
      {showFilters && (
        <div className="flex items-center gap-2 px-6 pb-2">
          <FilterChips
            activeAgentTypes={activeAgentTypes}
            activeStatuses={activeStatuses}
            onToggleAgentType={onToggleAgentType}
            onToggleStatus={onToggleStatus}
            onClear={onClearFilters}
          />
        </div>
      )}
    </header>
  );
}
