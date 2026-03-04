import { useState, useRef, useEffect } from 'react';
import { Kanban, Search, Archive, ArrowUpDown, Filter, Plus, X } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { FilterChips, type StatusFilter } from './FilterChips';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
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
  onNewTask: () => void;
  onNewGroup: () => void;
}

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'priority', label: 'Priority' },
  { value: 'created', label: 'Created' },
  { value: 'status', label: 'Status' },
];

export function Header({ theme, toggleTheme, searchQuery, onSearchChange, showArchived, onToggleArchived, sortBy, sortDir, onSortByChange, onSortDirChange, activeAgentTypes, activeStatuses, onToggleAgentType, onToggleStatus, onClearFilters, onNewTask, onNewGroup }: HeaderProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const hasActiveFilters = activeAgentTypes.length > 0 || activeStatuses.length > 0;
  const { status: wsStatus, wasConnected } = useConnectionStatus();

  useEffect(() => {
    if (mobileSearchOpen) {
      mobileSearchRef.current?.focus();
    }
  }, [mobileSearchOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-700/30 bg-zinc-900 shadow-md">
      <div className="flex h-14 items-center justify-between px-3 md:px-6">
        {/* Logo + title */}
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500">
            <Kanban className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight text-white md:text-lg">
              Agentic AI Kanban
            </h1>
            <div className="hidden items-center gap-2 md:flex">
              <p className="text-sm text-zinc-400">
                AI Agent Task Board
              </p>
              <span className="flex items-center gap-1 text-[10px]">
                {wsStatus === 'connected' && (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-emerald-500/70">Live</span>
                  </>
                )}
                {wsStatus === 'disconnected' && wasConnected && (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    <span className="text-red-400">Reconnecting…</span>
                  </>
                )}
                {wsStatus === 'connecting' && (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                    <span className="text-amber-400/70">Connecting…</span>
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 md:gap-2">
          {/* New Task button */}
          <button
            onClick={onNewTask}
            className="flex items-center gap-1.5 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors px-2 md:px-3"
            aria-label="New Task"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">New Task</span>
          </button>

          {/* New Group button */}
          <button
            onClick={onNewGroup}
            className="flex items-center gap-1.5 h-8 rounded-lg border border-primary/50 text-primary text-xs font-medium hover:bg-primary/10 transition-colors px-2 md:px-3"
            aria-label="New Group"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">New Group</span>
          </button>

          {/* Search — icon toggle on mobile, always-visible input on desktop */}
          <button
            onClick={() => setMobileSearchOpen((v) => !v)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors md:hidden ${
              mobileSearchOpen || searchQuery
                ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
            }`}
            aria-label={mobileSearchOpen ? 'Close search' : 'Open search'}
          >
            {mobileSearchOpen ? <X className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
          </button>
          <div className="relative hidden md:block">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-300" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search tasks..."
              aria-label="Search tasks"
              className="h-8 w-48 rounded-lg border border-zinc-700 bg-zinc-800 pl-8 pr-3 text-xs text-zinc-200 placeholder:text-zinc-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
            />
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 h-8 rounded-lg border transition-colors text-xs font-medium px-2 md:px-3 ${
              showFilters || hasActiveFilters
                ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
            }`}
            aria-label="Toggle filters"
          >
            <Filter className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">Filter{hasActiveFilters ? ` (${activeAgentTypes.length + activeStatuses.length})` : ''}</span>
            {hasActiveFilters && <span className="md:hidden text-[10px] font-bold">{activeAgentTypes.length + activeStatuses.length}</span>}
          </button>

          {/* Sort control — hidden on mobile */}
          <div className="hidden md:flex items-center gap-1">
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
            className={`flex items-center gap-1.5 h-8 rounded-lg border transition-colors text-xs font-medium px-2 md:px-3 ${
              showArchived
                ? 'border-zinc-500 bg-zinc-700 text-zinc-100'
                : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
            }`}
            aria-label={showArchived ? 'Hide archived' : 'Show archived'}
          >
            <Archive className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">{showArchived ? 'Hide' : 'Show'} Archived</span>
          </button>

          <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
        </div>
      </div>

      {/* Mobile search row */}
      {mobileSearchOpen && (
        <div className="px-3 pb-2 md:hidden">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-300" />
            <input
              ref={mobileSearchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search tasks..."
              aria-label="Search tasks"
              className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-800 pl-8 pr-3 text-xs text-zinc-200 placeholder:text-zinc-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Collapsible filter chips row */}
      {showFilters && (
        <div className="flex items-center justify-end gap-2 px-3 pb-2 md:px-6">
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
