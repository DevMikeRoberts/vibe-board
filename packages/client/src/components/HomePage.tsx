import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { PixelIcon } from '@/components/PixelIcon';
import { DitheredTree } from '@/components/DitheredTree';
import { BoardCompanion } from '@/components/BoardCompanion';
import { useCompanion } from '@/hooks/useCompanion';
import { useProjects } from '@/hooks/useProjects';
import { api } from '@/lib/api';

interface Stats {
  totalTasks: number;
  completedTasks: number;
  activeTasks: number;
  projects: number;
}

export function HomePage() {
  const { projects } = useProjects();
  const companion = useCompanion();
  const [stats, setStats] = useState<Stats>({ totalTasks: 0, completedTasks: 0, activeTasks: 0, projects: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const tasks = await api.getTasks();
        const completed = tasks.filter(t => t.agentStatus === 'complete').length;
        const active = tasks.filter(t => t.agentStatus === 'executing' || t.agentStatus === 'planning').length;
        setStats({
          totalTasks: tasks.length,
          completedTasks: completed,
          activeTasks: active,
          projects: projects.length,
        });
      } catch (err) {
        console.error('Failed to fetch stats:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, [projects.length]);

  const statItems = useMemo(() => [
    { label: 'projects', value: stats.projects, icon: 'home-2' as const, color: 'neon-purple' },
    { label: 'total tasks', value: stats.totalTasks, icon: 'reward-gift' as const, color: 'neon-blue' },
    { label: 'completed', value: stats.completedTasks, icon: 'heart-like-circle' as const, color: 'neon-green' },
    { label: 'running', value: stats.activeTasks, icon: 'loading-circle-1' as const, color: 'neon-pink' },
  ], [stats]);

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden">
      {/* Dithered tree background */}
      <DitheredTree />

      {/* Gradient overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/40 to-background/80" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8 px-4">
        {/* Logo and title */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex flex-col items-center gap-4"
        >
          <div
            className="sticker flex h-24 w-24 items-center justify-center rounded-[2rem]"
            style={{ backgroundColor: 'var(--color-neon-purple)', color: 'var(--color-ink)' }}
          >
            <PixelIcon name="home-2" className="h-12 w-12 animate-px-bob" />
          </div>
          <h1 className="font-display text-4xl lowercase md:text-5xl bg-gradient-to-r from-neon-pink via-neon-purple to-neon-blue bg-clip-text text-transparent animate-px-gradient drop-shadow-[0_0_12px_rgba(232,54,143,0.3)]">
            vibe board
          </h1>
          <p className="font-pixel text-[11px] lowercase text-muted-foreground">
            your AI-powered coding workspace
          </p>
        </motion.div>

        {/* Stats grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          {statItems.map((stat) => (
            <div
              key={stat.label}
              className="sticker-sm sticker-peel flex flex-col items-center gap-1 rounded-xl bg-card px-4 py-3"
            >
              <PixelIcon name={stat.icon} className={`h-5 w-5 text-${stat.color}`} />
              <span className="font-display text-2xl text-foreground">
                {loading ? '—' : stat.value}
              </span>
              <span className="font-pixel text-[9px] lowercase text-muted-foreground">
                {stat.label}
              </span>
            </div>
          ))}
        </motion.div>

        {/* Enter button */}
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.4 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => window.location.href = '/projects/default'}
          className="sticker sticker-press flex h-14 items-center gap-3 rounded-full bg-primary px-8 font-display text-lg text-primary-foreground [text-transform:lowercase]"
        >
          <PixelIcon name="light-bulb" className="h-6 w-6" />
          enter the board
        </motion.button>

        {/* Quick links */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.6 }}
          className="flex gap-4"
        >
          <a
            href="/projects"
            className="font-pixel text-[10px] lowercase text-muted-foreground hover:text-foreground transition-colors"
          >
            [manage projects]
          </a>
          <span className="font-pixel text-[10px] text-muted-foreground/40">·</span>
          <button
            onClick={companion.toggle}
            className="font-pixel text-[10px] lowercase text-muted-foreground hover:text-foreground transition-colors"
          >
            [talk to companion]
          </button>
        </motion.div>
      </div>

      {/* Companion */}
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
