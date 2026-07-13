import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { CreateProjectRequest, Project, ProjectConfig, ProjectPathValidation, UpdateProjectRequest } from '@/types';
import { ThemeToggle } from './ThemeToggle';
import { PixelIcon } from '@/components/PixelIcon';
import { ProjectDialog, type ProjectDialogInitialValues } from './ProjectDialog';
import { ConfigDialog } from './ConfigDialog';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

interface ProjectsPageProps {
  projects: Project[];
  config: ProjectConfig | null;
  loading: boolean;
  error: string | null;
  initialCreate?: ProjectDialogInitialValues | null;
  onConsumeInitialCreate?: () => void;
  onClearError: () => void;
  onCreateProject: (data: CreateProjectRequest) => Promise<unknown>;
  onUpdateProject: (id: string, data: UpdateProjectRequest) => Promise<unknown>;
  onDeleteProject: (id: string) => Promise<unknown>;
  onUpdateConfig: (cloneRoot: string) => Promise<unknown>;
  onValidateProjectPath: (repoPath: string) => Promise<ProjectPathValidation | undefined>;
  onSelectProjectDirectory: (initialPath?: string) => Promise<string | null | undefined>;
  onOpenProject: (project: Project) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

const countLabels: Array<[keyof NonNullable<Project['taskCounts']>, string]> = [
  ['backlog', 'Backlog'],
  ['in-progress', 'In Progress'],
  ['review', 'Review'],
  ['done', 'Done'],
];

/** Neon crayon box — project tiles cycle through these hues by index. */
const NEON_CYCLE = [
  'var(--color-neon-blue)',
  'var(--color-neon-green)',
  'var(--color-neon-yellow)',
  'var(--color-neon-purple)',
  'var(--color-neon-pink)',
];

/** Staggered spring entrance for the project tiles. */
const tileSpring = (index: number) => ({
  initial: { opacity: 0, y: 24, scale: 0.92, rotate: -1 },
  animate: { opacity: 1, y: 0, scale: 1, rotate: 0 },
  transition: { type: 'spring' as const, stiffness: 320, damping: 24, delay: index * 0.07 },
});

export function ProjectsPage({
  projects,
  config,
  loading,
  error,
  initialCreate,
  onConsumeInitialCreate,
  onClearError,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onUpdateConfig,
  onValidateProjectPath,
  onSelectProjectDirectory,
  onOpenProject,
  theme,
  toggleTheme,
}: ProjectsPageProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [createInitialValues, setCreateInitialValues] = useState<ProjectDialogInitialValues | null>(null);

  // Open the Create dialog prefilled when launched via a creation URI.
  useEffect(() => {
    if (initialCreate) {
      setEditingProject(null);
      setCreateInitialValues(initialCreate);
      setDialogOpen(true);
    }
  }, [initialCreate]);

  function openCreateDialog() {
    setEditingProject(null);
    setCreateInitialValues(null);
    setDialogOpen(true);
  }

  function openEditDialog(project: Project) {
    setEditingProject(project);
    setCreateInitialValues(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingProject(null);
    setCreateInitialValues(null);
    onConsumeInitialCreate?.();
  }

  async function handleDialogSubmit(data: CreateProjectRequest | UpdateProjectRequest) {
    if (editingProject) return onUpdateProject(editingProject.id, data);
    return onCreateProject(data as CreateProjectRequest);
  }

  async function handleConfirmDeleteProject() {
    if (!deletingProject) return;
    const result = await onDeleteProject(deletingProject.id);
    if (result !== undefined) setDeletingProject(null);
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="sticky top-0 z-40 border-b-2 border-border bg-background/90 backdrop-blur-md">
        <div className="flex h-20 items-center justify-between gap-3 px-4 md:h-24 md:px-8">
          <div className="flex min-w-0 items-center gap-3 md:gap-4">
            {/* Pinwheel logo — pixel flash on a pink sticker */}
            <div className="sticker flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary md:h-14 md:w-14">
              <PixelIcon name="flash" className="animate-px-spin h-7 w-7 text-primary-foreground md:h-8 md:w-8" />
            </div>
            <h1 className="truncate font-display text-3xl leading-none text-foreground md:text-4xl [text-transform:lowercase]">
              Projects
            </h1>
          </div>
          <div className="flex items-center gap-2.5">
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={openCreateDialog}
              className="sticker-sm sticker-press flex h-11 items-center gap-2 rounded-full bg-primary px-4 font-display text-sm text-primary-foreground [text-transform:lowercase]"
              aria-label="New Project"
            >
              <PixelIcon name="flash" className="h-4 w-4" />
              <span className="hidden sm:inline">new project</span>
            </motion.button>
            <button
              onClick={() => setConfigOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
              aria-label="Settings"
              title="Settings"
            >
              <PixelIcon name="settings-toggle-horizontal" className="h-4 w-4" />
            </button>
            <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="panel-neon rounded-[1.75rem] p-5 md:p-6" style={{ '--panel': 'var(--color-neon-blue)' } as React.CSSProperties}>
            <p className="max-w-3xl font-sans text-sm text-muted-foreground md:text-base">
              Pick a Project to open a scoped board. Repo-backed Projects lock task Local Path to the Project path,
              while Default/no-repo Projects keep manual path entry available.
            </p>
          </div>

          {loading && (
            <div className="flex items-center gap-3 rounded-[1.75rem] border-2 border-border bg-card p-6">
              <PixelIcon name="loading-circle-1" className="animate-px-spin-fast h-5 w-5 text-neon-blue" />
              <span className="font-pixel text-[11px] text-muted-foreground">loading projects…</span>
            </div>
          )}

          {!loading && projects.length === 0 && (
            <div className="rounded-[1.75rem] border-2 border-dashed border-border bg-card p-10 text-center md:p-14">
              <PixelIcon name="alarm-bell-sleep" className="animate-px-bob mx-auto h-12 w-12 text-neon-purple" />
              <h2 className="mt-5 font-display text-2xl text-foreground [text-transform:lowercase]">No projects yet</h2>
              <p className="mt-3 font-pixel text-[11px] text-muted-foreground">create a project to start a scoped board</p>
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={openCreateDialog}
                className="sticker-sm sticker-press mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 font-display text-sm text-primary-foreground [text-transform:lowercase]"
              >
                <PixelIcon name="flash" className="h-4 w-4" />
                New Project
              </motion.button>
            </div>
          )}

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project, index) => {
              const hue = NEON_CYCLE[index % NEON_CYCLE.length];
              return (
                <motion.article
                  key={project.id}
                  aria-label={project.name}
                  {...tileSpring(index)}
                  className="panel-neon sticker-peel flex min-h-64 flex-col rounded-[1.75rem] p-6"
                  style={{ '--panel': hue } as React.CSSProperties}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-display text-xl text-foreground [text-transform:lowercase]">{project.name}</h2>
                      {project.repoUrl && (
                        <p className="mt-2.5 flex items-center gap-1.5 break-all font-pixel text-[10px] text-muted-foreground">
                          <PixelIcon name="global-public" className="h-3 w-3 shrink-0" />
                          {project.repoUrl}
                        </p>
                      )}
                      {project.repoPath ? (
                        <p className="mt-2.5 break-all font-pixel text-[10px] text-muted-foreground">{project.repoPath}</p>
                      ) : (
                        <p className="mt-2.5 font-pixel text-[10px] text-muted-foreground">manual local paths per task</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {project.isDefault && (
                        <span
                          className="sticker-sm inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-pixel text-[10px]"
                          style={{ backgroundColor: 'var(--color-neon-yellow)', color: 'var(--color-ink)' }}
                        >
                          <PixelIcon name="rating-star-1" className="h-3 w-3" />
                          default
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditDialog(project)}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground"
                        aria-label={`Edit ${project.name}`}
                        title="Edit project"
                      >
                        <PixelIcon name="quill-ink" className="h-4 w-4" />
                      </button>
                      {!project.isDefault && (
                        <button
                          type="button"
                          onClick={() => setDeletingProject(project)}
                          className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-transparent text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Delete ${project.name}`}
                          title="Delete project"
                        >
                          <PixelIcon name="bin" className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-2 gap-2.5">
                    {countLabels.map(([key, label]) => (
                      <div key={key} className="rounded-2xl border-2 border-border bg-card px-3.5 py-2.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-pixel text-[10px] lowercase text-muted-foreground">{label} {project.taskCounts?.[key] ?? 0}</span>
                          <span className="font-display text-xl text-foreground" aria-hidden="true">{project.taskCounts?.[key] ?? 0}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => onOpenProject(project)}
                    className="sticker-sm sticker-press mt-auto flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary pt-6 font-display text-sm text-primary-foreground [text-transform:lowercase] mt-6"
                  >
                    <PixelIcon name="hierarchy-2" className="h-4 w-4" />
                    Open Project
                  </motion.button>
                </motion.article>
              );
            })}

            {!loading && projects.length > 0 && (
              <motion.button
                type="button"
                onClick={openCreateDialog}
                {...tileSpring(projects.length)}
                whileTap={{ scale: 0.97 }}
                className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-[1.75rem] border-2 border-dashed border-border bg-card/50 text-muted-foreground transition-colors hover:border-neon-pink hover:text-foreground"
                aria-label="New Project"
              >
                <span className="font-display text-5xl leading-none" aria-hidden="true">+</span>
                <span className="font-pixel text-[11px] lowercase">new project</span>
              </motion.button>
            )}
          </div>
        </div>
      </main>

      <ProjectDialog
        open={dialogOpen}
        project={editingProject}
        initialValues={createInitialValues}
        onClose={closeDialog}
        onSubmit={handleDialogSubmit}
        onValidatePath={onValidateProjectPath}
        onSelectDirectory={onSelectProjectDirectory}
      />

      <ConfigDialog
        open={configOpen}
        config={config}
        onClose={() => setConfigOpen(false)}
        onSubmit={onUpdateConfig}
      />

      <DeleteConfirmDialog
        open={deletingProject !== null}
        taskTitle={deletingProject?.name ?? ''}
        title="Delete project?"
        description={(
          <p className="text-sm text-muted-foreground mb-5">
            <span className="font-medium text-foreground">{deletingProject?.name}</span> will be permanently
            deleted, along with all of its tasks and groups. This cannot be undone.
          </p>
        )}
        onCancel={() => setDeletingProject(null)}
        onConfirm={handleConfirmDeleteProject}
      />

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="sticker-sm fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-destructive px-5 py-2.5 font-pixel text-[11px] text-cream backdrop-blur-sm"
          >
            <PixelIcon name="alert-triangle-1" className="h-4 w-4 shrink-0" />
            <span>{error}</span>
            <button onClick={onClearError} className="ml-1 shrink-0 font-pixel text-sm hover:opacity-70" aria-label="Dismiss error">
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
