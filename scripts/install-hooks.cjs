const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

if (existsSync('.git')) {
  const result = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
    stdio: 'inherit',
  });
  if (result.error) console.error(result.error);
  process.exitCode = result.status ?? 1;
}
