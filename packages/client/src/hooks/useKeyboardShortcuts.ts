import { useEffect } from 'react';

interface ShortcutHandlers {
  onNewTask: () => void;
  onCloseAll: () => void;
  /** Return true if any dialog or panel is currently open */
  isAnyOpen: () => boolean;
}

export function useKeyboardShortcuts({ onNewTask, onCloseAll, isAnyOpen }: ShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in inputs/textareas
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape') {
        if (isAnyOpen()) {
          e.preventDefault();
          onCloseAll();
        }
        return;
      }

      if (e.key === 'n' || e.key === 'N') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey && !isAnyOpen()) {
          e.preventDefault();
          onNewTask();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNewTask, onCloseAll, isAnyOpen]);
}
