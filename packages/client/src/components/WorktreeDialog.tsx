import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, GitBranch } from 'lucide-react';
import type { Task, AgentType } from '@/types';
import { api, type AgentInfo } from '@/lib/api';
import { AGENT_DISPLAY } from '@/lib/agent-config';
import { cn } from '@/lib/utils';

interface WorktreeDialogProps {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  onSubmit: (config: {
    repoPath: string;
    branchName: string;
    baseBranch: string;
    useWorktree: boolean;
    agentType?: AgentType;
  }) => void;
}

const LS_REPO_KEY = 'kanban-last-repo-path';
const LS_BASE_BRANCH_KEY = 'kanban-last-base-branch';
const LS_WORKTREE_KEY = 'kanban-last-use-worktree';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function WorktreeDialog({ open, task, onClose, onSubmit }: WorktreeDialogProps) {
  const [repoPath, setRepoPath] = useState('');
  const [branchName, setBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [useWorktree, setUseWorktree] = useState(true);
  const [agentType, setAgentType] = useState<AgentType>('copilot');
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  // Fetch available agents on mount
  useEffect(() => {
    if (open) api.getAgents().then(setAgents).catch(console.error);
  }, [open]);

  // Initialize fields when dialog opens
  useEffect(() => {
    if (!open || !task) return;
    const lastRepo = localStorage.getItem(LS_REPO_KEY) || '';
    const lastBaseBranch = localStorage.getItem(LS_BASE_BRANCH_KEY) || 'main';
    const lastWorktree = localStorage.getItem(LS_WORKTREE_KEY);
    setRepoPath(task.repoPath || lastRepo);
    setBranchName(task.branchName || `task/${slugify(task.title)}`);
    setBaseBranch(task.baseBranch || lastBaseBranch);
    setUseWorktree(task.useWorktree ?? (lastWorktree !== null ? lastWorktree === 'true' : true));
    setAgentType(task.agentType || 'copilot');
  }, [open, task]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoPath.trim()) return;
    localStorage.setItem(LS_REPO_KEY, repoPath.trim());
    localStorage.setItem(LS_BASE_BRANCH_KEY, baseBranch.trim());
    localStorage.setItem(LS_WORKTREE_KEY, String(useWorktree));
    onSubmit({
      repoPath: repoPath.trim(),
      branchName: branchName.trim(),
      baseBranch: baseBranch.trim(),
      useWorktree,
      agentType,
    });
  };

  return (
    <AnimatePresence>
      {open && task && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold">Configure Agent Run</h2>
              </div>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground mb-4">
              Running: <span className="font-medium text-foreground">{task.title}</span>
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Repo path */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Local Repository Path
                </label>
                <input
                  type="text"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="~/projects/my-app"
                  autoFocus
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Agent selector */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Agent
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(agents.length > 0 ? agents : [
                    { name: 'copilot' as AgentType, displayName: 'GitHub Copilot', available: true },
                    { name: 'claude' as AgentType, displayName: 'Claude Code', available: false, reason: 'Loading...' },
                    { name: 'codex' as AgentType, displayName: 'OpenAI Codex', available: false, reason: 'Loading...' },
                  ]).map((agent) => (
                    <button
                      key={agent.name}
                      type="button"
                      disabled={!agent.available}
                      title={agent.available ? agent.displayName : agent.reason}
                      onClick={() => setAgentType(agent.name)}
                      className={cn(
                        'flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
                        agentType === agent.name && agent.available
                          ? 'border-primary bg-primary/10 text-primary'
                          : agent.available
                            ? 'border-border bg-background text-foreground hover:border-primary/30'
                            : 'border-border bg-muted/50 text-muted-foreground/50 cursor-not-allowed'
                      )}
                    >
                      <span className="text-sm">
                        {AGENT_DISPLAY[agent.name]?.emoji}
                      </span>
                      <span className="truncate">{agent.displayName.split(' ').pop()}</span>
                    </button>
                  ))}
                </div>
                {agents.find((a) => a.name === agentType && !a.available) && (
                  <p className="mt-1 text-[11px] text-amber-400">
                    {agents.find((a) => a.name === agentType)?.reason}
                  </p>
                )}
              </div>

              {/* Branch name */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Branch Name
                </label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="task/my-feature"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Base branch */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Base Branch
                </label>
                <input
                  type="text"
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  placeholder="main"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Use worktree checkbox */}
              <label className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors">
                <input
                  type="checkbox"
                  checked={useWorktree}
                  onChange={(e) => setUseWorktree(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <div>
                  <span className="text-sm font-medium">Create git worktree</span>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {useWorktree
                      ? 'Agent runs in an isolated worktree directory — safe for concurrent tasks'
                      : 'Agent runs directly in the repo — use for solo tasks only'}
                  </p>
                </div>
              </label>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!repoPath.trim()}
                  className={cn(
                    'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                    'bg-primary text-primary-foreground hover:bg-primary/90',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  Start Agent
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
