import { useEffect, useState } from 'react';
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
  /** Below md the sidebar is an off-canvas drawer controlled by these. */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
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
  mobileOpen = false,
  onCloseMobile,
}: ProjectsSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  // The collapsed rail is desktop-only — always present the mobile drawer expanded.
  useEffect(() => {
    if (mobileOpen) setCollapsed(false);
  }, [mobileOpen]);

  return (
    <>
      {/* ── Mobile drawer backdrop ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-[55] bg-[var(--overlay-bg)] md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-[60] flex w-72 max-w-[85vw] shrink-0 flex-col border-r-2 border-border bg-card transition-[transform,width,visibility] duration-300 md:relative md:z-auto md:h-full md:max-w-none md:translate-x-0 md:visible ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full max-md:invisible'
        } ${collapsed ? 'md:w-14' : 'md:w-64'}`}
      >
        {/* ── Header — home button ── */}
        <div className="relative flex h-14 shrink-0 items-center border-b-2 border-border px-2">
          {collapsed ? (
            <button
              onClick={() => { onGoHome(); setCollapsed(false); onCloseMobile?.(); }}
              className="sticker-sm sticker-press mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-neon-purple text-ink"
              aria-label="Go home"
              title="Go home"
            >
              <PixelIcon name="home-2" className="h-4 w-4" />
            </button>
          ) : (
            <>
              <button
                onClick={() => { onGoHome(); onCloseMobile?.(); }}
                className="sticker sticker-press flex h-10 items-center gap-2 rounded-xl bg-neon-purple px-3 text-ink"
                aria-label="Go home"
                title="Go home"
              >
                <PixelIcon name="home-2" className="h-5 w-5" />
                <span className="font-display text-sm [text-transform:lowercase]">home</span>
              </button>
              <button
                onClick={() => setCollapsed(true)}
                className="ml-auto hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground/70 transition-colors hover:border-foreground/40 hover:text-foreground md:flex"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <PixelIcon name="navigation-left-circle-1" className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {/* ── New Project button ── */}
        <div className="relative shrink-0 px-2 pt-3">
          {collapsed ? (
            <button
              onClick={() => { onNewProject(); onCloseMobile?.(); }}
              className="sticker-sm sticker-press flex h-9 w-full items-center justify-center rounded-full bg-primary text-primary-foreground"
              title="New Project"
              aria-label="New Project"
            >
              <PixelIcon name="flash" className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => { onNewProject(); onCloseMobile?.(); }}
              className="sticker-sm sticker-press flex w-full items-center gap-2 rounded-full bg-primary px-4 py-2 font-display text-sm text-primary-foreground [text-transform:lowercase]"
              aria-label="New Project"
            >
              <PixelIcon name="flash" className="h-4 w-4 shrink-0" />
              <span>new project</span>
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

            return (
              <div
                key={project.id}
                className={`group relative flex items-center rounded-xl border-l-4 transition-all duration-200 ${
                  isActive
                    ? 'border-l-neon-pink bg-primary/15 text-foreground'
                    : 'border-l-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {/* Clickable project button */}
                <button
                  onClick={() => { onSelectProject(project); onCloseMobile?.(); }}
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

                {/* Edit / Delete buttons — always visible on touch, hover/focus reveal on fine pointers */}
                {!collapsed && (
                  <div className="flex shrink-0 items-center gap-0.5 pr-1.5 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); onEditProject(project); onCloseMobile?.(); }}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label={`Edit ${project.name}`}
                      title="Edit project"
                    >
                      <PixelIcon name="quill-ink" className="h-3.5 w-3.5" />
                    </button>
                    {!project.isDefault && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteProject(project); onCloseMobile?.(); }}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
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
          className={`relative flex shrink-0 items-center border-t-2 border-border p-2 max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))] ${
            collapsed ? 'flex-col gap-2' : 'justify-between'
          }`}
        >
          <button
            onClick={() => { onOpenSettings(); onCloseMobile?.(); }}
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
              className="hidden h-9 w-9 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground/70 transition-colors hover:border-foreground/40 hover:text-foreground md:flex"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <PixelIcon name="navigation-menu-1" className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
