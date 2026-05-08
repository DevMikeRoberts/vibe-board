import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function isAbsoluteRepoPath(repoPath: string): boolean {
  const value = repoPath.trim();
  return value.startsWith('/')
    || value.startsWith('~')
    || /^[a-zA-Z]:[\\/]/.test(value)
    || /^\\\\[^\\/]+[\\/][^\\/]+/.test(value);
}

export function getRepoPathPlaceholder(): string {
  return isWindowsBrowser() ? 'D:\\git\\ai-agent-board' : '/host-projects/my-app';
}

export function getRepoPathHelpText(): string {
  return isWindowsBrowser()
    ? 'Example: D:\\git\\ai-agent-board or \\\\server\\share\\repo'
    : 'Example: /host-projects/my-app or ~/projects/my-app';
}

function isWindowsBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;

  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = navigatorWithUserAgentData.userAgentData?.platform
    || navigator.platform
    || navigator.userAgent;

  return /win/i.test(platform);
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}
