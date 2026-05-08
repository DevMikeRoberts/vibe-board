const { mkdirSync, rmSync } = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const dbPath = path.join(repoRoot, 'packages', 'e2e', 'test-results', 'agentboard-e2e.db');
const allowedRepoRoots = [
  repoRoot,
  process.env.TEMP,
  process.env.TMP,
  process.env.TMPDIR,
].filter(Boolean).join(',');

mkdirSync(path.dirname(dbPath), { recursive: true });
rmSync(dbPath, { force: true });

const child = spawn(isWindows ? 'npx tsx src/index.ts' : 'npx', isWindows ? [] : ['tsx', 'src/index.ts'], {
  cwd: path.join(repoRoot, 'packages', 'server'),
  env: {
    ...process.env,
    PORT: '3002',
    DATABASE_URL: '',
    DB_PATH: dbPath,
    API_KEY: '',
    ALLOWED_ORIGINS: 'http://localhost:4176',
    ALLOWED_REPO_ROOTS: allowedRepoRoots,
  },
  shell: isWindows,
  stdio: 'inherit',
});

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
