import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronDown,
} from 'lucide-react';
import type { Task, ColumnId, AgentType } from '@/types';
import { AGENT_DISPLAY } from '@/lib/agent-config';
import { cn } from '@/lib/utils';

interface TaskDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (task: { title: string; description: string; priority: 'medium'; columnId: ColumnId; agentType: AgentType; autoRun?: boolean }) => void;
  /** When set, dialog is in edit mode with pre-populated fields */
  editTask?: Task | null;
  /** Called on save in edit mode */
  onEditSubmit?: (id: string, updates: { title: string; description: string; agentType: AgentType }) => void;
}

const agents: { value: AgentType; label: string; emoji: string }[] = (
  Object.entries(AGENT_DISPLAY) as [AgentType, { emoji: string; label: string }][]
).map(([value, { emoji, label }]) => ({ value, label, emoji }));

export function TaskDialog({ open, onClose, onSubmit, editTask, onEditSubmit }: TaskDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('copilot');
  const [showAgent, setShowAgent] = useState(false);
  const [autoRun, setAutoRun] = useState(false);

  const isEditMode = !!editTask;

  // Pre-populate fields when editing
  useEffect(() => {
    if (editTask && open) {
      setTitle(editTask.title);
      setDescription(editTask.description);
      setAgentType(editTask.agentType || 'copilot');
    } else if (!open) {
      // Reset when dialog closes
      setTitle('');
      setDescription('');
      setAgentType('copilot');
      setShowAgent(false);
      setAutoRun(false);
    }
  }, [editTask, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (isEditMode && onEditSubmit) {
      onEditSubmit(editTask!.id, {
        title: title.trim(),
        description: description.trim(),
        agentType,
      });
    } else {
      onSubmit({
        title: title.trim(),
        description: description.trim(),
        priority: 'medium',
        columnId: autoRun ? 'in-progress' : 'backlog',
        agentType,
        autoRun: autoRun || undefined,
      });
    }
    setTitle('');
    setDescription('');
    setAgentType('copilot');
    setAutoRun(false);
    onClose();
  };

  // Close dropdowns on outside click
  const agentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showAgent) return;
    const handleClick = (e: MouseEvent) => {
      if (showAgent && agentRef.current && !agentRef.current.contains(e.target as Node)) {
        setShowAgent(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showAgent]);

  const selectedAgent = agents.find((a) => a.value === agentType)!;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Dialog */}
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold">{isEditMode ? 'Edit Task' : 'Create Task'}</h2>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Title */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What needs to be done?"
                  autoFocus
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the task for the Copilot agent..."
                  rows={4}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Agent */}
              <div className="relative" ref={agentRef}>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Agent
                </label>
                <button
                  type="button"
                  onClick={() => setShowAgent(!showAgent)}
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-accent transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span>{selectedAgent.emoji}</span>
                    {selectedAgent.label}
                  </span>
                  <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', showAgent && 'rotate-180')} />
                </button>

                <AnimatePresence>
                  {showAgent && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
                    >
                      {agents.map((a) => (
                        <button
                          key={a.value}
                          type="button"
                          onClick={() => {
                            setAgentType(a.value);
                            setShowAgent(false);
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors',
                            agentType === a.value && 'bg-accent'
                          )}
                        >
                          <span>{a.emoji}</span>
                          {a.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Auto-run (create mode only) */}
              {!isEditMode && (
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={autoRun}
                    onChange={(e) => setAutoRun(e.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
                  />
                  <span className="text-sm text-muted-foreground">
                    Auto-run — start agent immediately after creating
                  </span>
                </label>
              )}

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
                  disabled={!title.trim()}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isEditMode ? 'Save Changes' : 'Create Task'}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
