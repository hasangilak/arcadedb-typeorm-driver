const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Table, TableColumn, TableIndex, TableUnique } = require('typeorm');
const { ArcadeDataSource } = require('../dist');
const options = {
  url: process.env.ARCADEDB_URL ?? 'http://127.0.0.1:2480',
  database: process.env.ARCADEDB_DATABASE ?? 'driver_test',
  username: process.env.ARCADEDB_USERNAME ?? 'root',
  password: process.env.ARCADEDB_PASSWORD ?? 'integration-password',
  migrationsTableName: 'test_schema_migrations',
};

test('unsupported schema APIs reject explicitly and do not alter the database', async (t) => {
  const { TableForeignKey, TableCheck, TableExclusion, View } = require('typeorm');
  const database = 'unsupported_test_' + randomUUID().replaceAll('-', '');
  const db = await new ArcadeDataSource({
    ...options,
    database,
    createDatabase: true,
  }).initialize();
  const q = db.createQueryRunner();
  t.after(async () => {
    await q.release();
    await db.destroy();
    await db.driver.request('server', { command: 'drop database ' + database });
  });
  const before = await db.query('SELECT name FROM schema:types ORDER BY name');
  const foreignKey = new TableForeignKey({
    columnNames: ['account_id'],
    referencedTableName: 'accounts',
    referencedColumnNames: ['id'],
  });
  const check = new TableCheck({ name: 'positive', expression: 'quantity > 0' });
  const exclusion = new TableExclusion({ name: 'exclusive', expression: 'id WITH =' });
  const cases = [
    ['createDatabase', ['unsupported_db']],
    ['dropDatabase', ['unsupported_db']],
    ['createSchema', ['public']],
    ['dropSchema', ['public']],
    ['createView', [new View({ name: 'unsupported_view', expression: 'SELECT 1' })]],
    ['dropView', ['unsupported_view']],
    ['renameColumn', ['unused', 'before', 'after']],
    ['changeTableComment', ['unused', 'comment']],
    ['createForeignKey', ['unused', foreignKey]],
    ['createForeignKeys', ['unused', [foreignKey]]],
    ['dropForeignKey', ['unused', foreignKey]],
    ['dropForeignKeys', ['unused', [foreignKey]]],
    ['createCheckConstraint', ['unused', check]],
    ['createCheckConstraints', ['unused', [check]]],
    ['dropCheckConstraint', ['unused', check]],
    ['dropCheckConstraints', ['unused', [check]]],
    ['createExclusionConstraint', ['unused', exclusion]],
    ['createExclusionConstraints', ['unused', [exclusion]]],
    ['dropExclusionConstraint', ['unused', exclusion]],
    ['dropExclusionConstraints', ['unused', [exclusion]]],
    ['clearDatabase', []],
    ['stream', ['SELECT 1']],
    [
      'createTable',
      [
        new Table({
          name: 'unsupported_table',
          columns: [
            { name: 'id', type: 'integer', isGenerated: true, generationStrategy: 'increment' },
          ],
        }),
      ],
    ],
    [
      'createTable',
      [
        new Table({
          name: 'unsupported_table',
          columns: [{ name: 'id', type: 'string' }],
          foreignKeys: [foreignKey],
        }),
      ],
    ],
    [
      'createTable',
      [
        new Table({
          name: 'unsupported_table',
          columns: [{ name: 'id', type: 'string' }],
          checks: [check],
        }),
      ],
    ],
  ];
  for (const [index, [method, args]] of cases.entries()) {
    await t.test(`${method} ${index}`, async () => {
      await assert.rejects(q[method](...args), /not supported/i);
    });
  }
  assert.deepEqual(await db.query('SELECT name FROM schema:types ORDER BY name'), before);
});

test('primary-key updates can create, preserve and remove keys without losing the old constraint on failure', async (t) => {
  const db = await new ArcadeDataSource(options).initialize();
  const q = db.createQueryRunner();
  t.after(async () => {
    await q.dropTable('migration_keys', true);
    await q.release();
    await db.destroy();
  });
  await q.createTable(
    new Table({
      name: 'migration_keys',
      columns: [
        { name: 'id', type: 'string' },
        { name: 'group_id', type: 'string' },
      ],
    }),
  );
  await q.query("INSERT INTO migration_keys SET id = 'a', group_id = 'same'");
  await q.query("INSERT INTO migration_keys SET id = 'b', group_id = 'same'");
  const id = new TableColumn({ name: 'id', type: 'string', isPrimary: true });
  await q.updatePrimaryKeys('migration_keys', [id]);
  assert.deepEqual(
    (await q.getTable('migration_keys')).primaryColumns.map((c) => c.name),
    ['id'],
  );
  await q.updatePrimaryKeys('migration_keys', [id]);
  await assert.rejects(
    q.updatePrimaryKeys('migration_keys', [
      new TableColumn({ name: 'group_id', type: 'string', isPrimary: true }),
    ]),
    /duplicat/i,
  );
  await assert.rejects(
    q.query("INSERT INTO migration_keys SET id = 'a', group_id = 'other'"),
    /duplicat/i,
  );
  await q.updatePrimaryKeys('migration_keys', []);
  assert.deepEqual((await q.getTable('migration_keys')).primaryColumns, []);
  await q.createPrimaryKey('migration_keys', ['id'], 'custom_migration_pk');
  await q.updatePrimaryKeys('migration_keys', [id]);
  assert.equal(
    (await q.getTable('migration_keys')).primaryColumns[0].primaryKeyConstraintName,
    'custom_migration_pk',
  );
});

