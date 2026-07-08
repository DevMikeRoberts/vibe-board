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

/** Internal config shape — extends the public ProjectConfig with private fields. */
interface InternalConfig extends ProjectConfig {
  /** GitHub Personal Access Token stored by the user via the settings UI. */
  githubToken?: string;
}

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

function defaultInternalConfig(): InternalConfig {
  return {
    cloneRoot: path.join(getConfigHome(), 'projects'),
    autoPickupEnabled: false,
    tokenLimitRetryEnabled: false,
    tokenLimitFallbackMinutes: DEFAULT_TOKEN_LIMIT_FALLBACK_MINUTES,
    autoPrEnabled: true,
  };
}

/** Pull the optional behavior settings out of a parsed config blob, with clamping. */
function readSettings(raw: Partial<InternalConfig>): Pick<InternalConfig, 'autoPickupEnabled' | 'tokenLimitRetryEnabled' | 'tokenLimitFallbackMinutes' | 'autoPrEnabled'> {
  const fallback = Number(raw.tokenLimitFallbackMinutes);
  return {
    autoPickupEnabled: raw.autoPickupEnabled === true,
    tokenLimitRetryEnabled: raw.tokenLimitRetryEnabled === true,
    tokenLimitFallbackMinutes:
      Number.isFinite(fallback) && fallback > 0
        ? Math.min(Math.round(fallback), 24 * 60)
        : DEFAULT_TOKEN_LIMIT_FALLBACK_MINUTES,
    // Auto-PR defaults to ON: only an explicit `false` disables it.
    autoPrEnabled: raw.autoPrEnabled !== false,
  };
}

let cached: InternalConfig | null = null;

/** Load and cache the internal (private) config, ensuring all directories exist. */
function loadInternalConfig(): InternalConfig {
  if (cached) return cached;

  const home = getConfigHome();
  fs.mkdirSync(home, { recursive: true });

  const configPath = getConfigPath();
  let config = defaultInternalConfig();
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<InternalConfig>;
      if (raw && typeof raw.cloneRoot === 'string' && raw.cloneRoot.trim()) {
        config = {
          cloneRoot: path.resolve(expandTilde(raw.cloneRoot.trim())),
          ...readSettings(raw),
          ...(typeof raw.githubToken === 'string' && raw.githubToken.trim()
            ? { githubToken: raw.githubToken.trim() }
            : {}),
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

/** Atomically write the config file (temp file + rename) to avoid corruption. */
function writeConfig(config: InternalConfig): void {
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
 * Returns the public config (without the private GitHub token field).
 */
export function loadConfig(): ProjectConfig {
  const internal = loadInternalConfig();
  // Strip the private githubToken field from the public return value
  const { githubToken: _githubToken, ...publicConfig } = internal;
  return publicConfig;
}

export function getConfig(): ProjectConfig {
  return loadConfig();
}

export function getCloneRoot(): string {
  return loadInternalConfig().cloneRoot;
}

/**
 * Returns the active GitHub token.
 * Priority: GITHUB_TOKEN env var > stored token in config file.
 */
export function getGithubToken(): string | undefined {
  const envToken = process.env.GITHUB_TOKEN?.trim();
  if (envToken) return envToken;
  return loadInternalConfig().githubToken || undefined;
}

/**
 * Returns the source of the active GitHub token: 'env', 'config', or null.
 */
export function getGithubTokenSource(): 'env' | 'config' | null {
  if (process.env.GITHUB_TOKEN?.trim()) return 'env';
  if (loadInternalConfig().githubToken?.trim()) return 'config';
  return null;
}

/**
 * Store a GitHub token in the config file so it persists across restarts.
 * Pass an empty string to clear the stored token.
 */
export function setGithubToken(token: string): void {
  const current = loadInternalConfig();
  const trimmed = token.trim();
  const next: InternalConfig = { ...current };
  if (trimmed) {
    next.githubToken = trimmed;
  } else {
    delete next.githubToken;
  }
  writeConfig(next);
  cached = next;
}

/**
 * Update the clone root. The new path is expanded/resolved, created on disk, and
 * persisted to the config file. Returns the updated public config.
 */
export function setCloneRoot(cloneRoot: string): ProjectConfig {
  const trimmed = cloneRoot.trim();
  if (!trimmed) throw new Error('cloneRoot must be a non-empty string');
  const resolved = path.resolve(expandTilde(trimmed));
  if (!path.isAbsolute(resolved)) throw new Error('cloneRoot must be an absolute path');
  fs.mkdirSync(resolved, { recursive: true });
  const next: InternalConfig = { ...loadInternalConfig(), cloneRoot: resolved };
  writeConfig(next);
  cached = next;
  return loadConfig();
}

/**
 * Merge and persist behavior settings (auto-pickup, token-limit retry). Each
 * field is optional; only the provided ones change. `cloneRoot`, when provided,
 * is expanded/validated/created just like {@link setCloneRoot}. Returns the
 * updated public config (without the GitHub token).
 */
export function updateSettings(patch: Partial<ProjectConfig>): ProjectConfig {
  const next: InternalConfig = { ...loadInternalConfig() };

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
  if (patch.autoPrEnabled !== undefined) {
    next.autoPrEnabled = patch.autoPrEnabled === true;
  }

  writeConfig(next);
  cached = next;
  return loadConfig();
}
