import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Search, Archive, ArrowUpDown, Filter, Plus, X, Menu, Zap, RotateCw } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { FilterChips, type StatusFilter } from './FilterChips';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { api } from '@/lib/api';
import type { AgentType } from '@/types';

type SortBy = 'title' | 'priority' | 'created' | 'status';
type SortDir = 'asc' | 'desc';

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
  title?: string;
  onBackToProjects?: () => void;
}

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'title',   label: 'Title' },
  { value: 'priority', label: 'Priority' },
  { value: 'created', label: 'Created' },
  { value: 'status',  label: 'Status' },
];

export function Header({
  theme, toggleTheme, searchQuery, onSearchChange,
  showArchived, onToggleArchived, sortBy, sortDir,
  onSortByChange, onSortDirChange, activeAgentTypes, activeStatuses,
  onToggleAgentType, onToggleStatus, onClearFilters,
  onNewTask, onNewGroup, title = 'AI Agent Board', onBackToProjects,
}: HeaderProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const mobileMenuSearchRef = useRef<HTMLInputElement>(null);
  const hasActiveFilters = activeAgentTypes.length > 0 || activeStatuses.length > 0;
  const { status: wsStatus, wasConnected } = useConnectionStatus();

  const handleRestart = async () => {
    if (!confirm('This will pull the latest code from GitHub and restart the server. Continue?')) {
      return;
    }
    
    setIsRestarting(true);
    try {
      await api.restartServer();
      // Server is restarting, no response expected
    } catch (err: unknown) {
      console.error('Restart failed:', err);
      alert(`Restart failed: ${err instanceof Error ? err.message : String(err)}`);
      setIsRestarting(false);
    }
  };

  useEffect(() => {
    if (mobileMenuOpen) mobileMenuSearchRef.current?.focus();
  }, [mobileMenuOpen]);

  return (
    <header
      className="sticky top-0 z-50 border-b border-white/5"
      style={{
        background: 'linear-gradient(180deg, rgba(8,9,15,0.97) 0%, rgba(9,10,16,0.95) 100%)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        boxShadow: '0 1px 0 rgba(255,255,255,0.04), 0 4px 24px rgba(0,0,0,0.4)',
      }}
    >
      {/* Top accent line — orange gradient */}
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(249,115,22,0.6) 35%, rgba(251,146,60,0.8) 50%, rgba(249,115,22,0.6) 65%, transparent 100%)' }}
        aria-hidden="true"
      />

      <div className="flex h-14 items-center justify-between px-3 md:px-5">
        {/* Logo + title */}
        <div className="flex min-w-0 items-center gap-2.5 md:gap-3">
          {onBackToProjects && (
            <button
              onClick={onBackToProjects}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 text-xs font-semibold text-zinc-300 transition-all hover:border-orange-500/40 hover:bg-orange-500/10 hover:text-orange-300"
              aria-label="Back to Projects"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Projects</span>
            </button>
          )}

          {/* Logo */}
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl btn-orange-gradient">
            <Zap className="h-4.5 w-4.5 relative z-10 text-white" style={{ height: '1.125rem', width: '1.125rem' }} />
          </div>

          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold tracking-tight text-white md:text-base gradient-text-orange">
              {title}
            </h1>
          </div>

          {/* Connection badge */}
          <div className="hidden items-center gap-1.5 md:flex">
            {wsStatus === 'connected' && (
              <span
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.30)', color: '#34d399' }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            )}
            {wsStatus === 'disconnected' && wasConnected && (
              <span
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.30)', color: '#f87171' }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                Reconnecting…
              </span>
            )}
            {wsStatus === 'connecting' && (
              <span
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.30)', color: '#fbbf24' }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                Connecting…
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 md:gap-0">
          {/* ── Desktop controls ── */}

          {/* Group 1: Create */}
          <div className="hidden md:flex items-center gap-2">
            <button
              onClick={onNewTask}
              className="btn-orange-gradient flex items-center gap-1.5 h-9 rounded-xl px-4 text-sm font-semibold"
              aria-label="New Task"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span>New Task</span>
            </button>
            <button
              onClick={onNewGroup}
              className="btn-orange-outline flex items-center gap-1.5 h-9 rounded-xl px-4 text-sm font-semibold"
              aria-label="New Group"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span>New Group</span>
            </button>
          </div>

          {/* Divider */}
          <div className="hidden md:block mx-3 h-5 w-px bg-white/8" />

          {/* Group 2: Search */}
          <div className="relative hidden md:block">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search tasks…"
              aria-label="Search tasks"
              className="h-9 w-48 rounded-xl border border-white/8 bg-white/5 pl-8 pr-3 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/40 transition-all"
              style={{ backdropFilter: 'blur(8px)' }}
            />
          </div>

          {/* Divider */}
          <div className="hidden md:block mx-3 h-5 w-px bg-white/8" />

          {/* Group 3: View controls */}
          <div className="hidden md:flex items-center gap-1.5">
            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 h-9 rounded-xl border transition-all text-xs font-semibold px-3 ${
                showFilters || hasActiveFilters
                  ? 'border-orange-500/50 bg-orange-500/12 text-orange-400 shadow-[0_0_14px_rgba(249,115,22,0.2)]'
                  : 'border-white/8 bg-white/5 text-zinc-400 hover:border-orange-500/30 hover:bg-orange-500/8 hover:text-orange-300'
              }`}
              aria-label="Toggle filters"
              title="Filter"
            >
              <Filter className="h-3.5 w-3.5 shrink-0" />
              {hasActiveFilters && <span className="text-[10px]">{activeAgentTypes.length + activeStatuses.length}</span>}
            </button>

            {/* Sort control */}
            <div
              className="flex items-center h-9 rounded-xl border border-white/8 bg-white/5 overflow-hidden transition-all hover:border-white/12"
            >
              <div className="flex items-center gap-1.5 pl-2.5 pr-1 text-zinc-500">
                <ArrowUpDown className="h-3.5 w-3.5 shrink-0" />
              </div>
              <select
                value={sortBy}
                onChange={(e) => onSortByChange(e.target.value as SortBy)}
                className="h-full bg-transparent px-1 text-xs text-zinc-300 focus:outline-none cursor-pointer"
                style={{ colorScheme: 'dark' }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-zinc-900">{opt.label}</option>
                ))}
              </select>
              <button
                onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
                className="flex h-full w-7 items-center justify-center border-l border-white/6 text-xs text-zinc-400 hover:bg-white/8 hover:text-zinc-200 transition-colors"
                aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
              >
                {sortDir === 'asc' ? '↑' : '↓'}
              </button>
            </div>

            {/* Archive toggle */}
            <button
              onClick={onToggleArchived}
              className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
                showArchived
                  ? 'border-zinc-500/50 bg-zinc-700/50 text-zinc-100 shadow-[0_0_12px_rgba(113,113,122,0.2)]'
                  : 'border-white/8 bg-white/5 text-zinc-500 hover:border-white/14 hover:bg-white/8 hover:text-zinc-300'
              }`}
              aria-label={showArchived ? 'Hide Archived' : 'Show Archived'}
              title={showArchived ? 'Hide Archived' : 'Show Archived'}
            >
              <Archive className="h-3.5 w-3.5 shrink-0" />
            </button>
          </div>

          {/* Divider */}
          <div className="hidden md:block mx-3 h-5 w-px bg-white/8" />

          <ThemeToggle theme={theme} toggleTheme={toggleTheme} />

          {/* Restart button */}
          <button
            onClick={handleRestart}
            disabled={isRestarting}
            className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
              isRestarting
                ? 'border-orange-500/50 bg-orange-500/20 text-orange-400 cursor-not-allowed opacity-70'
                : 'border-white/8 bg-white/5 text-zinc-400 hover:border-orange-500/30 hover:bg-orange-500/8 hover:text-orange-300'
            }`}
            aria-label="Restart server"
            title="Restart server (pull latest code from GitHub)"
          >
            <RotateCw className={`h-3.5 w-3.5 shrink-0 ${isRestarting ? 'animate-spin' : ''}`} />
          </button>

          {/* ── Mobile hamburger ── */}
          <button
            onClick={() => setMobileMenuOpen((v) => !v)}
            className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-all md:hidden ${
              mobileMenuOpen || hasActiveFilters || showArchived
                ? 'border-orange-500/50 bg-orange-500/12 text-orange-400'
                : 'border-white/8 bg-white/5 text-zinc-400 hover:border-white/14 hover:text-zinc-200'
            }`}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-3.5 w-3.5" /> : <Menu className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* ── Mobile expanded panel ── */}
      {mobileMenuOpen && (
        <div
          className="md:hidden border-t border-white/5 px-3 py-3 space-y-3"
          style={{ background: 'rgba(8,9,15,0.97)', backdropFilter: 'blur(24px)' }}
        >
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600 pointer-events-none" />
            <input
              ref={mobileMenuSearchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search tasks…"
              aria-label="Search tasks"
              className="h-10 w-full rounded-xl border border-white/8 bg-white/5 pl-8 pr-3 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/40 transition-all"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => { onNewTask(); setMobileMenuOpen(false); }}
              className="btn-orange-gradient flex flex-1 items-center justify-center gap-1.5 h-10 rounded-xl text-sm font-semibold"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              New Task
            </button>
            <button
              onClick={() => { onNewGroup(); setMobileMenuOpen(false); }}
              className="btn-orange-outline flex flex-1 items-center justify-center gap-1.5 h-10 rounded-xl text-sm font-semibold"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              New Group
            </button>
          </div>

          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <span className="text-xs text-zinc-500 font-medium">Sort</span>
            <select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value as SortBy)}
              className="flex-1 h-10 rounded-xl border border-white/8 bg-white/5 px-2 text-xs text-zinc-300 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/40 transition-all"
              style={{ colorScheme: 'dark' }}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-zinc-900">{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/5 text-xs text-zinc-400 hover:bg-white/8 hover:text-zinc-200 transition-colors"
              aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex flex-1 items-center justify-center gap-1.5 h-10 rounded-xl border transition-all text-xs font-semibold ${
                showFilters || hasActiveFilters
                  ? 'border-orange-500/50 bg-orange-500/12 text-orange-400'
                  : 'border-white/8 bg-white/5 text-zinc-400 hover:border-orange-500/30 hover:text-orange-300'
              }`}
              aria-label="Toggle filters"
            >
              <Filter className="h-3.5 w-3.5 shrink-0" />
              Filter{hasActiveFilters ? ` (${activeAgentTypes.length + activeStatuses.length})` : ''}
            </button>
            <button
              onClick={onToggleArchived}
              className={`flex flex-1 items-center justify-center gap-1.5 h-10 rounded-xl border transition-all text-xs font-semibold ${
                showArchived
                  ? 'border-zinc-500/50 bg-zinc-700/50 text-zinc-100'
                  : 'border-white/8 bg-white/5 text-zinc-400 hover:border-white/14 hover:text-zinc-200'
              }`}
              aria-label={showArchived ? 'Hide archived' : 'Show archived'}
            >
              <Archive className="h-3.5 w-3.5 shrink-0" />
              {showArchived ? 'Hide' : 'Show'} Archived
            </button>
            <button
              onClick={handleRestart}
              disabled={isRestarting}
              className={`flex items-center justify-center gap-1.5 h-10 rounded-xl border transition-all text-xs font-semibold ${
                isRestarting
                  ? 'border-orange-500/50 bg-orange-500/20 text-orange-400 cursor-not-allowed opacity-70'
                  : 'border-white/8 bg-white/5 text-zinc-400 hover:border-orange-500/30 hover:text-orange-300'
              }`}
              aria-label="Restart server"
              title="Restart server (pull latest code from GitHub)"
            >
              <RotateCw className={`h-3.5 w-3.5 shrink-0 ${isRestarting ? 'animate-spin' : ''}`} />
              Restart
            </button>
          </div>

          {showFilters && (
            <div className="flex items-center gap-2 flex-wrap pt-0.5">
              <FilterChips
                activeAgentTypes={activeAgentTypes}
                activeStatuses={activeStatuses}
                onToggleAgentType={onToggleAgentType}
                onToggleStatus={onToggleStatus}
                onClear={onClearFilters}
              />
            </div>
          )}
        </div>
      )}

      {/* Desktop filter chips row */}
      {showFilters && (
        <div className="hidden md:flex items-center justify-end gap-2 px-5 pb-2.5">
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
