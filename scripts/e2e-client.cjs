const { spawn } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const child = spawn(isWindows ? 'npx vite --port 4176' : 'npx', isWindows ? [] : ['vite', '--port', '4176'], {
  cwd: path.join(repoRoot, 'packages', 'client'),
  env: {
    ...process.env,
    API_URL: 'http://localhost:3002',
    VITE_API_KEY: '',
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
