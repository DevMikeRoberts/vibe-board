import { useState } from 'react';
import { ChevronLeft, ChevronRight, FolderKanban, Pencil, Plus, Settings, Star, Trash2, Zap } from 'lucide-react';
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
      className={`relative flex h-full shrink-0 flex-col border-r border-white/5 transition-[width] duration-300 ${
        collapsed ? 'w-14' : 'w-64'
      }`}
      style={{
        background: 'linear-gradient(180deg, #07080f 0%, #09090f 60%, #08080e 100%)',
        boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.04)',
      }}
    >
      {/* Ambient top glow */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 h-32 opacity-40"
        style={{
          background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(249,115,22,0.25) 0%, transparent 70%)',
        }}
        aria-hidden="true"
      />

      {/* ── Header ── */}
      <div className="relative flex h-14 shrink-0 items-center border-b border-white/5 px-2">
        {collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            className="btn-orange-gradient mx-auto flex h-8 w-8 items-center justify-center rounded-xl"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <FolderKanban className="h-4 w-4 text-white" />
          </button>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {/* Logo with animated ring */}
              <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl btn-orange-gradient">
                <div className="logo-ring" aria-hidden="true" />
                <Zap className="relative h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <span className="block truncate text-sm font-bold tracking-tight text-white">Projects</span>
                <span className="block text-[9px] font-medium uppercase tracking-widest text-orange-500/70">
                  AI Agent Board
                </span>
              </div>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-300"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {/* ── New Project button ── */}
      <div className="relative shrink-0 px-2 pt-3">
        {collapsed ? (
          <button
            onClick={onNewProject}
            className="flex h-9 w-full items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-white/5 hover:text-orange-400"
            title="New Project"
            aria-label="New Project"
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={onNewProject}
            className="btn-orange-gradient flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white"
            aria-label="New Project"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span>New Project</span>
          </button>
        )}
      </div>

      {/* ── Project list ── */}
      <nav className="relative flex-1 overflow-y-auto px-2 py-3 space-y-0.5" aria-label="Projects">
        {projects.length === 0 && !collapsed && (
          <p className="px-3 py-4 text-center text-xs text-zinc-600">No projects yet</p>
        )}

        {projects.map((project) => {
          const isActive = project.id === selectedProjectId;
          const isHovered = hoveredId === project.id;

          return (
            <div
              key={project.id}
              className={`group relative flex items-center rounded-xl transition-all duration-200 ${
                isActive
                  ? 'sidebar-project-active text-orange-300'
                  : 'text-zinc-500 hover:text-zinc-200'
              }`}
              onMouseEnter={() => setHoveredId(project.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Active left-border indicator with glow */}
              {isActive && (
                <div
                  className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-orange-500"
                  style={{ boxShadow: '0 0 8px rgba(249,115,22,0.8), 0 0 20px rgba(249,115,22,0.4)' }}
                />
              )}

              {/* Clickable project button */}
              <button
                onClick={() => onSelectProject(project)}
                className={`flex min-w-0 flex-1 items-center gap-2.5 py-2.5 text-left ${
                  collapsed ? 'justify-center px-2' : 'pl-3.5 pr-1'
                }`}
                title={project.name}
                aria-label={`Open ${project.name}`}
                aria-current={isActive ? 'page' : undefined}
              >
                {project.isDefault ? (
                  <Star
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-amber-400' : 'text-zinc-600 group-hover:text-amber-400/70'
                    }`}
                    style={isActive ? { filter: 'drop-shadow(0 0 4px rgba(251,191,36,0.7))' } : {}}
                  />
                ) : (
                  <FolderKanban
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-orange-400' : 'text-zinc-600 group-hover:text-zinc-400'
                    }`}
                    style={isActive ? { filter: 'drop-shadow(0 0 4px rgba(249,115,22,0.6))' } : {}}
                  />
                )}
                {!collapsed && (
                  <span className="truncate text-sm font-semibold">{project.name}</span>
                )}
              </button>

              {/* Edit / Delete buttons */}
              {!collapsed && isHovered && (
                <div className="flex shrink-0 items-center gap-0.5 pr-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); onEditProject(project); }}
                    className="flex h-6 w-6 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-white/8 hover:text-zinc-300"
                    aria-label={`Edit ${project.name}`}
                    title="Edit project"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  {!project.isDefault && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteProject(project); }}
                      className="flex h-6 w-6 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-red-500/15 hover:text-red-400"
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

      {/* ── Footer ── */}
      <div
        className={`relative flex shrink-0 items-center border-t border-white/5 p-2 ${
          collapsed ? 'flex-col gap-2' : 'justify-between'
        }`}
      >
        <button
          onClick={onOpenSettings}
          className={`flex items-center gap-2 rounded-xl px-2 py-2 text-xs text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-300 ${
            collapsed ? 'w-9 justify-center' : 'flex-1'
          }`}
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && <span className="text-xs font-medium">Settings</span>}
        </button>

        <ThemeToggle theme={theme} toggleTheme={toggleTheme} />

        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-700 transition-colors hover:bg-white/5 hover:text-zinc-400"
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
