import { useState, useCallback, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PixelIcon } from '@/components/PixelIcon';
import type {
  Task,
  AgentType,
  Priority,
  ColumnId,
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
} from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { useTasks } from '@/hooks/useTasks';
import { useProjects } from '@/hooks/useProjects';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useDebounce } from '@/hooks/useDebounce';
import { useTaskGroups } from '@/hooks/useTaskGroups';
import { PRIORITY_WEIGHT } from '@/lib/priority-config';
import { slugify } from '@/lib/utils';
import { api } from '@/lib/api';
import { SK_SORT_BY, SK_SORT_DIR, SK_FILTER_AGENTS, SK_FILTER_STATUSES } from '@/lib/storage-keys';
import { Header } from '@/components/Header';
import type { StatusFilter } from '@/components/FilterChips';
import { statusFilterToStatuses } from '@/components/FilterChips';
import { Board } from '@/components/Board';
import { TaskDialog } from '@/components/TaskDialog';
import { SprintPlannerDialog } from '@/components/SprintPlannerDialog';
import { TaskGroupDialog } from '@/components/TaskGroupDialog';
import { GroupPanel } from '@/components/GroupPanel';
import { AgentPanel } from '@/components/AgentPanel';
import { TaskFullView } from '@/components/TaskFullView';
import type { TaskGroupWithChildren } from '@/lib/api';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { ProjectDialog } from '@/components/ProjectDialog';
import type { ProjectDialogInitialValues } from '@/components/ProjectDialog';
import { ConfigDialog } from '@/components/ConfigDialog';
import { ProjectsSidebar } from '@/components/ProjectsSidebar';
import { GitHubSetupModal } from '@/components/GitHubSetupModal';
import { BoardCompanion } from '@/components/BoardCompanion';
import { useCompanion } from '@/hooks/useCompanion';
import { useRadio } from '@/hooks/useRadio';
import { DitherBackground } from '@/components/DitherBackground';
import { SakuraLeaves } from '@/components/SakuraLeaves';
import { RainAnimation } from '@/components/RainAnimation';
import { HomePage } from '@/components/HomePage';

const STATUS_WEIGHT: Record<string, number> = { executing: 0, planning: 1, failed: 2, idle: 3, complete: 4 };

