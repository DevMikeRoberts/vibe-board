import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useTransform, useSpring, useScroll } from 'framer-motion';
import type { CreateProjectRequest, Project, ProjectConfig, ProjectPathValidation, UpdateProjectRequest } from '@/types';
import { PixelIcon } from '@/components/PixelIcon';
import { ThemeToggle } from './ThemeToggle';
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
  onUpdateConfig: (patch: Partial<ProjectConfig>) => Promise<unknown>;
  onValidateProjectPath: (repoPath: string) => Promise<ProjectPathValidation | undefined>;
  onSelectProjectDirectory: (initialPath?: string) => Promise<string | null | undefined>;
  onOpenProject: (project: Project) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

// [status key, label, neon color var] — chips painted per-lane.
const countLabels: Array<[keyof NonNullable<Project['taskCounts']>, string, string]> = [
  ['backlog',      'backlog',     'var(--color-neon-blue)'],
  ['in-progress',  'in progress', 'var(--color-neon-yellow)'],
  ['review',       'review',      'var(--color-neon-purple)'],
  ['done',         'done',        'var(--color-neon-green)'],
];

// Neon hue cycled across project tiles by index.
const TILE_HUES = [
  'var(--color-neon-blue)',
  'var(--color-neon-green)',
  'var(--color-neon-yellow)',
  'var(--color-neon-purple)',
  'var(--color-neon-pink)',
];

