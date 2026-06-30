import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ProjectConfig } from './types.js';
import { errorMessage } from './utils.js';

/**
 * Agent Board persists its server-side configuration in a JSON file at a fixed
 * location (the "Agent Board home"). The clone root — where repos cloned from a
 * URL are placed — is configurable and defaults to `<home>/projects`.
 *
 * The config file deliberately lives at a fixed path (NOT inside the configurable
 * clone root) to avoid a chicken-and-egg problem: we must be able to read the
 * config before we know where the clone root is.
 */

const CONFIG_FILE_NAME = 'config.json';

function expandTilde(p: string): string {
  if (!p.startsWith('~')) return p;
  const rest = p.slice(p.startsWith('~/') || p.startsWith('~\\') ? 2 : 1);
  return path.join(os.homedir(), rest);
}

export function getConfigHome(): string {
  const override = process.env.AGENTBOARD_HOME?.trim();
  return override ? path.resolve(expandTilde(override)) : path.join(os.homedir(), 'agentboard');
}

function getConfigPath(): string {
  return path.join(getConfigHome(), CONFIG_FILE_NAME);
}

/** Default fallback delay before retrying a token-limited task, in minutes. */
export const DEFAULT_TOKEN_LIMIT_FALLBACK_MINUTES = 60;

function defaultConfig(): ProjectConfig {
  return {
    cloneRoot: path.join(getConfigHome(), 'projects'),
    autoPickupEnabled: false,
    tokenLimitRetryEnabled: false,
    tokenLimitFallbackMinutes: DEFAULT_TOKEN_LIMIT_FALLBACK_MINUTES,
  };
}

/** Pull the optional behavior settings out of a parsed config blob, with clamping. */
function readSettings(raw: Partial<ProjectConfig>): Pick<ProjectConfig, 'autoPickupEnabled' | 'tokenLimitRetryEnabled' | 'tokenLimitFallbackMinutes'> {
  const fallback = Number(raw.tokenLimitFallbackMinutes);
  return {
    autoPickupEnabled: raw.autoPickupEnabled === true,
    tokenLimitRetryEnabled: raw.tokenLimitRetryEnabled === true,
    tokenLimitFallbackMinutes:
      Number.isFinite(fallback) && fallback > 0
        ? Math.min(Math.round(fallback), 24 * 60)
        : DEFAULT_TOKEN_LIMIT_FALLBACK_MINUTES,
  };
}

let cached: ProjectConfig | null = null;

/** Atomically write the config file (temp file + rename) to avoid corruption. */
function writeConfig(config: ProjectConfig): void {
  const home = getConfigHome();
  fs.mkdirSync(home, { recursive: true });
  const target = getConfigPath();
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, target);
}

/**
 * Load (and if necessary create) the Agent Board config. Ensures the home
 * directory, the config file, and the clone root directory all exist.
 */
export function loadConfig(): ProjectConfig {
  if (cached) return cached;

  const home = getConfigHome();
  fs.mkdirSync(home, { recursive: true });

  const configPath = getConfigPath();
  let config = defaultConfig();
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<ProjectConfig>;
      if (raw && typeof raw.cloneRoot === 'string' && raw.cloneRoot.trim()) {
        config = {
          cloneRoot: path.resolve(expandTilde(raw.cloneRoot.trim())),
          ...readSettings(raw),
        };
      } else {
        writeConfig(config);
      }
    } catch (err) {
      console.warn(`[config] failed to read ${configPath}, using defaults: ${errorMessage(err)}`);
      writeConfig(config);
    }
  } else {
    writeConfig(config);
  }

  fs.mkdirSync(config.cloneRoot, { recursive: true });
  cached = config;
  return config;
}

export function getConfig(): ProjectConfig {
  return cached ?? loadConfig();
}

export function getCloneRoot(): string {
  return getConfig().cloneRoot;
}

/**
 * Update the clone root. The new path is expanded/resolved, created on disk, and
 * persisted to the config file. Returns the updated config.
 */
export function setCloneRoot(cloneRoot: string): ProjectConfig {
  const trimmed = cloneRoot.trim();
  if (!trimmed) throw new Error('cloneRoot must be a non-empty string');
  const resolved = path.resolve(expandTilde(trimmed));
  if (!path.isAbsolute(resolved)) throw new Error('cloneRoot must be an absolute path');
  fs.mkdirSync(resolved, { recursive: true });
  const next: ProjectConfig = { ...getConfig(), cloneRoot: resolved };
  writeConfig(next);
  cached = next;
  return next;
}

/**
 * Merge and persist behavior settings (auto-pickup, token-limit retry). Each
 * field is optional; only the provided ones change. `cloneRoot`, when provided,
 * is expanded/validated/created just like {@link setCloneRoot}. Returns the
 * updated config.
 */
export function updateSettings(patch: Partial<ProjectConfig>): ProjectConfig {
  const current = getConfig();
  const next: ProjectConfig = { ...current };

  if (patch.cloneRoot !== undefined) {
    const trimmed = String(patch.cloneRoot).trim();
    if (!trimmed) throw new Error('cloneRoot must be a non-empty string');
    const resolved = path.resolve(expandTilde(trimmed));
    if (!path.isAbsolute(resolved)) throw new Error('cloneRoot must be an absolute path');
    fs.mkdirSync(resolved, { recursive: true });
    next.cloneRoot = resolved;
  }
  if (patch.autoPickupEnabled !== undefined) {
    next.autoPickupEnabled = patch.autoPickupEnabled === true;
  }
  if (patch.tokenLimitRetryEnabled !== undefined) {
    next.tokenLimitRetryEnabled = patch.tokenLimitRetryEnabled === true;
  }
  if (patch.tokenLimitFallbackMinutes !== undefined) {
    const n = Number(patch.tokenLimitFallbackMinutes);
    if (!Number.isFinite(n) || n <= 0) throw new Error('tokenLimitFallbackMinutes must be a positive number');
    next.tokenLimitFallbackMinutes = Math.min(Math.round(n), 24 * 60);
  }

  writeConfig(next);
  cached = next;
  return next;
}
