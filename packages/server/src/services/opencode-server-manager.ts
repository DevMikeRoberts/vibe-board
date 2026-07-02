import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import http from 'http';

const OPENCODE_PORT = 4096;
const HEALTH_CHECK_INTERVAL_MS = 5000;
const HEALTH_CHECK_TIMEOUT_MS = 2000;
const STARTUP_TIMEOUT_MS = 10000;

/**
 * Manages the OpenCode server lifecycle — starting, monitoring health,
 * and automatically restarting on failure.
 */
export class OpenCodeServerManager {
  private process: ChildProcess | null = null;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown = false;
  private onError: ((error: string) => void) | null = null;

  /**
   * Start the OpenCode server and set up health monitoring.
   * Returns a promise that resolves when the server is ready or rejects on startup failure.
   */
  async start(onError?: (error: string) => void): Promise<void> {
    if (this.process) {
      console.log('[opencode-server-manager] server already running');
      return;
    }

    this.isShuttingDown = false;
    this.onError = onError || null;

    // Determine the OpenCode command to run
    const command = process.env.OPENCODE_COMMAND || 'opencode';

    console.log(`[opencode-server-manager] starting OpenCode server on port ${OPENCODE_PORT} using command: ${command}`);

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(command, ['serve', '--port', OPENCODE_PORT.toString()], {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        });

        if (!this.process) {
          reject(new Error('Failed to spawn OpenCode process'));
          return;
        }

        const pid = this.process.pid;
        console.log(`[opencode-server-manager] spawned OpenCode server with PID ${pid}`);

        // Handle process exit
        this.process.on('exit', (code, signal) => {
          if (!this.isShuttingDown) {
            console.error(`[opencode-server-manager] OpenCode server exited with code ${code}, signal ${signal}`);
            this.process = null;
            this.stopHealthCheck();
            if (this.onError) {
              this.onError(`OpenCode server crashed: exit code ${code}`);
            }
          }
        });

        // Handle process error
        this.process.on('error', (err) => {
          console.error(`[opencode-server-manager] OpenCode process error:`, err);
          this.process = null;
          this.stopHealthCheck();
          if (this.onError) {
            this.onError(`OpenCode process error: ${err.message}`);
          }
        });

        // Log stdout/stderr
        this.process.stdout?.on('data', (data) => {
          console.log(`[opencode-server] ${data.toString().trim()}`);
        });

        this.process.stderr?.on('data', (data) => {
          console.warn(`[opencode-server] ${data.toString().trim()}`);
        });

        // Wait for server to be ready
        const startupTimer = setTimeout(() => {
          if (this.process) {
            console.error('[opencode-server-manager] server startup timeout — killing process');
            this.process.kill();
            this.process = null;
          }
          reject(new Error(`OpenCode server did not respond within ${STARTUP_TIMEOUT_MS}ms`));
        }, STARTUP_TIMEOUT_MS);

        // Poll for server readiness
        const checkReady = async () => {
          try {
            const isReady = await this.isServerReady();
            if (isReady) {
              clearTimeout(startupTimer);
              console.log('[opencode-server-manager] server is ready');
              this.startHealthCheck();
              resolve();
            }
          } catch {
            // Still starting, retry
          }
        };

        const readyCheckInterval = setInterval(checkReady, 200);
        checkReady().catch(() => {});

        // Cleanup interval if startup succeeds or fails
        setTimeout(() => clearInterval(readyCheckInterval), STARTUP_TIMEOUT_MS);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[opencode-server-manager] failed to start server:', message);
        this.process = null;
        reject(new Error(`Failed to start OpenCode server: ${message}`));
      }
    });
  }

  /**
   * Stop the OpenCode server and stop health monitoring.
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.stopHealthCheck();

    if (!this.process) {
      console.log('[opencode-server-manager] no server process running');
      return;
    }

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        if (this.process) {
          console.warn('[opencode-server-manager] server did not stop gracefully, force killing');
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 3000);

      this.process.on('exit', () => {
        clearTimeout(timeout);
        console.log('[opencode-server-manager] server stopped');
        this.process = null;
        resolve();
      });

      console.log('[opencode-server-manager] sending SIGTERM to server');
      this.process.kill('SIGTERM');
    });
  }

  /**
   * Check if the server is responding on the expected port.
   * Returns true if the server is healthy, false otherwise.
   * Tries multiple common endpoints to maximize compatibility.
   */
  private async isServerReady(): Promise<boolean> {
    // Try multiple common health check endpoints
    const endpoints = ['/health', '/api/health', '/status', '/', '/api/version'];

    for (const path of endpoints) {
      const isReady = await this.checkEndpoint(path);
      if (isReady) return true;
    }

    return false;
  }

  /**
   * Check a specific endpoint for server responsiveness.
   */
  private checkEndpoint(path: string): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        {
          hostname: 'localhost',
          port: OPENCODE_PORT,
          path,
          timeout: HEALTH_CHECK_TIMEOUT_MS,
        },
        (res) => {
          const isHealthy = res.statusCode && res.statusCode >= 200 && res.statusCode < 500;
          resolve(isHealthy);
        }
      );

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Start periodic health checks and automatic restart on failure.
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      return;
    }

    console.log('[opencode-server-manager] starting health checks');

    this.healthCheckTimer = setInterval(async () => {
      if (!this.process || this.isShuttingDown) {
        return;
      }

      try {
        const isHealthy = await this.isServerReady();
        if (!isHealthy) {
          console.warn('[opencode-server-manager] health check failed — restarting server');
          await this.restart();
        }
      } catch (err: unknown) {
        console.error('[opencode-server-manager] health check error:', err);
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Stop periodic health checks.
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      console.log('[opencode-server-manager] stopped health checks');
    }
  }

  /**
   * Restart the server after a failure.
   * Attempts to stop the current process and start a new one.
   */
  private async restart(): Promise<void> {
    console.log('[opencode-server-manager] restarting server');

    try {
      await this.stop();
      // Small delay before restart to avoid rapid cycling
      await new Promise((resolve) => setTimeout(resolve, 500));
      await this.start(this.onError || undefined);
      console.log('[opencode-server-manager] server restarted successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[opencode-server-manager] failed to restart server:', message);
      if (this.onError) {
        this.onError(`Failed to restart OpenCode server: ${message}`);
      }
    }
  }

  /**
   * Check if the server is currently running.
   */
  isRunning(): boolean {
    return this.process != null && !this.isShuttingDown;
  }
}

/**
 * Global instance of the OpenCode server manager.
 * This ensures only one server instance runs for all tasks.
 */
let globalServerManager: OpenCodeServerManager | null = null;

/**
 * Get or create the global OpenCode server manager instance.
 */
export function getOpenCodeServerManager(): OpenCodeServerManager {
  if (!globalServerManager) {
    globalServerManager = new OpenCodeServerManager();
  }
  return globalServerManager;
}

/**
 * Ensure the OpenCode server is running (idempotent).
 * Can be called multiple times without side effects.
 */
export async function ensureOpenCodeServer(onError?: (error: string) => void): Promise<void> {
  const manager = getOpenCodeServerManager();

  if (manager.isRunning()) {
    return;
  }

  await manager.start(onError);
}

/**
 * Stop the global OpenCode server.
 */
export async function stopOpenCodeServer(): Promise<void> {
  if (globalServerManager) {
    await globalServerManager.stop();
    globalServerManager = null;
  }
}
