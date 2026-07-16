import { useState } from 'react';
import { PixelIcon } from '@/components/PixelIcon';
import type { Project } from '@/types';
import { ThemeToggle } from './ThemeToggle';

interface ProjectsSidebarProps {
  projects: Project[];
  selectedProjectId: string | undefined;
  onSelectProject: (project: Project) => void;
  onNewProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onOpenSettings: () => void;
  onGoHome: () => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

export function ProjectsSidebar({
  projects,
  selectedProjectId,
  onSelectProject,
  onNewProject,
  onEditProject,
  onDeleteProject,
  onOpenSettings,
  onGoHome,
  theme,
  toggleTheme,
}: ProjectsSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div
      className={`relative flex h-full shrink-0 flex-col border-r-2 border-border bg-card transition-[width] duration-300 ${
        collapsed ? 'w-14' : 'w-64'
      }`}
    >
      {/* ── Header — home button ── */}
      <div className="relative flex h-14 shrink-0 items-center border-b-2 border-border px-2">
        {collapsed ? (
          <button
            onClick={() => { onGoHome(); setCollapsed(false); }}
            className="sticker-sm sticker-press mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-neon-purple text-ink"
            aria-label="Go home"
            title="Go home"
          >
            <PixelIcon name="home-2" className="h-4 w-4" />
          </button>
        ) : (
          <>
            <button
              onClick={onGoHome}
              className="sticker sticker-press flex h-10 items-center gap-2 rounded-xl bg-neon-purple px-3 text-ink"
              aria-label="Go home"
              title="Go home"
            >
              <PixelIcon name="home-2" className="h-5 w-5" />
              <span className="font-display text-sm [text-transform:lowercase]">home</span>
            </button>
            <button
              onClick={() => setCollapsed(true)}
              className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground/70 transition-colors hover:border-foreground/40 hover:text-foreground"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PixelIcon name="navigation-left-circle-1" className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {/* ── New Project button (prominent gradient + glow) ── */}
      <div className="relative shrink-0 px-2 pt-3">
        {collapsed ? (
          <button
            onClick={onNewProject}
            className="sticker-sm sticker-press flex h-9 w-full items-center justify-center rounded-full"
            style={{
              background: 'linear-gradient(135deg, var(--color-neon-pink), var(--color-neon-purple))',
              color: 'var(--color-ink)',
              boxShadow: '0 0 16px var(--color-neon-pink)',
            }}
            title="New Project"
            aria-label="New Project"
          >
            <PixelIcon name="flash" className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={onNewProject}
            className="sticker-sm sticker-press flex w-full items-center gap-2 rounded-full px-5 py-2.5 font-display text-sm [text-transform:lowercase] transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, var(--color-neon-pink), var(--color-neon-purple))',
              color: 'var(--color-ink)',
              boxShadow: '0 0 20px color-mix(in srgb, var(--color-neon-pink) 50%, transparent), inset 0 1px 0 rgba(255,255,255,0.2)',
            }}
            aria-label="New Project"
          >
            <PixelIcon name="flash" className="h-4 w-4 shrink-0" />
            <span className="font-bold tracking-wide">new project</span>
            <PixelIcon name="cursor-click-point" className="h-3.5 w-3.5 ml-auto opacity-80" />
          </button>
        )}
      </div>

      {/* ── Project list ── */}
      <nav className="relative flex-1 overflow-y-auto px-2 py-3 space-y-1" aria-label="Projects">
        {projects.length === 0 && !collapsed && (
          <p className="px-3 py-4 text-center font-pixel text-[11px] text-muted-foreground [text-transform:lowercase]">
            no projects yet
          </p>
        )}

        {projects.map((project) => {
          const isActive = project.id === selectedProjectId;
          const isHovered = hoveredId === project.id;

          return (
            <div
              key={project.id}
              className={`group relative flex items-center rounded-xl border-l-4 transition-all duration-200 ${
                isActive
                  ? 'border-l-neon-pink bg-primary/15 text-foreground'
                  : 'border-l-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
              onMouseEnter={() => setHoveredId(project.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Clickable project button */}
              <button
                onClick={() => onSelectProject(project)}
                className={`flex min-w-0 flex-1 items-center gap-2.5 py-2.5 text-left ${
                  collapsed ? 'justify-center px-2' : 'pl-3 pr-1'
                }`}
                title={project.name}
                aria-label={`Open ${project.name}`}
                aria-current={isActive ? 'page' : undefined}
              >
                {project.isDefault ? (
                  <PixelIcon
                    name="home-2"
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-neon-yellow' : 'text-muted-foreground group-hover:text-neon-yellow'
                    }`}
                  />
                ) : (
                  <PixelIcon
                    name="global-public"
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-neon-pink' : 'text-muted-foreground group-hover:text-foreground'
                    }`}
                  />
                )}
                {!collapsed && (
                  <span className="truncate font-sans text-sm font-semibold">{project.name}</span>
                )}
              </button>

              {/* Edit / Delete buttons */}
              {!collapsed && isHovered && (
                <div className="flex shrink-0 items-center gap-0.5 pr-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); onEditProject(project); }}
                    className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label={`Edit ${project.name}`}
                    title="Edit project"
                  >
                    <PixelIcon name="quill-ink" className="h-3.5 w-3.5" />
                  </button>
                  {!project.isDefault && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteProject(project); }}
                      className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                      aria-label={`Delete ${project.name}`}
                      title="Delete project"
                    >
                      <PixelIcon name="bin" className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* ── Footer ── */}
      <div
        className={`relative flex shrink-0 items-center border-t-2 border-border p-2 ${
          collapsed ? 'flex-col gap-2' : 'justify-between'
        }`}
      >
        <button
          onClick={onOpenSettings}
          className={`flex items-center gap-2 rounded-xl px-2 py-2 font-pixel text-[11px] text-muted-foreground [text-transform:lowercase] transition-colors hover:bg-accent hover:text-foreground ${
            collapsed ? 'w-9 justify-center' : 'flex-1'
          }`}
          title="Settings"
          aria-label="Settings"
        >
          <PixelIcon name="settings-toggle-horizontal" className="h-4 w-4 shrink-0" />
          {!collapsed && <span>settings</span>}
        </button>

        <ThemeToggle theme={theme} toggleTheme={toggleTheme} />

        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="flex h-7 w-7 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground/70 transition-colors hover:border-foreground/40 hover:text-foreground"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <PixelIcon name="navigation-menu-1" className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