type TaskSubmitData = {
  title: string;
  description: string;
  priority: Priority;
  columnId: ColumnId;
  agentType: AgentType;
  model?: string;
  autoRun?: boolean;
  repoPath?: string;
  branchName?: string;
  baseBranch?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// BoardPage
// ─────────────────────────────────────────────────────────────────────────────

function BoardPage({
  project,
  theme,
  toggleTheme,
  radio,
}: {
  project: Project;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  radio: { on: boolean; volume: number; toggle: () => void; setVolume: (v: number) => void };
}) {
  const lockedRepoPath = project.repoPath;
  const projectDefaults = {
    defaultAgentType: project.defaultAgentType,
    defaultPriority: project.defaultPriority,
    defaultBaseBranch: project.defaultBaseBranch,
  };
  const { tasks, error, clearError, showArchived, setShowArchived, addTask, updateTask, moveTask, runTask, stopTask, deleteTask, archiveTask, unarchiveTask, configureAndRunTask, createPR, mergeLocal } = useTasks(project.id);
  const { groups, createGroup, runGroup, stopGroup, deleteGroup, updateGroup, refreshGroup } = useTaskGroups(project.id);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sprintDialogOpen, setSprintDialogOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TaskGroupWithChildren | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [fullViewTaskId, setFullViewTaskId] = useState<string | null>(null);
  const [highlightRequiredFields, setHighlightRequiredFields] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'title' | 'priority' | 'created' | 'status'>(
    () => (localStorage.getItem(SK_SORT_BY) as 'title' | 'priority' | 'created' | 'status') || 'title'
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(
    () => (localStorage.getItem(SK_SORT_DIR) as 'asc' | 'desc') || 'asc'
  );
  const [activeAgentTypes, setActiveAgentTypes] = useState<AgentType[]>(
    () => { try { return JSON.parse(localStorage.getItem(SK_FILTER_AGENTS) || '[]'); } catch { return []; } }
  );
  const [activeStatuses, setActiveStatuses] = useState<StatusFilter[]>(
    () => { try { return JSON.parse(localStorage.getItem(SK_FILTER_STATUSES) || '[]'); } catch { return []; } }
  );

  const companion = useCompanion();

  // Debounce search query
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Persist sort preferences
  useEffect(() => {
    localStorage.setItem(SK_SORT_BY, sortBy);
    localStorage.setItem(SK_SORT_DIR, sortDir);
  }, [sortBy, sortDir]);

  // Persist filter preferences
  useEffect(() => {
    localStorage.setItem(SK_FILTER_AGENTS, JSON.stringify(activeAgentTypes));
    localStorage.setItem(SK_FILTER_STATUSES, JSON.stringify(activeStatuses));
  }, [activeAgentTypes, activeStatuses]);

  // Derive live task from tasks array so it stays current with WS updates
  const selectedTask = useMemo(
    () => {
      if (!selectedTaskId) return null;
      // Search standalone tasks first, then group children
      const standalone = tasks.find((t) => t.id === selectedTaskId);
      if (standalone) return standalone;
      for (const g of groups) {
        const child = g.children.find((c) => c.id === selectedTaskId);
        if (child) return child;
      }
      return null;
    },
    [selectedTaskId, tasks, groups]
  );

  const fullViewTask = useMemo(() => {
    if (!fullViewTaskId) return null;
    const standalone = tasks.find((t) => t.id === fullViewTaskId);
    if (standalone) return standalone;
    for (const g of groups) {
      const child = g.children.find((c) => c.id === fullViewTaskId);
      if (child) return child;
    }
    return null;
  }, [fullViewTaskId, tasks, groups]);

  const selectedGroup = useMemo(
    () => (selectedGroupId ? groups.find((g) => g.id === selectedGroupId) ?? null : null),
    [selectedGroupId, groups]
  );

  const handleClickGroup = useCallback((group: TaskGroupWithChildren) => {
    setSelectedGroupId(group.id);
    setSelectedTaskId(null);
  }, []);

  const handleDeleteGroup = useCallback((id: string) => {
    setDeletingGroupId(id);
  }, []);

  const handleEditGroup = useCallback((group: TaskGroupWithChildren) => {
    setEditingGroup(group);
    setGroupDialogOpen(true);
  }, []);

  const handleEditGroupSubmit = useCallback(async (id: string, updates: { title: string; description?: string; priority: Priority; maxConcurrency: number }) => {
    return updateGroup(id, updates);
  }, [updateGroup]);

  const handleRetryChild = useCallback(async (taskId: string) => {
    await runTask(taskId);
    if (selectedGroupId) refreshGroup(selectedGroupId);
  }, [runTask, selectedGroupId, refreshGroup]);

  const handleChildClick = useCallback((task: Task) => {
    setSelectedGroupId(null);
    setSelectedTaskId(task.id);
  }, []);

  // Filter tasks by search query, agent type, and status
  const filteredTasks = useMemo(() => {
    let result = tasks;

    // Text search
    if (debouncedSearchQuery.trim()) {
      const q = debouncedSearchQuery.toLowerCase();
      result = result.filter(
        (t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
      );
    }

    // Agent type filter (OR within group)
    if (activeAgentTypes.length > 0) {
      result = result.filter((t) => t.agentType && activeAgentTypes.includes(t.agentType));
    }

    // Status filter (OR within group) — "running" maps to planning|executing
    if (activeStatuses.length > 0) {
      const matchingStatuses = activeStatuses.flatMap(statusFilterToStatuses);
      result = result.filter((t) => matchingStatuses.includes(t.agentStatus));
    }

    return result;
  }, [tasks, debouncedSearchQuery, activeAgentTypes, activeStatuses]);

  // Sort comparator
  const sortTasks = useCallback((a: Task, b: Task): number => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortBy) {
      case 'title':
        return dir * a.title.localeCompare(b.title);
      case 'priority':
        return dir * ((PRIORITY_WEIGHT[a.priority] ?? 2) - (PRIORITY_WEIGHT[b.priority] ?? 2));
      case 'created':
        return dir * (a.createdAt - b.createdAt);
      case 'status':
        return dir * ((STATUS_WEIGHT[a.agentStatus] ?? 3) - (STATUS_WEIGHT[b.agentStatus] ?? 3));
      default:
        return 0;
    }
  }, [sortBy, sortDir]);

  const getFilteredTasksByColumn = useCallback(
    (columnId: ColumnId) => filteredTasks.filter((t) => t.columnId === columnId).sort(sortTasks),
    [filteredTasks, sortTasks]
  );

  const handleToggleAgentType = useCallback((agentType: AgentType) => {
    setActiveAgentTypes((prev) =>
      prev.includes(agentType) ? prev.filter((t) => t !== agentType) : [...prev, agentType]
    );
  }, []);

  const handleToggleStatus = useCallback((status: StatusFilter) => {
    setActiveStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  }, []);

  const handleClearFilters = useCallback(() => {
    setActiveAgentTypes([]);
    setActiveStatuses([]);
  }, []);

  const handleTaskClick = useCallback((task: Task) => {
    if (task.columnId === 'backlog') return;
    setSelectedTaskId(task.id);
  }, []);

  const handleClosePanel = useCallback(() => {
    // If viewing a grouped child, return to its group panel
    if (selectedTaskId) {
      for (const g of groups) {
        if (g.children.some((c) => c.id === selectedTaskId)) {
          setSelectedTaskId(null);
          setSelectedGroupId(g.id);
          return;
        }
      }
    }
    setSelectedTaskId(null);
  }, [selectedTaskId, groups]);

  const handleOpenDialog = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const handleOpenSprintDialog = useCallback(() => {
    setSprintDialogOpen(true);
  }, []);

  const handleCloseDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingTask(null);
    setHighlightRequiredFields(false);
  }, []);

  const handleEditTask = useCallback((task: Task) => {
    setEditingTask(task);
    setDialogOpen(true);
  }, []);

  const handleCreateTask = useCallback((task: TaskSubmitData) => {
    return addTask({
      ...task,
      projectId: project.id,
      repoPath: lockedRepoPath || task.repoPath,
    });
  }, [addTask, project.id, lockedRepoPath]);

  const handleCreateGroup = useCallback((group: Parameters<typeof createGroup>[0]) => {
    return createGroup({
      ...group,
      projectId: project.id,
      repoPath: lockedRepoPath || group.repoPath,
    });
  }, [createGroup, project.id, lockedRepoPath]);

  const handleSprintPlan = useCallback(async (data: {
    sprintName: string;
    description: string;
    agentType: AgentType;
    repoPath?: string;
    baseBranch?: string;
    priority: Priority;
    projectId: string;
  }) => {
    return api.createSprintPlan(data);
  }, []);

  const handleDeleteTask = useCallback((task: Task) => {
    setDeletingTask(task);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (deletingTask) {
      deleteTask(deletingTask.id);
      setDeletingTask(null);
    } else if (deletingGroupId) {
      await deleteGroup(deletingGroupId);
      if (selectedGroupId === deletingGroupId) setSelectedGroupId(null);
      setDeletingGroupId(null);
    }
  }, [deletingTask, deleteTask, deletingGroupId, deleteGroup, selectedGroupId]);

  const handleCancelDelete = useCallback(() => {
    setDeletingTask(null);
    setDeletingGroupId(null);
  }, []);

  const handleArchiveTask = useCallback((task: Task) => {
    archiveTask(task.id);
  }, [archiveTask]);

  const handleUnarchiveTask = useCallback((task: Task) => {
    unarchiveTask(task.id);
  }, [unarchiveTask]);

  // Worktree dialog: intercept Run — if task has repoPath, run directly; otherwise open edit dialog
  const handleRunWithConfig = useCallback((taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    if (task.repoPath) {
      setSelectedTaskId(taskId);
      configureAndRunTask(taskId, {
        repoPath: task.repoPath,
        branchName: task.branchName || `task/${slugify(task.title)}`,
        baseBranch: task.baseBranch || 'main',
        agentType: task.agentType,
      });
    } else {
      setEditingTask(task);
      setHighlightRequiredFields(true);
      setDialogOpen(true);
    }
  }, [tasks, configureAndRunTask]);

  const handleRetryTask = useCallback((task: Task) => {
    setSelectedTaskId(task.id);
    runTask(task.id);
  }, [runTask]);

  const handleExpandTask = useCallback((task: Task) => {
    setFullViewTaskId(task.id);
    // Close the slide-in panel when expanding to full view
    setSelectedTaskId(null);
  }, []);

  const handleCloseFullView = useCallback(() => {
    setFullViewTaskId(null);
  }, []);

  const handleMinimizeFullView = useCallback(() => {
    // Collapse full view back to slide-in panel
    if (fullViewTaskId) {
      setSelectedTaskId(fullViewTaskId);
    }
    setFullViewTaskId(null);
  }, [fullViewTaskId]);

  const handleReconfigureRetry = useCallback((taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    setEditingTask(task);
    setHighlightRequiredFields(true);
    setDialogOpen(true);
  }, [tasks]);

  // Keyboard shortcuts
  const handleCloseAll = useCallback(() => {
    if (fullViewTaskId) {
      setFullViewTaskId(null);
    } else if (deletingTask || deletingGroupId) {
      setDeletingTask(null);
      setDeletingGroupId(null);
    } else if (sprintDialogOpen) {
      setSprintDialogOpen(false);
    } else if (groupDialogOpen) {
      setGroupDialogOpen(false);
    } else if (dialogOpen) {
      setDialogOpen(false);
      setEditingTask(null);
      setHighlightRequiredFields(false);
    } else if (selectedGroupId) {
      setSelectedGroupId(null);
    } else if (selectedTaskId) {
      setSelectedTaskId(null);
    }
  }, [fullViewTaskId, deletingTask, deletingGroupId, sprintDialogOpen, groupDialogOpen, dialogOpen, selectedGroupId, selectedTaskId]);

  const isAnyOpen = useCallback(
    () => fullViewTaskId !== null || dialogOpen || sprintDialogOpen || groupDialogOpen || selectedTaskId !== null || selectedGroupId !== null || deletingTask !== null || deletingGroupId !== null,
    [fullViewTaskId, dialogOpen, sprintDialogOpen, groupDialogOpen, selectedTaskId, selectedGroupId, deletingTask, deletingGroupId]
  );

  useKeyboardShortcuts({
    onNewTask: handleOpenDialog,
    onSprintPlanner: handleOpenSprintDialog,
    onCloseAll: handleCloseAll,
    onToggleCompanion: companion.toggle,
    isAnyOpen,
  });

  // Auto-dismiss error toast
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(clearError, 5000);
    return () => clearTimeout(timer);
  }, [error, clearError]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header
        title={project.name === 'Default' ? 'Vibe Board' : project.name}
        theme={theme}
        toggleTheme={toggleTheme}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived(!showArchived)}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortByChange={setSortBy}
        onSortDirChange={setSortDir}
        activeAgentTypes={activeAgentTypes}
        activeStatuses={activeStatuses}
        onToggleAgentType={handleToggleAgentType}
        onToggleStatus={handleToggleStatus}
        onClearFilters={handleClearFilters}
        onNewTask={handleOpenDialog}
        onSprintPlanner={handleOpenSprintDialog}
        radio={radio}
      />

      <main className="flex-1 overflow-hidden">
        <Board
          tasks={filteredTasks}
          groups={groups}
          getTasksByColumn={getFilteredTasksByColumn}
          onMoveTask={moveTask}
          onTaskClick={handleTaskClick}
          onEditTask={handleEditTask}
          onDeleteTask={handleDeleteTask}
          onArchiveTask={handleArchiveTask}
          onUnarchiveTask={handleUnarchiveTask}
          onRetryTask={handleRetryTask}
          onExpandTask={handleExpandTask}
          onAddTask={handleOpenDialog}
          showArchived={showArchived}
          onDropInProgress={(task) => setSelectedTaskId(task.id)}
          onClickGroup={handleClickGroup}
          onRunGroup={runGroup}
          onStopGroup={stopGroup}
          onDeleteGroup={handleDeleteGroup}
          onEditGroup={handleEditGroup}
        />
      </main>

      <TaskDialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        onSubmit={handleCreateTask}
        editTask={editingTask}
        onEditSubmit={updateTask}
        highlightRequired={highlightRequiredFields}
        lockedRepoPath={lockedRepoPath}
        projectDefaults={projectDefaults}
      />

      <SprintPlannerDialog
        open={sprintDialogOpen}
        onClose={() => setSprintDialogOpen(false)}
        onSubmit={handleSprintPlan}
        lockedRepoPath={lockedRepoPath}
        projectId={project.id}
        projectDefaults={projectDefaults}
      />

      <TaskGroupDialog
        open={groupDialogOpen}
        onClose={() => { setGroupDialogOpen(false); setEditingGroup(null); }}
        onSubmit={handleCreateGroup}
        editGroup={editingGroup}
        onEditSubmit={handleEditGroupSubmit}
        lockedRepoPath={lockedRepoPath}
        projectDefaults={projectDefaults}
      />

      <AgentPanel task={selectedTask} onClose={handleClosePanel} onExpand={handleExpandTask} onRun={handleRunWithConfig} onStop={stopTask} onCreatePR={createPR} onMergeLocal={mergeLocal} onReconfigureRetry={handleReconfigureRetry} theme={theme} />

      <TaskFullView
        task={fullViewTask}
        onClose={handleCloseFullView}
        onMinimize={handleMinimizeFullView}
        onRun={handleRunWithConfig}
        onStop={stopTask}
        onEdit={handleEditTask}
        onDelete={handleDeleteTask}
        onArchive={handleArchiveTask}
        onUnarchive={handleUnarchiveTask}
        onCreatePR={createPR}
        onMergeLocal={mergeLocal}
        onReconfigureRetry={handleReconfigureRetry}
        theme={theme}
      />

      <GroupPanel
        group={selectedGroup}
        onClose={() => setSelectedGroupId(null)}
        onRunGroup={runGroup}
        onStopGroup={stopGroup}
        onRetryChild={handleRetryChild}
        onChildClick={handleChildClick}
      />

      <DeleteConfirmDialog
        open={deletingTask !== null || deletingGroupId !== null}
        taskTitle={deletingTask?.title ?? groups.find(g => g.id === deletingGroupId)?.title ?? ''}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />

      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="sticker fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full bg-card px-4 py-2 font-pixel text-[11px] text-destructive"
          >
            <PixelIcon name="alert-triangle-1" className="h-4 w-4 shrink-0 text-destructive" />
            <span>{error}</span>
            <button
              onClick={clearError}
              className="ml-1 shrink-0 font-pixel text-destructive hover:text-foreground"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Board Companion */}
      <BoardCompanion
        open={companion.open}
        onToggle={companion.toggle}
        messages={companion.messages}
        onSend={companion.sendMessage}
        streaming={companion.streaming}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Routing helpers
