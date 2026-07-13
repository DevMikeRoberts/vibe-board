import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ThemeToggle } from './ThemeToggle';
import { PixelIcon } from './PixelIcon';
import { FilterChips, type StatusFilter } from './FilterChips';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { cn } from '@/lib/utils';
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

/** Chunky bordered control shell shared by the header's secondary buttons. */
const controlShell =
  'flex items-center justify-center rounded-xl border-2 border-border bg-card text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground';

export function Header({ theme, toggleTheme, searchQuery, onSearchChange, showArchived, onToggleArchived, sortBy, sortDir, onSortByChange, onSortDirChange, activeAgentTypes, activeStatuses, onToggleAgentType, onToggleStatus, onClearFilters, onNewTask, onNewGroup, title = 'AI Agent Board', onBackToProjects }: HeaderProps) {
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
    <header className="sticky top-0 z-50 border-b-2 border-border bg-background/90 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between gap-3 px-3 md:h-20 md:px-7">
        {/* Logo + title */}
        <div className="flex min-w-0 items-center gap-2.5 md:gap-4">
          {onBackToProjects && (
            <button
              onClick={onBackToProjects}
              className={cn(controlShell, 'h-10 shrink-0 gap-1.5 px-3 font-pixel text-[11px]')}
              aria-label="Back to Projects"
            >
              <PixelIcon name="navigation-left-circle-1" className="h-4 w-4" />
              <span className="hidden sm:inline">Projects</span>
            </button>
          )}

          {/* Pinwheel logo — pixel flash on a pink sticker */}
          <div className="sticker-sm flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary">
            <PixelIcon name="flash" className="animate-px-spin h-6 w-6 text-primary-foreground" />
          </div>

          <h1 className="truncate font-display text-xl leading-none text-foreground md:text-2xl [text-transform:lowercase]">
            {title}
          </h1>

          {/* Live connection status */}
          <span className="hidden items-center gap-1.5 font-pixel text-[10px] md:flex">
            {wsStatus === 'connected' && (
              <>
                <PixelIcon name="wifi-feed" className="animate-px-blink h-3.5 w-3.5 text-neon-green" />
                <span className="text-neon-green">live</span>
              </>
            )}
            {wsStatus === 'disconnected' && wasConnected && (
              <>
                <PixelIcon name="alert-triangle-1" className="h-3.5 w-3.5 text-destructive" />
                <span className="text-destructive">reconnecting…</span>
              </>
            )}
            {wsStatus === 'connecting' && (
              <>
                <PixelIcon name="wifi-feed" className="animate-px-blink h-3.5 w-3.5 text-neon-yellow" />
                <span className="text-neon-yellow">connecting…</span>
              </>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 md:gap-0">
          {/* ── Desktop-only controls ── */}

          {/* Group 1: Create actions — the loudest stickers on the shelf */}
          <div className="hidden md:flex items-center gap-2.5">
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={onNewTask}
              className="sticker-sm sticker-press flex h-11 items-center gap-2 rounded-full bg-primary px-4 font-display text-sm text-primary-foreground [text-transform:lowercase]"
              aria-label="New Task"
            >
              <PixelIcon name="flash" className="h-4 w-4" />
              <span>new task</span>
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={onNewGroup}
              className="sticker-sm sticker-press flex h-11 items-center gap-2 rounded-full px-4 font-display text-sm [text-transform:lowercase]"
              style={{ backgroundColor: 'var(--color-neon-purple)', color: 'var(--color-ink)' }}
              aria-label="New Group"
            >
              <PixelIcon name="layer" className="h-4 w-4" />
              <span>new group</span>
            </motion.button>
          </div>

          {/* Divider */}
          <div className="hidden md:block mx-3.5 h-7 w-0.5 rounded bg-border" />

          {/* Group 2: Search */}
          <div className="relative hidden md:block">
            <PixelIcon name="find-text" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="search tasks…"
              aria-label="Search tasks"
              className="h-11 w-56 rounded-xl border-2 border-border bg-card pl-10 pr-3 font-pixel text-[11px] text-foreground placeholder:text-muted-foreground focus:border-neon-pink focus:outline-none transition-colors"
            />
          </div>

          {/* Divider */}
          <div className="hidden md:block mx-3.5 h-7 w-0.5 rounded bg-border" />

          {/* Group 3: View controls — filter, sort, archive */}
          <div className="hidden md:flex items-center gap-2">
            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                controlShell,
                'h-11 gap-1.5 px-3.5 font-pixel text-[11px]',
                (showFilters || hasActiveFilters) &&
                  'border-neon-yellow bg-[color-mix(in_srgb,var(--color-neon-yellow)_16%,var(--color-card))] text-foreground'
              )}
              aria-label="Toggle filters"
              title="Filter"
            >
              <PixelIcon name="filter" className="h-4 w-4" />
              {hasActiveFilters && <span>{activeAgentTypes.length + activeStatuses.length}</span>}
            </button>

            {/* Sort control — joined group */}
            <div className="flex items-center h-11 rounded-xl border-2 border-border bg-card overflow-hidden">
              <div className="flex items-center pl-3 pr-1 text-muted-foreground">
                <PixelIcon name="flip-vertical-down" className="h-4 w-4" />
              </div>
              <select
                value={sortBy}
                onChange={(e) => onSortByChange(e.target.value as SortBy)}
                className="h-full bg-transparent px-1 font-pixel text-[11px] text-foreground focus:outline-none cursor-pointer"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-zinc-900">{opt.label}</option>
                ))}
              </select>
              <button
                onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
                className="flex h-full w-9 items-center justify-center border-l-2 border-border font-pixel text-sm text-foreground/80 hover:bg-accent hover:text-foreground transition-colors"
                aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
              >
                {sortDir === 'asc' ? '↑' : '↓'}
              </button>
            </div>

            {/* Archive toggle */}
            <button
              onClick={onToggleArchived}
              className={cn(
                controlShell,
                'h-11 w-11',
                showArchived &&
                  'border-neon-purple bg-[color-mix(in_srgb,var(--color-neon-purple)_18%,var(--color-card))] text-foreground'
              )}
              aria-label={showArchived ? 'Hide Archived' : 'Show Archived'}
              title={showArchived ? 'Hide Archived' : 'Show Archived'}
            >
              <PixelIcon name="floppy-disk" className="h-4 w-4" />
            </button>
          </div>

          {/* Divider */}
          <div className="hidden md:block mx-3.5 h-7 w-0.5 rounded bg-border" />

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
            className={cn(
              controlShell,
              'h-10 w-10 md:hidden',
              (mobileMenuOpen || hasActiveFilters || showArchived) &&
                'border-neon-pink bg-[color-mix(in_srgb,var(--color-neon-pink)_14%,var(--color-card))]'
            )}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
          >
            <PixelIcon name={mobileMenuOpen ? 'expand-3' : 'navigation-menu-1'} className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Mobile expanded panel ── */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t-2 border-border bg-background px-3 py-3.5 space-y-3">
          {/* Search */}
          <div className="relative">
            <PixelIcon name="find-text" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={mobileMenuSearchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="search tasks…"
              aria-label="Search tasks"
              className="h-11 w-full rounded-xl border-2 border-border bg-card pl-10 pr-3 font-pixel text-[11px] text-foreground placeholder:text-muted-foreground focus:border-neon-pink focus:outline-none transition-colors"
            />
          </div>

          {/* New Task + New Group */}
          <div className="flex gap-2.5">
            <button
              onClick={() => { onNewTask(); setMobileMenuOpen(false); }}
              className="sticker-sm flex flex-1 items-center justify-center gap-2 h-11 rounded-full bg-primary font-display text-sm text-primary-foreground [text-transform:lowercase]"
            >
              <PixelIcon name="flash" className="h-4 w-4" />
              new task
            </button>
            <button
              onClick={() => { onNewGroup(); setMobileMenuOpen(false); }}
              className="sticker-sm flex flex-1 items-center justify-center gap-2 h-11 rounded-full font-display text-sm [text-transform:lowercase]"
              style={{ backgroundColor: 'var(--color-neon-purple)', color: 'var(--color-ink)' }}
            >
              <PixelIcon name="layer" className="h-4 w-4" />
              new group
            </button>
          </div>

          <div className="flex items-center gap-2">
            <PixelIcon name="flip-vertical-down" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-pixel text-[11px] text-muted-foreground">sort</span>
            <select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value as SortBy)}
              className="flex-1 h-11 rounded-xl border-2 border-border bg-card px-2 font-pixel text-[11px] text-foreground focus:border-neon-pink focus:outline-none transition-colors"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-zinc-900">{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
              className={cn(controlShell, 'h-11 w-11 shrink-0 font-pixel text-sm')}
              aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>

          {/* Filter + Archive row */}
          <div className="flex gap-2.5">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                controlShell,
                'flex-1 h-11 gap-1.5 font-pixel text-[11px]',
                (showFilters || hasActiveFilters) &&
                  'border-neon-yellow bg-[color-mix(in_srgb,var(--color-neon-yellow)_16%,var(--color-card))]'
              )}
              aria-label="Toggle filters"
            >
              <PixelIcon name="filter" className="h-4 w-4" />
              filter{hasActiveFilters ? ` (${activeAgentTypes.length + activeStatuses.length})` : ''}
            </button>
            <button
              onClick={onToggleArchived}
              className={cn(
                controlShell,
                'flex-1 h-11 gap-1.5 font-pixel text-[11px]',
                showArchived &&
                  'border-neon-purple bg-[color-mix(in_srgb,var(--color-neon-purple)_18%,var(--color-card))]'
              )}
              aria-label={showArchived ? 'Hide archived' : 'Show archived'}
            >
              <PixelIcon name="floppy-disk" className="h-4 w-4" />
              {showArchived ? 'hide' : 'show'} archived
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
        <div className="hidden md:flex items-center justify-end gap-2 px-7 pb-3">
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
