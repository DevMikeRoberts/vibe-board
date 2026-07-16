import { useState, useRef, useEffect } from 'react';
import { PixelIcon } from '@/components/PixelIcon';
import { ThemeToggle } from './ThemeToggle';
import { RetroRadio } from './RetroRadio';
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
  onSprintPlanner: () => void;
  radio?: { on: boolean; volume: number; toggle: () => void; setVolume: (v: number) => void };
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
  onNewTask, onSprintPlanner, radio, title = 'Vibe Board', onBackToProjects,
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

  const quietControl =
    'rounded-xl border-2 border-border bg-card text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground';

  return (
    <header className="sticky top-0 z-50 border-b-2 border-border bg-background/95 backdrop-blur-sm">
      <div className="flex h-16 items-center justify-between px-3 md:px-4 lg:px-5">
        {/* Logo + title */}
        <div className="flex min-w-0 items-center gap-2.5 md:gap-3">
          {onBackToProjects && (
            <button
              onClick={onBackToProjects}
              className={`flex h-11 shrink-0 items-center gap-1.5 px-3 font-pixel text-[11px] lowercase ${quietControl}`}
              aria-label="Back to Projects"
            >
              <PixelIcon name="navigation-left-circle-1" className="h-4 w-4" />
              <span className="hidden sm:inline">projects</span>
            </button>
          )}

          {/* Logo — pinwheel sticker */}
          <div className="sticker-sm flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary">
            <PixelIcon
              name="flash"
              className="h-5 w-5 animate-px-spin text-primary-foreground"
            />
          </div>

          <div className="min-w-0">
            <h1 className="truncate font-display text-sm text-foreground [text-transform:lowercase] md:text-base lg:text-lg">
              {title}
            </h1>
          </div>

          {/* Connection badge */}
          <div className="hidden items-center gap-1.5 md:flex">
            {wsStatus === 'connected' && (
              <span
                className="sticker-sm flex items-center gap-1.5 rounded-full px-2.5 py-1 font-pixel text-[10px] lowercase"
                style={{ backgroundColor: 'var(--color-neon-green)', color: 'var(--color-ink)' }}
              >
                <PixelIcon name="wifi-feed" className="h-3 w-3 animate-px-blink" />
                live
              </span>
            )}
            {wsStatus === 'disconnected' && wasConnected && (
              <span
                className="sticker-sm flex items-center gap-1.5 rounded-full px-2.5 py-1 font-pixel text-[10px] lowercase"
                style={{ backgroundColor: 'var(--color-destructive)', color: 'var(--color-ink)' }}
              >
                <PixelIcon name="wifi-feed" className="h-3 w-3" />
                reconnecting…
              </span>
            )}
            {wsStatus === 'connecting' && (
              <span
                className="sticker-sm flex items-center gap-1.5 rounded-full px-2.5 py-1 font-pixel text-[10px] lowercase"
                style={{ backgroundColor: 'var(--color-neon-yellow)', color: 'var(--color-ink)' }}
              >
                <PixelIcon name="wifi-feed" className="h-3 w-3 animate-px-blink" />
                connecting…
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 md:gap-0">
          {/* ── Desktop controls ── */}

          {/* Group 1: Create */}
          <div className="hidden lg:flex items-center gap-2">
            <button
              onClick={onNewTask}
              className="sticker-sm sticker-press flex h-11 items-center gap-2 rounded-full bg-primary px-4 font-display text-sm text-primary-foreground [text-transform:lowercase]"
              aria-label="New Task"
            >
              <PixelIcon name="flash" className="h-4 w-4" />
              <span>new task</span>
            </button>
            <button
              onClick={onSprintPlanner}
              className="sticker-sm sticker-press flex h-11 items-center gap-2 rounded-full px-4 font-display text-sm [text-transform:lowercase]"
              style={{ backgroundColor: 'var(--color-neon-blue)', color: 'var(--color-ink)' }}
              aria-label="Sprint Planner"
            >
              <PixelIcon name="flag" className="h-4 w-4" />
              <span>sprint planner</span>
            </button>
          </div>

          {/* Divider */}
          <div className="hidden lg:block mx-3 h-6 w-0.5 bg-border" />

          {/* Group 2: Search */}
          <div className="relative hidden md:block">
            <PixelIcon
              name="find-text"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="search tasks…"
              aria-label="Search tasks"
              className="h-11 w-32 lg:w-48 rounded-xl border-2 border-border bg-card pl-9 pr-3 font-pixel text-[11px] text-foreground placeholder:text-muted-foreground focus:border-neon-pink focus:outline-none transition-colors"
            />
          </div>

          {/* Divider */}
          <div className="hidden md:block mx-3 h-6 w-0.5 bg-border" />

          {/* Group 3: View controls */}
          <div className="hidden md:flex items-center gap-1.5">
            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={
                showFilters || hasActiveFilters
                  ? 'sticker-sm flex h-11 items-center gap-1.5 rounded-xl px-3 font-pixel text-[11px] lowercase'
                  : `flex h-11 items-center gap-1.5 px-3 font-pixel text-[11px] lowercase ${quietControl}`
              }
              style={
                showFilters || hasActiveFilters
                  ? { backgroundColor: 'var(--color-neon-pink)', color: 'var(--color-ink)' }
                  : undefined
              }
              aria-label="Toggle filters"
              title="Filter"
            >
              <PixelIcon name="filter" className="h-4 w-4" />
              {hasActiveFilters && <span>{activeAgentTypes.length + activeStatuses.length}</span>}
            </button>

            {/* Sort control */}
            <div className={`flex items-center h-11 overflow-hidden ${quietControl}`}>
              <div className="flex items-center gap-1.5 pl-3 pr-1 text-muted-foreground">
                <PixelIcon name="flip-vertical-down" className="h-4 w-4" />
              </div>
              <select
                value={sortBy}
                onChange={(e) => onSortByChange(e.target.value as SortBy)}
                className="h-full bg-transparent px-1 font-pixel text-[11px] text-foreground focus:outline-none cursor-pointer"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-card text-foreground">{opt.label}</option>
                ))}
              </select>
              <button
                onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
                className="flex h-full w-8 items-center justify-center border-l-2 border-border font-pixel text-xs text-foreground/80 hover:bg-accent hover:text-foreground transition-colors"
                aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
              >
                {sortDir === 'asc' ? '↑' : '↓'}
              </button>
            </div>

            {/* Archive toggle */}
            <button
              onClick={onToggleArchived}
              className={
                showArchived
                  ? 'sticker-sm flex h-11 w-11 items-center justify-center rounded-xl font-pixel'
                  : `flex h-11 w-11 items-center justify-center ${quietControl}`
              }
              style={
                showArchived
                  ? { backgroundColor: 'var(--color-neon-yellow)', color: 'var(--color-ink)' }
                  : undefined
              }
              aria-label={showArchived ? 'Hide Archived' : 'Show Archived'}
              title={showArchived ? 'Hide Archived' : 'Show Archived'}
            >
              <PixelIcon name="floppy-disk" className="h-4 w-4" />
            </button>
          </div>

          {/* Retro Radio */}
          {radio && (
            <div className="hidden md:block mx-3 h-6 w-0.5 bg-border" />
          )}
          {radio && (
            <div className="hidden md:flex items-center">
              <RetroRadio
                on={radio.on}
                volume={radio.volume}
                onToggle={radio.toggle}
                onVolumeChange={radio.setVolume}
              />
            </div>
          )}

          <ThemeToggle theme={theme} toggleTheme={toggleTheme} />

          {/* Restart button */}
          <button
            onClick={handleRestart}
            disabled={isRestarting}
            className={
              isRestarting
                ? 'sticker-sm flex h-11 w-11 items-center justify-center rounded-xl font-pixel cursor-not-allowed opacity-70'
                : `flex h-11 w-11 items-center justify-center ${quietControl}`
            }
            style={
              isRestarting
                ? { backgroundColor: 'var(--color-neon-blue)', color: 'var(--color-ink)' }
                : undefined
            }
            aria-label="Restart server"
            title="Restart server (pull latest code from GitHub)"
          >
            <PixelIcon
              name="recycle"
              className={`h-4 w-4 ${isRestarting ? 'animate-px-spin-fast' : ''}`}
            />
          </button>

          {/* ── Mobile hamburger ── */}
          <button
            onClick={() => setMobileMenuOpen((v) => !v)}
            className={
              mobileMenuOpen || hasActiveFilters || showArchived
                ? 'sticker-sm flex h-11 w-11 items-center justify-center rounded-xl font-pixel md:hidden'
                : `flex h-11 w-11 items-center justify-center md:hidden ${quietControl}`
            }
            style={
              mobileMenuOpen || hasActiveFilters || showArchived
                ? { backgroundColor: 'var(--color-neon-pink)', color: 'var(--color-ink)' }
                : undefined
            }
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? (
              <span className="font-pixel text-sm leading-none" aria-hidden="true">✕</span>
            ) : (
              <PixelIcon name="navigation-menu-1" className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* ── Mobile expanded panel ── */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t-2 border-border bg-background px-3 py-3 space-y-3">
          <div className="relative">
            <PixelIcon
              name="find-text"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={mobileMenuSearchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="search tasks…"
              aria-label="Search tasks"
              className="h-11 w-full rounded-xl border-2 border-border bg-card pl-9 pr-3 font-pixel text-[11px] text-foreground placeholder:text-muted-foreground focus:border-neon-pink focus:outline-none transition-colors"
            />
          </div>

          {radio && (
            <div className="flex gap-2">
              <RetroRadio
                on={radio.on}
                volume={radio.volume}
                onToggle={radio.toggle}
                onVolumeChange={radio.setVolume}
              />
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => { onNewTask(); setMobileMenuOpen(false); }}
              className="sticker-sm sticker-press flex flex-1 items-center justify-center gap-2 h-11 rounded-full bg-primary font-display text-sm text-primary-foreground [text-transform:lowercase]"
            >
              <PixelIcon name="flash" className="h-4 w-4" />
              new task
            </button>
            <button
              onClick={() => { onSprintPlanner(); setMobileMenuOpen(false); }}
              className="sticker-sm sticker-press flex flex-1 items-center justify-center gap-2 h-11 rounded-full font-display text-sm [text-transform:lowercase]"
              style={{ backgroundColor: 'var(--color-neon-blue)', color: 'var(--color-ink)' }}
            >
              <PixelIcon name="flag" className="h-4 w-4" />
              sprint planner
            </button>
          </div>

          <div className="flex items-center gap-2">
            <PixelIcon name="flip-vertical-down" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-pixel text-[11px] text-muted-foreground lowercase">sort</span>
            <select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value as SortBy)}
              className="flex-1 h-11 rounded-xl border-2 border-border bg-card px-2 font-pixel text-[11px] text-foreground focus:border-neon-pink focus:outline-none transition-colors"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-card text-foreground">{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
              className={`flex h-11 w-11 shrink-0 items-center justify-center font-pixel text-xs ${quietControl}`}
              aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={
                showFilters || hasActiveFilters
                  ? 'sticker-sm flex flex-1 items-center justify-center gap-1.5 h-11 rounded-xl font-pixel text-[11px] lowercase'
                  : `flex flex-1 items-center justify-center gap-1.5 h-11 font-pixel text-[11px] lowercase ${quietControl}`
              }
              style={
                showFilters || hasActiveFilters
                  ? { backgroundColor: 'var(--color-neon-pink)', color: 'var(--color-ink)' }
                  : undefined
              }
              aria-label="Toggle filters"
            >
              <PixelIcon name="filter" className="h-4 w-4" />
              filter{hasActiveFilters ? ` (${activeAgentTypes.length + activeStatuses.length})` : ''}
            </button>
            <button
              onClick={onToggleArchived}
              className={
                showArchived
                  ? 'sticker-sm flex flex-1 items-center justify-center gap-1.5 h-11 rounded-xl font-pixel text-[11px] lowercase'
                  : `flex flex-1 items-center justify-center gap-1.5 h-11 font-pixel text-[11px] lowercase ${quietControl}`
              }
              style={
                showArchived
                  ? { backgroundColor: 'var(--color-neon-yellow)', color: 'var(--color-ink)' }
                  : undefined
              }
              aria-label={showArchived ? 'Hide archived' : 'Show archived'}
            >
              <PixelIcon name="floppy-disk" className="h-4 w-4" />
              {showArchived ? 'hide' : 'show'} archived
            </button>
            <button
              onClick={handleRestart}
              disabled={isRestarting}
              className={
                isRestarting
                  ? 'sticker-sm flex items-center justify-center gap-1.5 h-11 px-3 rounded-xl font-pixel text-[11px] lowercase cursor-not-allowed opacity-70'
                  : `flex items-center justify-center gap-1.5 h-11 px-3 font-pixel text-[11px] lowercase ${quietControl}`
              }
              style={
                isRestarting
                  ? { backgroundColor: 'var(--color-neon-blue)', color: 'var(--color-ink)' }
                  : undefined
              }
              aria-label="Restart server"
              title="Restart server (pull latest code from GitHub)"
            >
              <PixelIcon name="recycle" className={`h-4 w-4 ${isRestarting ? 'animate-px-spin-fast' : ''}`} />
              restart
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
        <div className="hidden md:flex items-center justify-end gap-2 px-5 pb-3">
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
