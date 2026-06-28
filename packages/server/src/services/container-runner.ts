import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { Task, AgentEvent } from '../types.js';
import { errorMessage } from '../utils.js';

export interface ContainerRunnerConfig {
  /** Image to run per task (Claude agent + git). */
  image: string;
  /** Mount point of the shared data dir *inside the backend container* (e.g. /data). */
  dataDir: string;
  /** Host path that `dataDir` is bind-mounted from — needed so sibling containers
   *  (launched on the host daemon) can bind-mount the SAME workspace. */
  dataHostPath: string;
  anthropicApiKey: string;
  /** Optional model override passed to the Claude CLI. */
  model?: string;
  /** Hard timeout for a single container run. */
  timeoutMs: number;
}

export type ContainerEventSink = (type: AgentEvent['type'], content: string) => void;

export interface ContainerRunResult {
  status: 'complete' | 'failed';
  error?: string;
}

/**
 * Runs a task's agent inside an ephemeral Docker container against an isolated
 * per-task workspace, so work proceeds on an always-on host independent of any
 * developer laptop. The workspace is a self-contained clone of the project repo
 * (branch checked out, origin pointed at GitHub) living under the shared data
 * dir, so the backend can push it and feed it into the auto-PR/review pipeline.
 */
export class ContainerRunner {
  constructor(private cfg: ContainerRunnerConfig) {}

  private containerName(taskId: string): string {
    // Docker names allow [a-zA-Z0-9_.-]; task ids are uuids, which qualify.
    return `agentboard-task-${taskId}`;
  }

  /**
   * Create the isolated per-task workspace. Returns both the path as seen by the
   * backend (under dataDir) and the host path (for the sibling container mount).
   */
  prepareWorkspace(task: Task): { containerPath: string; hostPath: string } {
    if (!task.repoPath || !task.branchName) {
      throw new Error('container execution requires repoPath and branchName');
    }
    const baseBranch = task.baseBranch || 'main';

    // The source repo must have a pushable origin (GitHub) so the PR can be
    // opened after the agent commits.
    const originUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: task.repoPath, stdio: 'pipe',
    }).toString().trim();
    if (!originUrl) throw new Error('source repo has no "origin" remote to push to');

    const rel = path.join('tasks', task.id);
    const containerPath = path.join(this.cfg.dataDir, rel);
    const hostPath = path.join(this.cfg.dataHostPath, rel);

    // Reuse an existing workspace from a prior review round so a re-run builds on
    // the previous attempt (and the push to the PR branch fast-forwards instead
    // of being rejected as non-fast-forward).
    if (this.isValidWorkspace(containerPath, task.branchName)) {
      try { execFileSync('git', ['remote', 'set-url', 'origin', originUrl], { cwd: containerPath, stdio: 'pipe' }); } catch { /* keep existing */ }
      return { containerPath, hostPath };
    }

    // Fresh, self-contained clone (objects hardlink when on the same filesystem,
    // so this is fast even for large repos). Repoint origin at GitHub for push.
    fs.rmSync(containerPath, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(containerPath), { recursive: true });
    execFileSync('git', ['clone', '--branch', baseBranch, task.repoPath, containerPath], { stdio: 'pipe' });
    execFileSync('git', ['remote', 'set-url', 'origin', originUrl], { cwd: containerPath, stdio: 'pipe' });

    // If the task branch was already pushed in a prior round (and the workspace
    // was since lost), base on the remote branch so the next push fast-forwards
    // instead of being rejected as non-fast-forward.
    let basedOnRemote = false;
    try {
      execFileSync('git', ['fetch', 'origin', task.branchName], { cwd: containerPath, stdio: 'pipe' });
      execFileSync('git', ['checkout', '-B', task.branchName, `origin/${task.branchName}`], { cwd: containerPath, stdio: 'pipe' });
      basedOnRemote = true;
    } catch { /* no remote branch yet — branch from base */ }
    if (!basedOnRemote) {
      execFileSync('git', ['checkout', '-B', task.branchName], { cwd: containerPath, stdio: 'pipe' });
    }

    return { containerPath, hostPath };
  }

  /** True when `dir` is a git repo already checked out on `branch`. */
  private isValidWorkspace(dir: string, branch: string): boolean {
    try {
      if (!fs.existsSync(path.join(dir, '.git'))) return false;
      const current = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, stdio: 'pipe' }).toString().trim();
      return current === branch;
    } catch {
      return false;
    }
  }

  /**
   * Run the agent container. Streams stdout/stderr lines to `onEvent` and
   * resolves with the run status. Enforces the configured timeout.
   */
  run(
    task: Task,
    opts: { prompt: string; systemPrompt: string; hostWorkspacePath: string; onEvent: ContainerEventSink },
  ): Promise<ContainerRunResult> {
    // The mount source is handed to the host Docker daemon, which requires an
    // absolute path (a relative one is rejected or mounts the wrong directory).
    if (!path.isAbsolute(opts.hostWorkspacePath)) {
      return Promise.resolve({
        status: 'failed',
        error: `workspace host path must be absolute, got "${opts.hostWorkspacePath}" (set AGENTBOARD_DATA to an absolute path)`,
      });
    }

    const name = this.containerName(task.id);

    // Clean up any stale container with the same name (e.g. after a crash).
    try { execFileSync('docker', ['rm', '-f', name], { stdio: 'pipe' }); } catch { /* none */ }

    const args = [
      'run', '--rm', '--name', name,
      '-v', `${opts.hostWorkspacePath}:/repo`,
      // Name-only -e: the value is supplied via the spawned process env below so
      // the API key never appears in argv / `ps` / `docker inspect`.
      '-e', 'ANTHROPIC_API_KEY',
      '-e', `TASK_PROMPT=${opts.prompt}`,
      '-e', `CLAUDE_SYSTEM_PROMPT=${opts.systemPrompt}`,
      '-e', `TASK_TITLE=${task.title.replace(/[\r\n]+/g, ' ').slice(0, 200)}`,
    ];
    if (this.cfg.model) args.push('-e', `ANTHROPIC_MODEL=${this.cfg.model}`);
    args.push(this.cfg.image);

    return new Promise<ContainerRunResult>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: ContainerRunResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const child = spawn('docker', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ANTHROPIC_API_KEY: this.cfg.anthropicApiKey },
      });

      const emitLines = (buf: Buffer) => {
        for (const line of buf.toString().split(/\r?\n/)) {
          if (line.trim()) opts.onEvent('output', line);
        }
      };
      child.stdout.on('data', emitLines);
      child.stderr.on('data', emitLines);

      // Armed only when a positive timeout is configured (0 = no timeout).
      if (this.cfg.timeoutMs > 0) {
        timer = setTimeout(() => {
          opts.onEvent('error', `Agent container timed out after ${Math.round(this.cfg.timeoutMs / 1000)}s — terminating.`);
          this.kill(task.id);
          finish({ status: 'failed', error: 'container timed out' });
        }, this.cfg.timeoutMs);
      }

      child.on('error', (err) => finish({ status: 'failed', error: errorMessage(err) }));
      child.on('close', (code) =>
        finish(code === 0
          ? { status: 'complete' }
          : { status: 'failed', error: `agent container exited with code ${code}` }),
      );
    });
  }

  /** Best-effort: stop a running task container (used by stopAgent). */
  kill(taskId: string): void {
    try { execFileSync('docker', ['kill', this.containerName(taskId)], { stdio: 'pipe' }); } catch { /* not running */ }
  }
}