function ProjectCard({
  project,
  hue,
  index,
  onOpen,
  onEdit,
  onDelete,
}: {
  project: Project;
  hue: string;
  index: number;
  onOpen: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [8, -8]), { stiffness: 200, damping: 20 });
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-8, 8]), { stiffness: 200, damping: 20 });
  const scale = useSpring(1, { stiffness: 200, damping: 20 });

  const { scrollYProgress } = useScroll();
  const parallaxY = useTransform(scrollYProgress, [0, 1], [0, -30 * ((index % 3) + 1) * 0.3]);

  function handleMouseMove(e: React.MouseEvent) {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    mouseX.set(x);
    mouseY.set(y);
    scale.set(1.02);
  }

  function handleMouseLeave() {
    mouseX.set(0);
    mouseY.set(0);
    scale.set(1);
  }

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 40, rotateX: 12 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ delay: index * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{ rotateX, rotateY, scale, y: parallaxY, perspective: 1000, transformStyle: 'preserve-3d' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="group cursor-pointer"
    >
      <article
        aria-label={project.name}
        className="panel-neon sticker-peel flex min-h-64 flex-col rounded-[1.75rem] p-5 transition-shadow duration-300 group-hover:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.5)]"
        style={{ '--panel': hue } as React.CSSProperties}
      >
        {/* Card header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg text-foreground [text-transform:lowercase]">{project.name}</h2>
            {project.repoUrl && (
              <p className="mt-1.5 flex items-center gap-1.5 break-all font-pixel text-[11px] text-muted-foreground">
                <PixelIcon name="global-public" className="h-3.5 w-3.5 shrink-0" />
                {project.repoUrl}
              </p>
            )}
            {project.repoPath ? (
              <p className="mt-1.5 break-all font-pixel text-[11px] text-muted-foreground">{project.repoPath}</p>
            ) : (
              <p className="mt-1.5 font-pixel text-[11px] text-muted-foreground [text-transform:lowercase]">manual local paths per task</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {project.isDefault && (
              <span
                className="sticker-sm inline-flex items-center gap-1 rounded-full px-2 py-1 font-pixel text-[10px] [text-transform:lowercase]"
                style={{ backgroundColor: 'var(--color-neon-yellow)', color: 'var(--color-ink)' }}
              >
                <PixelIcon name="rating-star-1" className="h-3 w-3" />
                default
              </span>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
              aria-label={`Edit ${project.name}`}
              title="Edit project"
            >
              <PixelIcon name="quill-ink" className="h-4 w-4" />
            </button>
            {!project.isDefault && onDelete && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground/80 transition-colors hover:border-destructive hover:text-destructive"
                aria-label={`Delete ${project.name}`}
                title="Delete project"
              >
                <PixelIcon name="bin" className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Task count chips */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          {countLabels.map(([key, label, color]) => (
            <div
              key={key}
              className="sticker-sm flex items-center justify-between gap-2 rounded-full bg-card px-3 py-2"
            >
              <span className="font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">{label}</span>
              <span
                className="sticker-sm inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-pixel text-[11px]"
                style={{ backgroundColor: color, color: 'var(--color-ink)' }}
              >
                {project.taskCounts?.[key] ?? 0}
              </span>
            </div>
          ))}
        </div>

        {/* Open Project CTA */}
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="sticker-sm sticker-press mt-auto flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 font-display text-sm text-primary-foreground [text-transform:lowercase] pt-5 transition-transform duration-200 group-hover:scale-[1.02]"
        >
          <PixelIcon name="flash" className="h-4 w-4" />
          open project
        </button>
      </article>
    </motion.div>
  );
}

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
      {/* ── Header — a moment ── */}
      <header className="sticky top-0 z-40 border-b-2 border-border bg-background/90 backdrop-blur-sm">
        <div className="flex h-16 items-center justify-between px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {/* Pinwheel sticker */}
            <div
              className="sticker relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary"
              aria-hidden="true"
            >
              <PixelIcon
                name="flash"
                className="h-6 w-6 animate-px-spin text-primary-foreground"
              />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-display text-lg text-foreground [text-transform:lowercase] md:text-xl">
                ai agent board
              </h1>
              <p className="font-pixel text-[10px] text-neon-pink [text-transform:lowercase]">projects</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openCreateDialog}
              className="sticker-sm sticker-press flex h-11 items-center gap-2 rounded-full bg-primary px-4 font-display text-sm text-primary-foreground [text-transform:lowercase]"
              aria-label="New Project"
            >
              <span className="font-pixel text-base leading-none">+</span>
              <span>new project</span>
            </button>
            <button
              onClick={() => setConfigOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-border bg-card text-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground"
              aria-label="Settings"
              title="Settings"
            >
              <PixelIcon name="settings-toggle-horizontal" className="h-5 w-5" />
            </button>
            <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-6xl space-y-6">

          {/* Intro banner */}
          <div
            className="panel-neon relative overflow-hidden rounded-[1.75rem] p-5"
            style={{ '--panel': 'var(--color-neon-blue)' } as React.CSSProperties}
          >
            <p className="relative max-w-3xl text-sm font-medium text-muted-foreground">
              Pick a Project to open a scoped board. Repo-backed Projects lock task Local Path to the Project path,
              while Default/no-repo Projects keep manual path entry available.
            </p>
          </div>

          {loading && (
            <div className="sticker rounded-[1.75rem] bg-card p-6 font-pixel text-xs text-muted-foreground [text-transform:lowercase]">
              loading projects…
            </div>
          )}

          {!loading && projects.length === 0 && (
            <div className="panel-neon rounded-[1.75rem] p-10 text-center" style={{ '--panel': 'var(--color-neon-purple)' } as React.CSSProperties}>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
                <PixelIcon name="home-2" className="h-12 w-12 animate-px-bob text-neon-purple" />
              </div>
              <h2 className="font-display text-2xl text-foreground [text-transform:lowercase]">no projects yet</h2>
              <p className="mt-3 font-pixel text-xs text-muted-foreground [text-transform:lowercase]">create a project to start a scoped board.</p>
              <button
                onClick={openCreateDialog}
                className="sticker-sm sticker-press mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 font-display text-sm text-primary-foreground [text-transform:lowercase] h-11"
              >
                <span className="font-pixel text-base leading-none">+</span>
                new project
              </button>
            </div>
          )}

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" style={{ perspective: '1200px' }}>
            {projects.map((project, i) => (
              <ProjectCard
                key={project.id}
                project={project}
                hue={TILE_HUES[i % TILE_HUES.length]}
                index={i}
                onOpen={() => onOpenProject(project)}
                onEdit={() => openEditDialog(project)}
                onDelete={!project.isDefault ? () => setDeletingProject(project) : undefined}
              />
            ))}
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
            <span className="font-semibold text-foreground">{deletingProject?.name}</span> will be permanently
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
            className="sticker fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full bg-destructive px-4 py-2.5 font-pixel text-[11px] text-primary-foreground"
          >
            <PixelIcon name="alert-triangle-1" className="h-4 w-4 shrink-0" />
            <span>{error}</span>
            <button
              onClick={onClearError}
              className="ml-1 shrink-0 font-pixel text-primary-foreground/90 hover:text-primary-foreground"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
