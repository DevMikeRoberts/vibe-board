import { motion } from 'framer-motion';
import { PixelIcon } from './PixelIcon';

interface ThemeToggleProps {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

/** A pixel light-bulb: lit yellow in dark mode ("the arcade is on"),
 *  inked-out in light mode. Flips with a springy somersault on toggle. */
export function ThemeToggle({ theme, toggleTheme }: ThemeToggleProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.85, rotate: 180 }}
      transition={{ type: 'spring', stiffness: 380, damping: 16 }}
      onClick={toggleTheme}
      className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-border bg-card transition-colors hover:border-neon-yellow"
      aria-label="Toggle theme"
      title={theme === 'dark' ? 'Lights on' : 'Lights off'}
    >
      <PixelIcon
        name="light-bulb"
        className={theme === 'dark' ? 'h-5 w-5 text-neon-yellow' : 'h-5 w-5 text-foreground/70'}
      />
    </motion.button>
  );
}