// ─────────────────────────────────────────────────────────────────────────────

type RouteState =
  | { view: 'home' }
  | { view: 'projects'; initialCreate?: ProjectDialogInitialValues }
  | { view: 'board'; projectId?: string };

function parseCreateQuery(search: string): ProjectDialogInitialValues {
  const params = new URLSearchParams(search);
  const repoUrl = params.get('repoUrl') ?? undefined;
  const repoPath = params.get('repoPath') ?? undefined;
  const sourceParam = params.get('source');
  const source: 'local' | 'repo' =
    sourceParam === 'repo' || sourceParam === 'local'
      ? sourceParam
      : repoUrl
        ? 'repo'
        : 'local';
  return {
    source,
    name: params.get('name') ?? undefined,
    repoUrl,
    repoPath,
    defaultAgentType: params.get('defaultAgentType') ?? undefined,
    defaultPriority: params.get('defaultPriority') ?? undefined,
    defaultBaseBranch: params.get('defaultBaseBranch') ?? undefined,
    autoSubmit: params.get('autostart') === '1',
  };
}

function readRoute(): RouteState {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { view: 'home' };
  if (path === '/projects/new') {
    return { view: 'projects', initialCreate: parseCreateQuery(window.location.search) };
  }
  if (path === '/projects') return { view: 'projects' };
  const match = path.match(/^\/projects\/([^/]+)$/);
  if (match) return { view: 'board', projectId: decodeURIComponent(match[1]) };
  return { view: 'home' };
}

