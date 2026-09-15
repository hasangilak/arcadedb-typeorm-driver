const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = resolve(__dirname, '..');
function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180000,
    });
  } catch (error) {
    throw new Error(
      `${command} ${args.join(' ')} failed\n${error.stdout ?? ''}\n${error.stderr ?? ''}`,
      { cause: error },
    );
  }
}

test('clean source, tarball and pinned Git installs work in external consumers', () => {
  const temp = mkdtempSync(join(tmpdir(), 'arcadedb-package-'));
  try {
    const source = join(temp, 'source');
    const consumer = join(temp, 'consumer');
    mkdirSync(source);
    mkdirSync(consumer);
    // No dist and no repository files: exercise the source-install lifecycle.
    for (const file of [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'src',
      'scripts',
      'README.md',
      'LICENSE',
    ])
      cpSync(join(root, file), join(source, file), { recursive: true });
    symlinkSync(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
    run('npm', ['run', 'prepare'], source);
    assert.ok(
      existsSync(join(source, 'dist/index.js')),
      'prepare must build clean source installs',
    );
    const output = run('npm', ['pack', '--json', '--pack-destination', temp], source);
    const [packed] = JSON.parse(output.slice(output.indexOf('[\n')));
    const files = packed.files.map((file) => file.path);
    for (const required of ['dist/index.js', 'dist/index.d.ts', 'LICENSE', 'README.md'])
      assert.ok(files.includes(required), required);
    assert.ok(!files.some((file) => /^(test|node_modules|\.git|demo)\//.test(file)));
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({ name: 'arcadedb-external-consumer', version: '1.0.0', private: true }),
    );
    const tarball = join(temp, packed.filename);
    run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', tarball], consumer);
    const installed = join(consumer, 'node_modules', 'arcadedb-typeorm-driver');
    assert.ok(!existsSync(join(installed, 'src')));
    assert.ok(
      !existsSync(join(consumer, 'node_modules', 'typescript')),
      'runtime installation needs no compiler',
    );
    const commonjs = `const { ArcadeDataSource } = require('arcadedb-typeorm-driver');
      const { DataSource } = require('typeorm');
      const db = new ArcadeDataSource({ database: 'consumer', username: 'root', password: 'test' });
      require('node:assert/strict').ok(db instanceof DataSource);`;
    run(process.execPath, ['--eval', commonjs], consumer);
    cpSync(join(root, 'test/package-consumer.mts'), join(consumer, 'consumer.mts'));
    const dependencies = JSON.parse(readFileSync(join(root, 'package.json'))).devDependencies;
    run(
      'npm',
      [
        'install',
        '--include=dev',
        '--save-dev',
        '--no-audit',
        '--no-fund',
        `typescript@${dependencies.typescript}`,
        `@types/node@${dependencies['@types/node']}`,
      ],
      consumer,
    );
    run(
      process.execPath,
      [
        join(consumer, 'node_modules/typescript/bin/tsc'),
        '--strict',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        'consumer.mts',
      ],
      consumer,
    );
    run(process.execPath, ['consumer.mjs'], consumer);
    // A fresh Git install must build tracked source, not reuse the tarball's dist.
    run('git', ['init', '--quiet'], source);
    run(
      'git',
      [
        'add',
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'src',
        'scripts',
        'README.md',
        'LICENSE',
      ],
      source,
    );
    run(
      'git',
      [
        '-c',
        'user.name=Package Test',
        '-c',
        'user.email=package-test@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'Package fixture',
      ],
      source,
    );
    const commit = run('git', ['rev-parse', 'HEAD'], source).trim();
    const gitConsumer = join(temp, 'git-consumer');
    mkdirSync(gitConsumer);
    writeFileSync(
      join(gitConsumer, 'package.json'),
      JSON.stringify({ name: 'git-consumer', version: '1.0.0', private: true }),
    );
    run(
      'npm',
      [
        'install',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        `git+${pathToFileURL(source).href}#${commit}`,
      ],
      gitConsumer,
    );
    run(process.execPath, ['--eval', commonjs], gitConsumer);
    cpSync(join(consumer, 'consumer.mjs'), join(gitConsumer, 'consumer.mjs'));
    run(process.execPath, ['consumer.mjs'], gitConsumer);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
