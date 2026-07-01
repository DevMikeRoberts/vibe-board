import { useState } from 'react';
import { ChevronLeft, ChevronRight, FolderKanban, Pencil, Plus, Settings, Star, Trash2 } from 'lucide-react';
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
  theme,
  toggleTheme,
}: ProjectsSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div
      className={`relative flex h-full shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 transition-[width] duration-200 ${
        collapsed ? 'w-12' : 'w-52'
      }`}
    >
      {/* ── Header ── */}
      <div className="flex h-14 shrink-0 items-center border-b border-zinc-800 px-2">
        {collapsed ? (
          /* collapsed: just the icon centered */
          <button
            onClick={() => setCollapsed(false)}
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-white transition-colors hover:bg-blue-500"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <FolderKanban className="h-4 w-4" />
          </button>
        ) : (
          /* expanded: logo + title + collapse button */
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-600">
                <FolderKanban className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="truncate text-sm font-semibold text-white">Projects</span>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {/* ── New Project button ── */}
      <div className={`shrink-0 px-1.5 pt-2 ${collapsed ? '' : ''}`}>
        {collapsed ? (
          <button
            onClick={onNewProject}
            className="flex h-8 w-full items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            title="New Project"
            aria-label="New Project"
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={onNewProject}
            className="flex w-full items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500"
            aria-label="New Project"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span>New Project</span>
          </button>
        )}
      </div>

      {/* ── Project list ── */}
      <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5" aria-label="Projects">
        {projects.length === 0 && !collapsed && (
          <p className="px-2 py-3 text-center text-xs text-zinc-600">No projects yet</p>
        )}

        {projects.map((project) => {
          const isActive = project.id === selectedProjectId;
          const isHovered = hoveredId === project.id;

          return (
            <div
              key={project.id}
              className={`group relative flex items-center rounded-md transition-colors ${
                isActive
                  ? 'bg-blue-600/20 text-blue-300'
                  : 'text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200'
              }`}
              onMouseEnter={() => setHoveredId(project.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Active left-border indicator */}
              {isActive && (
                <div className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-blue-400" />
              )}

              {/* Clickable project button */}
              <button
                onClick={() => onSelectProject(project)}
                className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left ${
                  collapsed ? 'justify-center px-1.5' : 'pl-3 pr-1'
                }`}
                title={project.name}
                aria-label={`Open ${project.name}`}
                aria-current={isActive ? 'page' : undefined}
              >
                {project.isDefault ? (
                  <Star
                    className={`h-3.5 w-3.5 shrink-0 ${
                      isActive ? 'text-amber-400' : 'text-zinc-500 group-hover:text-amber-400/70'
                    }`}
                  />
                ) : (
                  <FolderKanban
                    className={`h-3.5 w-3.5 shrink-0 ${
                      isActive ? 'text-blue-400' : 'text-zinc-500 group-hover:text-zinc-400'
                    }`}
                  />
                )}
                {!collapsed && (
                  <span className="truncate text-xs font-medium">{project.name}</span>
                )}
              </button>

              {/* Edit / Delete buttons — only in expanded mode, shown on hover */}
              {!collapsed && isHovered && (
                <div className="flex shrink-0 items-center gap-0.5 pr-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditProject(project);
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
                    aria-label={`Edit ${project.name}`}
                    title="Edit project"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  {!project.isDefault && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteProject(project);
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-red-500/20 hover:text-red-400"
                      aria-label={`Delete ${project.name}`}
                      title="Delete project"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* ── Footer: settings + expand/collapse + theme ── */}
      <div
        className={`flex shrink-0 items-center border-t border-zinc-800 p-2 ${
          collapsed ? 'flex-col gap-2' : 'justify-between'
        }`}
      >
        <button
          onClick={onOpenSettings}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 ${
            collapsed ? 'w-8 justify-center' : 'flex-1'
          }`}
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && <span>Settings</span>}
        </button>

        <ThemeToggle theme={theme} toggleTheme={toggleTheme} />

        {/* Expand button when collapsed — shown in footer for quick access */}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