// ─────────────────────────────────────────────────────────────────────────────
// App root
// ─────────────────────────────────────────────────────────────────────────────

export function App() {
  const { theme, toggleTheme } = useTheme();
  const {
    projects,
    config,
    loading,
    error,
    clearError,
    refreshProjects,
    createProject,
    updateProject,
    deleteProject,
    updateConfig,
    validateProjectPath,
    selectProjectDirectory,
  } = useProjects();

  const radio = useRadio();
  const [route, setRoute] = useState<RouteState>(() => readRoute());

  // Project-management dialog state (lifted out of ProjectsPage)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [createInitialValues, setCreateInitialValues] = useState<ProjectDialogInitialValues | null>(null);

  // Handle /projects/new deep-link: open the create dialog immediately
  useEffect(() => {
    if (route.view === 'projects' && route.initialCreate) {
      setEditingProject(null);
      setCreateInitialValues(route.initialCreate);
      setProjectDialogOpen(true);
    }
  }, [route]);

  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, '', path);
    setRoute(readRoute());
  }, []);

  const openProject = useCallback((project: Project) => {
    navigate(`/projects/${encodeURIComponent(project.id)}`);
  }, [navigate]);

  const defaultProject = useMemo(
    () => projects.find((p) => p.isDefault) ?? projects.find((p) => p.id === 'default') ?? projects[0],
    [projects],
  );

  const selectedProject = useMemo(() => {
    if (route.view === 'home') return null;
    // /projects or /projects/new → default to the default project (board stays visible)
    if (route.view === 'projects') return defaultProject;
    if (route.view === 'board' && route.projectId) return projects.find((p) => p.id === route.projectId);
    return defaultProject;
  }, [defaultProject, projects, route]);

  // ── Dialog handlers ──────────────────────────────────────────────────────

  function openCreateDialog() {
    setEditingProject(null);
    setCreateInitialValues(null);
    setProjectDialogOpen(true);
  }

  function openEditDialog(project: Project) {
    setEditingProject(project);
    setCreateInitialValues(null);
    setProjectDialogOpen(true);
  }

  function closeProjectDialog() {
    setProjectDialogOpen(false);
    setEditingProject(null);
    setCreateInitialValues(null);
    // If we landed here via /projects/new, return to root
    if (route.view === 'projects' && route.initialCreate) navigate('/');
  }

  async function handleProjectDialogSubmit(data: CreateProjectRequest | UpdateProjectRequest) {
    if (editingProject) return updateProject(editingProject.id, data);
    return createProject(data as CreateProjectRequest);
  }

  async function handleConfirmDeleteProject() {
    if (!deletingProject) return;
    await deleteProject(deletingProject.id);
    setDeletingProject(null);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Global visual effects ── */}
      <DitherBackground />
      <SakuraLeaves />
      <RainAnimation />

      {/* ── Left sidebar: project list ── */}
      {route.view !== 'home' && (
        <div className="relative z-10">
          <ProjectsSidebar
            projects={projects}
            selectedProjectId={selectedProject?.id}
            onSelectProject={openProject}
            onNewProject={openCreateDialog}
            onEditProject={openEditDialog}
            onDeleteProject={(p) => setDeletingProject(p)}
            onOpenSettings={() => setConfigOpen(true)}
            theme={theme}
            toggleTheme={toggleTheme}
            onGoHome={() => navigate('/')}
          />
        </div>
      )}

      {/* ── Right: board or empty state ── */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {loading && !selectedProject ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <PixelIcon
              name="loading-circle-1"
              className="h-8 w-8 animate-px-spin-fast text-neon-pink"
            />
            <span className="font-pixel text-[11px] lowercase text-muted-foreground">
              loading projects…
            </span>
          </div>
        ) : route.view === 'home' ? (
          <HomePage key="home" />
        ) : selectedProject ? (
          /* key ensures fresh local state when switching projects */
          <BoardPage
            key={selectedProject.id}
            project={selectedProject}
            theme={theme}
            toggleTheme={toggleTheme}
            radio={radio}
          />
        ) : (
          /* No projects at all */
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center p-8">
            <div
              className="sticker flex h-20 w-20 items-center justify-center rounded-[1.75rem]"
              style={{ backgroundColor: 'var(--color-neon-purple)', color: 'var(--color-ink)' }}
            >
              <PixelIcon name="home-2" className="h-10 w-10 animate-px-bob" />
            </div>
            <div>
              <h2 className="font-display text-2xl lowercase text-foreground">no projects yet</h2>
              <p className="mt-1.5 font-pixel text-[11px] lowercase text-muted-foreground">
                create a project to start an ai-powered board
              </p>
            </div>
            <button
              onClick={openCreateDialog}
              className="sticker-sm sticker-press flex h-11 items-center gap-2 rounded-full bg-primary px-6 font-display text-sm text-primary-foreground [text-transform:lowercase]"
            >
              <PixelIcon name="reward-gift" className="h-4 w-4" />
              new project
            </button>
          </div>
        )}
      </div>

      {/* ── Project management dialogs ── */}

      <ProjectDialog
        open={projectDialogOpen}
        project={editingProject}
        initialValues={createInitialValues}
        onClose={closeProjectDialog}
        onSubmit={handleProjectDialogSubmit}
        onValidatePath={validateProjectPath}
        onSelectDirectory={selectProjectDirectory}
      />

      <ConfigDialog
        open={configOpen}
        config={config}
        onClose={() => setConfigOpen(false)}
        onSubmit={updateConfig}
        onProjectsImported={refreshProjects}
      />

      <DeleteConfirmDialog
        open={deletingProject !== null}
        taskTitle={deletingProject?.name ?? ''}
        title="Delete project?"
        description={
          <p className="mb-5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{deletingProject?.name}</span> will be
            permanently deleted, along with all of its tasks and groups. This cannot be undone.
          </p>
        }
        onCancel={() => setDeletingProject(null)}
        onConfirm={handleConfirmDeleteProject}
      />

      {/* ── GitHub setup modal (shown on first load when no token is configured) ── */}
      <GitHubSetupModal onImported={refreshProjects} />

      {/* Global error toast (project-level errors from useProjects) */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="sticker fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full bg-card px-4 py-2 font-pixel text-[11px] text-destructive"
          >
            <PixelIcon name="alert-triangle-1" className="h-4 w-4 shrink-0 text-destructive" />
            <span>{error}</span>
            <button
              onClick={clearError}
              className="ml-1 shrink-0 font-pixel text-destructive hover:text-foreground"
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