test('transaction modes, failed history entries and fake execution/revert', async (t) => {
  class FailingData1800000000100 {
    async up(q) {
      await q.query("INSERT INTO migration_tx SET id = 'inserted'");
      throw new Error('intentional data failure');
    }
    async down() {
      throw new Error('fake revert must not execute down');
    }
  }
  const db = await new ArcadeDataSource({
    ...options,
    migrationsTableName: 'test_tx_migrations',
    migrations: [FailingData1800000000100],
  }).initialize();
  const q = db.createQueryRunner();
  t.after(async () => {
    await q.dropTable('migration_tx', true);
    await q.dropTable('test_tx_migrations', true);
    await q.release();
    await db.destroy();
  });
  await q.createTable(
    new Table({ name: 'migration_tx', columns: [{ name: 'id', type: 'string', isPrimary: true }] }),
  );
  for (const mode of ['all', 'each', 'none']) {
    await assert.rejects(db.runMigrations({ transaction: mode }), /intentional data failure/);
    assert.equal(
      (await db.query('SELECT count(*) AS n FROM migration_tx'))[0].n,
      mode === 'none' ? 1 : 0,
    );
    assert.deepEqual(await db.query('SELECT FROM test_tx_migrations'), []);
    await q.clearTable('migration_tx');
  }
  await db.runMigrations({ fake: true });
  assert.equal(await db.showMigrations(), false);
  await db.undoLastMigration({ fake: true });
  assert.equal(await db.showMigrations(), true);
});

test('DDL in transaction fails before mutation; nontransactional failures leave recoverable schema', async (t) => {
  class FailingDDL1800000000200 {
    async up(q) {
      await q.createTable(
        new Table({ name: 'migration_partial', columns: [{ name: 'id', type: 'string' }] }),
      );
      throw new Error('intentional schema failure');
    }
    async down(q) {
      await q.dropTable('migration_partial');
    }
  }
  const db = await new ArcadeDataSource({
    ...options,
    migrationsTableName: 'test_ddl_migrations',
    migrations: [FailingDDL1800000000200],
  }).initialize();
  const q = db.createQueryRunner();
  t.after(async () => {
    await q.dropTable('migration_partial', true);
    await q.dropTable('test_ddl_migrations', true);
    await q.release();
    await db.destroy();
  });
  await assert.rejects(db.runMigrations({ transaction: 'all' }), /not transactional/);
  assert.equal(await q.hasTable('migration_partial'), false);
  await assert.rejects(db.runMigrations(), /intentional schema failure/);
  assert.equal(await q.hasTable('migration_partial'), true);
  assert.deepEqual(await db.query('SELECT FROM test_ddl_migrations'), []);
});

test('TypeORM migration execution, history, no-op rerun and revert', async (t) => {
  class Basic1800000000000 {
    async up(q) {
      await q.createTable(
        new Table({
          name: 'migration_basic',
          columns: [{ name: 'id', type: 'string', isPrimary: true }],
        }),
      );
    }
    async down(q) {
      await q.dropTable('migration_basic');
    }
  }
  const source = await new ArcadeDataSource({
    ...options,
    migrations: [Basic1800000000000],
  }).initialize();
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
  t.after(async () => {
    await q.release();
    await source.destroy();
  });
  await q.dropTable('migration_schema', true);
  await q.dropTable('migration_schema_renamed', true);
  await q.createTable(
    new Table({
      name: 'migration_schema',
      columns: [{ name: 'id', type: 'string', isPrimary: true }],
    }),
  );
  await q.query('INSERT INTO migration_schema SET id = :p0', ['a']);
  await q.addColumns('migration_schema', [
    new TableColumn({ name: 'email', type: 'string', isNullable: true }),
    new TableColumn({ name: 'obsolete', type: 'integer', isNullable: true }),
  ]);
  await q.query('UPDATE migration_schema SET email = :p0, obsolete = 12', ['a@example.test']);
  await q.changeColumn(
    'migration_schema',
    'email',
    new TableColumn({ name: 'email', type: 'string', isNullable: false }),
  );
  await q.createUniqueConstraint(
    'migration_schema',
    new TableUnique({ name: 'uq_migration_email', columnNames: ['email'] }),
  );
  await q.createIndex(
    'migration_schema',
    new TableIndex({ name: 'idx_migration_obsolete', columnNames: ['obsolete'] }),
  );
  assert.equal((await q.getTable('migration_schema')).findColumnByName('email').isNullable, false);
  assert.ok(
    (await q.getTable('migration_schema')).uniques.some((u) => u.name === 'uq_migration_email'),
  );
  await assert.rejects(
    q.query('INSERT INTO migration_schema SET id = :p0, email = :p1', ['b', 'a@example.test']),
    /duplicat/i,
  );
  await q.dropIndex('migration_schema', 'idx_migration_obsolete');
  await q.dropColumn('migration_schema', 'obsolete');
  assert.equal((await q.query('SELECT FROM migration_schema'))[0].obsolete, undefined);
  await q.renameTable('migration_schema', 'migration_schema_renamed');
  assert.equal(await q.hasTable('migration_schema'), false);
  assert.equal((await q.query('SELECT FROM migration_schema_renamed'))[0].id, 'a');
  await q.dropUniqueConstraint('migration_schema_renamed', 'uq_migration_email');
  await q.dropTable('migration_schema_renamed');
});

