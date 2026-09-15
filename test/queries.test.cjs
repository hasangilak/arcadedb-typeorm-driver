const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runNode = promisify(execFile);

test('query cookbook: basic reads through aggregates, graph traversal and transactional writes', async (t) => {
  const { queries } = require('../.demo-dist/demo/queries');
  const { demoDataSource } = require('../.demo-dist/demo/data-source');
  const { seedDemo, seedEntities } = require('../.demo-dist/demo/seeders');
  const database = 'queries_test_' + randomUUID().replaceAll('-', '');
  const db = demoDataSource(undefined, true, database);
  db.setOptions({ entities: seedEntities });
  await db.initialize();
  t.after(async () => {
    await db.destroy();
    await db.driver.request('server', { command: 'drop database ' + database });
  });
  await seedDemo(db);

  const expected = {
    findAccount: {
      id: 'ada',
      display_name: 'Ada Lovelace',
      email: 'ada@example.test',
      country: 'DE',
      active: true,
    },
    activeAccounts: ['ada', 'grace'],
    priceRange: ['book', 'support'],
    selectedProducts: ['book', 'course'],
    countPendingOrders: 1,
    accountProjection: [
      { id: 'ada', display_name: 'Ada Lovelace' },
      { id: 'grace', display_name: 'Grace Hopper' },
      { id: 'linus', display_name: 'Linus Torvalds' },
    ],
    nestedConditions: ['ada', 'grace'],
    offsetPage: { ids: ['support'], total: 3 },
    cursorPage: ['support', 'course'],
    nameSearch: ['book'],
    salesSummary: { units: 3, revenue_cents: 17000 },
    totalsByOrder: [
      { order_id: 'grace-order', total_cents: 12000 },
      { order_id: 'legacy-order', total_cents: 5000 },
    ],
    dateWindow: ['grace-order', 'legacy-order'],
    distinctStatuses: [{ status: 'paid' }, { status: 'pending' }],
    nestedDocuments: [{ id: 'book', pages: 320 }],
    arrayMembership: [{ id: 'book' }],
    highValueOrders: [{ id: 'grace-order', account_id: 'grace' }],
    customerOrders: ['legacy-order'],
    graphPattern: [{ account_id: 'ada', order_id: 'legacy-order' }],
    atomicRecalculation: { quantity: 3, total_cents: 7500 },
    insertUpdateDelete: { inserted: 1, updated: 1, deleted: 1 },
    ...require('./query-expectations.cjs'),
  };
  assert.equal(Object.keys(queries).length, 100, '100 distinct executable query examples');
  assert.deepEqual(Object.keys(queries), Object.keys(expected));
  const snapshot = async () => {
    const result = {};
    for (const name of [
      'demo_accounts',
      'demo_catalog',
      'demo_orders',
      'demo_order_items',
      'demo_order_totals',
      'demo_customer_vertex',
      'demo_order_vertex',
      'demo_placed',
    ]) {
      result[name] = await db.query('SELECT FROM ' + name + ' ORDER BY @rid');
    }
    return result;
  };
  const before = await snapshot();
  for (const [name, run] of Object.entries(queries)) {
    await t.test(name, async () => assert.deepEqual(await run(db), expected[name]));
  }
  assert.deepEqual(
    await snapshot(),
    before,
    'examples must leave all seeded values and graph records unchanged',
  );
  // Repeat both write examples to prove cleanup/rollback and repeatability.
  assert.deepEqual(await queries.atomicRecalculation(db), expected.atomicRecalculation);
  assert.deepEqual(await queries.insertUpdateDelete(db), expected.insertUpdateDelete);
  assert.deepEqual(await snapshot(), before);
  await t.test('CLI selects a named query and rejects unknown names', async () => {
    const { stdout } = await runNode(
      process.execPath,
      ['.demo-dist/demo/run.js', 'queries', 'graphPattern'],
      {
        env: { ...process.env, ARCADEDB_DATABASE: database },
      },
    );
    assert.deepEqual(JSON.parse(stdout), { query: 'graphPattern', result: expected.graphPattern });
    await assert.rejects(
      runNode(process.execPath, ['.demo-dist/demo/run.js', 'queries', 'missing-query']),
      /Unknown query/,
    );
  });
});
