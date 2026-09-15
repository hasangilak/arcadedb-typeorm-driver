const { spawnSync } = require('node:child_process');

function compose(args) {
  const result = spawnSync('docker', ['compose', '-p', 'arcadedb-typeorm-test', ...args], { stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}

let status = 1;
try {
  status = compose(['run', '--build', '--rm', 'tests']);
} finally {
  const cleanup = compose(['down', '--volumes', '--remove-orphans']);
  process.exitCode = status || cleanup;
}