test('24 demo migrations: legacy backfills, repeatable seeds, every down, and replay', async (t) => {
  const { migrations } = require('../.demo-dist/demo/migrations');
  const { demoDataSource } = require('../.demo-dist/demo/data-source');
  const { seedLegacy } = require('../.demo-dist/demo/seeders/01-legacy');
  const { seedDemo, seedEntities } = require('../.demo-dist/demo/seeders');
  const database = 'demo_test_' + randomUUID().replaceAll('-', '');
  let db = await demoDataSource(migrations.slice(0, 4), false, database).initialize();
  t.after(async () => {
    if (db.isInitialized) await db.destroy();
    await db.driver.request('server', { command: 'drop database ' + database });
  });
  assert.equal((await db.runMigrations()).length, 4);
  await seedLegacy(db);
  await seedLegacy(db);
  assert.equal((await db.query('SELECT count(*) AS n FROM demo_accounts'))[0].n, 2);
  await db.destroy();
  db = await demoDataSource(migrations, true, database).initialize();
  assert.equal(await db.showMigrations(), false);
  assert.equal((await db.query('SELECT FROM demo_migrations')).length, 24);
  assert.equal(
    (await db.query('SELECT FROM demo_accounts WHERE id = :p0', ['ada']))[0].display_name,
    'Ada Lovelace',
  );
  assert.equal(
    (await db.query('SELECT FROM demo_catalog WHERE id = :p0', ['book']))[0].price_cents,
    2500,
  );
  assert.equal((await db.query('SELECT FROM demo_order_totals'))[0].total_cents, 5000);
  assert.equal((await db.query('SELECT FROM demo_account_archive')).length, 2);
  await db.destroy();
  db = demoDataSource(migrations, false, database);
  db.setOptions({ entities: seedEntities });
  await db.initialize();
  await seedDemo(db);
  const snapshot = async () => {
    const counts = {};
    for (const type of [
      'demo_accounts',
      'demo_catalog',
      'demo_orders',
      'demo_order_items',
      'demo_placed',
      'demo_customer_vertex',
      'demo_order_vertex',
    ])
      counts[type] = (await db.query('SELECT count(*) AS n FROM ' + type))[0].n;
    return counts;
  };
  const seeded = await snapshot();
  await seedDemo(db);
  assert.deepEqual(await snapshot(), seeded);
  assert.deepEqual(seeded, {
    demo_accounts: 3,
    demo_catalog: 3,
    demo_orders: 2,
    demo_order_items: 2,
    demo_placed: 2,
    demo_customer_vertex: 2,
    demo_order_vertex: 2,
  });
  assert.equal(
    (await db.query('SELECT sum(total_cents) AS total FROM demo_order_totals'))[0].total,
    17000,
  );
  await assert.rejects(db.query('UPDATE demo_order_items SET quantity = 0'), /less than 1/i);
  await assert.rejects(
    db.query(
      "INSERT INTO demo_accounts SET id = 'collision', display_name = 'X', email = 'ada@example.test', active = true",
    ),
    /duplicat/i,
  );
  for (let left = 24; left > 0; left--) {
    await db.undoLastMigration();
    assert.equal(
      (await db.query('SELECT FROM demo_migrations')).length,
      left - 1,
      'rollback history at ' + left,
    );
    if (left === 24)
      assert.equal((await db.query("SELECT FROM demo_catalog WHERE id = 'book'"))[0].price, 2500);
    if (left === 17)
      assert.equal(
        (await db.query("SELECT FROM demo_accounts WHERE id = 'ada'"))[0].name,
        'Ada Lovelace',
      );
    if (left === 16)
      assert.equal((await db.query("SELECT FROM demo_products WHERE id = 'book'"))[0].price, 2500);
  }
  const remaining = (await db.query('SELECT FROM schema:types')).map((type) => type.name);
  assert.deepEqual(remaining, ['demo_migrations']);
  assert.equal((await db.runMigrations()).length, 24);
  assert.equal((await db.runMigrations()).length, 0);
  await seedDemo(db);
  assert.deepEqual(await snapshot(), seeded);
});
