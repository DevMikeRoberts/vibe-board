const { chmodSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const hookPath = path.join(repoRoot, '.githooks', 'pre-push');

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

chmodSync(hookPath, 0o755);
console.log('Git hooks enabled with core.hooksPath .githooks');
