const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Table, TableColumn, TableIndex, TableUnique } = require('typeorm');
const { ArcadeDataSource } = require('../dist');
const options = {
  url: process.env.ARCADEDB_URL ?? 'http://127.0.0.1:2480',
  database: process.env.ARCADEDB_DATABASE ?? 'driver_test',
  username: process.env.ARCADEDB_USERNAME ?? 'root',
  password: process.env.ARCADEDB_PASSWORD ?? 'integration-password',
  migrationsTableName: 'test_schema_migrations',
};

test('TypeORM migration execution, history, no-op rerun and revert', async (t) => {
  class Basic1800000000000 {
    async up(q) { await q.createTable(new Table({ name: 'migration_basic', columns: [{ name: 'id', type: 'string', isPrimary: true }] })); }
    async down(q) { await q.dropTable('migration_basic'); }
  }
  const source = await new ArcadeDataSource({ ...options, migrations: [Basic1800000000000] }).initialize();
  t.after(() => source.destroy());
  assert.equal(await source.showMigrations(), true);
  assert.equal((await source.runMigrations()).length, 1);
  assert.equal(await source.showMigrations(), false);
  assert.equal((await source.runMigrations()).length, 0);
  const history = await source.query('SELECT FROM test_schema_migrations');
  assert.equal(history[0].timestamp, 1800000000000);
  assert.equal(history[0].name, 'Basic1800000000000');
  await source.undoLastMigration();
  assert.equal(await source.showMigrations(), true);
  assert.deepEqual(await source.query('SELECT FROM test_schema_migrations'), []);
});

test('QueryRunner schema mutations preserve data and expose refreshed metadata', async (t) => {
  const source = await new ArcadeDataSource(options).initialize();
  const q = source.createQueryRunner();
  t.after(async () => { await q.release(); await source.destroy(); });
  await q.createTable(new Table({ name: 'migration_schema', columns: [{ name: 'id', type: 'string', isPrimary: true }] }));
  await q.query('INSERT INTO migration_schema SET id = :p0', ['a']);
  await q.addColumns('migration_schema', [new TableColumn({ name: 'email', type: 'string', isNullable: true }), new TableColumn({ name: 'obsolete', type: 'integer', isNullable: true })]);
  await q.query('UPDATE migration_schema SET email = :p0, obsolete = 12', ['a@example.test']);
  await q.changeColumn('migration_schema', 'email', new TableColumn({ name: 'email', type: 'string', isNullable: false }));
  await q.createUniqueConstraint('migration_schema', new TableUnique({ name: 'uq_migration_email', columnNames: ['email'] }));
  await q.createIndex('migration_schema', new TableIndex({ name: 'idx_migration_obsolete', columnNames: ['obsolete'] }));
  assert.equal((await q.getTable('migration_schema')).findColumnByName('email').isNullable, false);
  assert.ok((await q.getTable('migration_schema')).uniques.some(u => u.name === 'uq_migration_email'));
  await assert.rejects(q.query('INSERT INTO migration_schema SET id = :p0, email = :p1', ['b', 'a@example.test']), /duplicat/i);
  await q.dropIndex('migration_schema', 'idx_migration_obsolete');
  await q.dropColumn('migration_schema', 'obsolete');
  assert.equal((await q.query('SELECT FROM migration_schema'))[0].obsolete, undefined);
  await q.renameTable('migration_schema', 'migration_schema_renamed');
  assert.equal(await q.hasTable('migration_schema'), false);
  assert.equal((await q.query('SELECT FROM migration_schema_renamed'))[0].id, 'a');
  await q.dropUniqueConstraint('migration_schema_renamed', 'uq_migration_email');
  await q.dropTable('migration_schema_renamed');
});
