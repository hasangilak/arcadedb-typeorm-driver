const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ArcadeDataSource } = require('../dist');

const options = { database: 'driver_test', username: 'root', password: 'test-password' };

test('unsupported query options reject instead of silently changing semantics', async (t) => {
  const db = new ArcadeDataSource(options);
  const select = () =>
    db.createQueryBuilder().select('account.id').from('demo_accounts', 'account');
  const cases = {
    distinctOn: () => select().distinctOn(['account.id']),
    cache: () => select().cache(true),
    indexHint: () => select().useIndex('idx_account'),
    timeTravel: () => select().timeTravelQuery('yesterday'),
    dirtyRead: () => select().setLock('dirty_read'),
    cte: () => select().addCommonTableExpression('SELECT 1', 'numbers'),
    ignoreConflicts: () =>
      db
        .createQueryBuilder()
        .insert()
        .into('demo_accounts')
        .values({ id: 'x' })
        .orIgnore()
        .orUpdate(['id'], ['id']),
  };
  for (const [name, create] of Object.entries(cases)) {
    await t.test(name, () => assert.throws(() => create().getQuery(), /not supported/i));
  }
});

test('dialect rewrites preserve comparison operators, decimals, literals and comments', () => {
  const driver = new ArcadeDataSource(options).driver;
  const [sql, params] = driver.escapeQueryWithParameters(
    "SELECT UPPER(`p`.`name`) AS `upper_name` FROM `products` `p` WHERE `p`.`price` >= 1.25 AND UPPER(`p`.`name`) LIKE UPPER(:name) -- HAVING ignored\nAND `p`.`name` <> 'UPPER(:not_bound)'",
    { name: 'book%' },
  );
  assert.match(sql, />=\s*1\.25/);
  assert.match(sql, /<>\s*'UPPER\(:not_bound\)'/);
  assert.match(sql, /-- HAVING ignored\n/);
  assert.deepEqual(params, ['book%']);
  for (const predicate of [
    '`tags` @> :tags',
    '`tags` <@ :tags',
    '`tags` && :tags',
    '`id` = ANY(:tags)',
  ]) {
    assert.throws(
      () =>
        driver.escapeQueryWithParameters('SELECT FROM `item` WHERE ' + predicate, { tags: ['x'] }),
      /not supported/,
    );
  }
});

test('constructs a real TypeORM DataSource without loading another database client', () => {
  const { DataSource } = require('typeorm');
  const source = new ArcadeDataSource(options);
  assert.ok(source instanceof DataSource);
  assert.equal(source.options.type, 'arcadedb');
  assert.equal(source.driver.database, 'driver_test');
  assert.equal(source.isInitialized, false);
});

test('validates connection options and refuses unsupported features', () => {
  for (const invalid of [
    { database: 'db; drop database other' },
    { database: '' },
    { database: undefined },
    { username: '' },
    { password: '' },
    { url: 'file:///tmp/database' },
    { requestTimeout: 0 },
    { cache: true },
  ])
    assert.throws(() => new ArcadeDataSource({ ...options, ...invalid }));
});

test('binds repeated and spread parameters without touching literals, identifiers or comments', () => {
  const driver = new ArcadeDataSource(options).driver;
  const [sql, values] = driver.escapeQueryWithParameters(
    'SELECT \':name\', `:name`, "?:name" FROM person WHERE name = :name OR name = :name AND age IN (:...ages) -- :ignored\n/* :ignored */',
    { name: "O'Reilly", ages: [20, 30] },
  );
  assert.equal(
    sql,
    'SELECT \':name\', `:name`, "?:name" FROM person WHERE name = :p0 OR name = :p1 AND age IN (:p2, :p3) -- :ignored\n/* :ignored */',
  );
  assert.deepEqual(values, ["O'Reilly", "O'Reilly", 20, 30]);
  assert.throws(() => driver.escapeQueryWithParameters('SELECT :missing', {}), /missing/i);
  assert.throws(() => driver.escapeQueryWithParameters('SELECT :...ids', { ids: 1 }), /array/i);
  assert.throws(() => driver.escapeQueryWithParameters('SELECT :...ids', { ids: [] }), /empty/i);
  assert.equal(driver.escape('order'), '`order`');
  assert.throws(() => driver.escape('bad`name'));
});

test('translates ORM aliases and pagination while preserving quoted text', () => {
  const driver = new ArcadeDataSource(options).driver;
  const [sql] = driver.escapeQueryWithParameters(
    "SELECT `p`.`name`, '`p`.`name` LIMIT 1 OFFSET 2' AS `text` FROM `person` `p` ORDER BY `p`.`name` LIMIT 2 OFFSET 1",
    {},
  );
  assert.equal(
    sql,
    "SELECT `name`, '`p`.`name` LIMIT 1 OFFSET 2' AS `text` FROM `person`  ORDER BY `name` SKIP 1 LIMIT 2",
  );
  assert.throws(
    () =>
      driver.escapeQueryWithParameters(
        'SELECT * FROM `person` `p` LEFT JOIN `company` `c` ON 1=1',
        {},
      ),
    /joins/i,
  );
});

test('HTTP authentication, errors, malformed responses and parameter validation', async (t) => {
  const { QueryFailedError } = require('typeorm');
  const { ArcadeHttpError } = require('../dist');
  const requests = [];
  const mock = t.mock.method(global, 'fetch', async (url, init) => {
    requests.push({ url, init });
    return Response.json({ result: true });
  });
  const source = await new ArcadeDataSource(options).initialize();
  t.after(() => source.destroy());
  assert.equal(
    requests[0].init.headers.Authorization,
    'Basic ' + Buffer.from('root:test-password').toString('base64'),
  );
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  mock.mock.mockImplementation(async () =>
    Response.json({ detail: 'Invalid query', exception: 'SQLParsingException' }, { status: 400 }),
  );
  await assert.rejects(
    source.query('bad SQL'),
    (error) =>
      error instanceof QueryFailedError &&
      error.driverError instanceof ArcadeHttpError &&
      error.driverError.status === 400,
  );
  mock.mock.mockImplementation(async () => new Response('<html>oops</html>', { status: 502 }));
  await assert.rejects(source.query('SELECT 1'), /non-JSON/);
  mock.mock.mockImplementation(async () => Response.json({ result: [] }));
  await assert.rejects(source.query('SELECT :p0', [undefined]), /undefined/i);
  await assert.rejects(source.query('SELECT :p0', [NaN]), /finite/i);
  await assert.rejects(source.query('SELECT :p0', [9007199254740993n]), /bigint/i);
});

test('rejects unsupported constraints and indexes before synchronizing', async (t) => {
  const { EntitySchema } = require('typeorm');
  t.mock.method(global, 'fetch', async () => Response.json({ result: true }));
  for (const extra of [
    { checks: [{ expression: 'age >= 0' }] },
    { indices: [{ columns: ['age'], where: 'age > 0' }] },
    { indices: [{ columns: ['age'], fulltext: true }] },
  ]) {
    const schema = new EntitySchema({
      name: 'Unsupported',
      columns: { id: { type: String, primary: true }, age: { type: Number } },
      ...extra,
    });
    const source = new ArcadeDataSource({ ...options, entities: [schema] });
    await assert.rejects(source.initialize(), /not supported/i);
    assert.equal(source.isInitialized, false);
    assert.equal(source.driver.connected, false);
  }
});

test('creates a missing database only when explicitly enabled', async (t) => {
  const requests = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    requests.push({ url, init });
    return Response.json({ result: url.endsWith('/server') ? 'ok' : false });
  });
  await assert.rejects(new ArcadeDataSource(options).initialize(), /does not exist/);
  assert.equal(requests.length, 1);
  const source = await new ArcadeDataSource({ ...options, createDatabase: true }).initialize();
  assert.equal(JSON.parse(requests[2].init.body).command, 'create database driver_test');
  await source.destroy();
});

test('hydrates ArcadeDB datetime strings consistently across client time zones', () => {
  const driver = new ArcadeDataSource(options).driver;
  const column = { type: Date };
  assert.equal(
    driver.prepareHydratedValue('2026-09-15T10:11:12.123', column).toISOString(),
    '2026-09-15T10:11:12.123Z',
  );
  assert.equal(
    driver.prepareHydratedValue('2026-09-15T12:11:12.123+02:00', column).toISOString(),
    '2026-09-15T10:11:12.123Z',
  );
});

test('schema synchronization honors index opt-out', async (t) => {
  const { EntitySchema } = require('typeorm');
  t.mock.method(global, 'fetch', async (url) =>
    Response.json({ result: url.includes('/exists/') ? true : [] }),
  );
  const schema = new EntitySchema({
    name: 'ExternalIndex',
    columns: { id: { type: String, primary: true } },
    indices: [{ name: 'managed_elsewhere', columns: ['id'], synchronize: false }],
  });
  const source = await new ArcadeDataSource({ ...options, entities: [schema] }).initialize();
  t.after(() => source.destroy());
  const sql = await source.driver.createSchemaBuilder().log();
  assert.equal(
    sql.upQueries.some((query) => query.query.includes('managed_elsewhere')),
    false,
  );
});

test('query guards survive every builder switch and clone without changing TypeORM globally', async (t) => {
  const { SelectQueryBuilder } = require('typeorm');
  const db = new ArcadeDataSource(options);
  const start = () => db.createQueryBuilder().select('id').from('documents', 'd');
  const switches = {
    insert: (qb) => qb.insert().into('documents').values({ id: 'x' }),
    update: (qb) => qb.update('documents').set({ id: 'x' }),
    delete: (qb) => qb.delete(),
    softDelete: (qb) => qb.softDelete(),
    restore: (qb) => qb.restore(),
  };
  for (const [name, switchBuilder] of Object.entries(switches)) {
    await t.test(name, () => {
      for (const switched of [switchBuilder(start()), switchBuilder(start()).clone()]) {
        assert.throws(() => switched.select('id').distinctOn(['id']).getQuery(), /not supported/i);
        assert.throws(
          () =>
            switched
              .insert()
              .into('documents')
              .values({ id: 'x' })
              .orIgnore()
              .orUpdate(['id'], ['id'])
              .getQuery(),
          /not supported/i,
        );
      }
    });
  }
  // A base TypeORM builder remains a base builder: no registry/prototype patch.
  const base = new SelectQueryBuilder(db).from('documents', 'd');
  assert.doesNotThrow(() => base.insert().select('id').distinctOn(['id']).getQuery());
});

test('query subscribers are awaited and receive success, failure, parameters and runner context', async (t) => {
  const events = [];
  t.mock.method(global, 'fetch', async (url) => {
    if (url.includes('/exists/')) return Response.json({ result: true });
    events.push('request');
    return Response.json({ result: [{ answer: 42 }] });
  });
  const db = await new ArcadeDataSource(options).initialize();
  t.after(() => db.destroy());
  db.subscribers.push({
    async beforeQuery(event) {
      await Promise.resolve();
      events.push(['before', event]);
    },
    async afterQuery(event) {
      await Promise.resolve();
      events.push(['after', event]);
    },
  });
  const runner = db.createQueryRunner();
  const params = { answer: 42 };
  assert.deepEqual(await runner.query('SELECT :answer AS answer', params), [{ answer: 42 }]);
  assert.deepEqual(
    events.map((e) => (Array.isArray(e) ? e[0] : e)),
    ['before', 'request', 'after'],
  );
  for (const event of [events[0][1], events[2][1]]) {
    assert.equal(event.query, 'SELECT :answer AS answer');
    assert.equal(event.parameters, params);
    assert.equal(event.queryRunner, runner);
    assert.equal(event.manager, runner.manager);
    assert.equal(event.dataSource, db);
  }
  assert.equal(events[2][1].success, true);
  assert.ok(events[2][1].executionTime >= 0);
  assert.deepEqual(events[2][1].rawResults, [{ answer: 42 }]);
  events.length = 0;
  t.mock.method(db.driver, 'request', async () => {
    throw new Error('request failed');
  });
  await assert.rejects(runner.query('SELECT :p0', [42]), /request failed/);
  assert.equal(events.length, 2);
  assert.deepEqual(events[1][1].parameters, [42]);
  assert.equal(events[1][1].success, false);
  assert.equal(events[1][1].error.message, 'request failed');
  await runner.release();
});

test('UPDATE returning is translated before WHERE without changing literals', () => {
  const db = new ArcadeDataSource(options);
  const qb = db
    .createQueryBuilder()
    .update('documents')
    .set({ title: 'WHERE RETURNING' })
    .where('id = :id', { id: 'x' })
    .returning('*');
  const [sql, parameters] = qb.getQueryAndParameters();
  assert.match(sql, /RETURN AFTER @this WHERE/);
  assert.deepEqual(parameters, ['WHERE RETURNING', 'x']);
});

test('returning rejects unsupported expressions and counts returned records independently of count fields', async (t) => {
  const db = new ArcadeDataSource(options);
  assert.throws(
    () => db.createQueryBuilder().update('documents').returning('id; DELETE FROM documents'),
    /returning/i,
  );
  assert.throws(
    () => db.createQueryBuilder().update('documents').returning(['missing']),
    /returning/i,
  );
  t.mock.method(global, 'fetch', async (url) =>
    Response.json({ result: url.includes('/exists/') ? true : [{ count: 99 }] }),
  );
  await db.initialize();
  t.after(() => db.destroy());
  const runner = db.createQueryRunner();
  const returned = await runner.query(
    '/* audit */ UPDATE documents SET count = 99 RETURN BEFORE @this',
    [],
    true,
  );
  assert.equal(returned.affected, 1);
  const counted = await runner.query("UPDATE documents SET title = 'RETURN AFTER'", [], true);
  assert.equal(counted.affected, 99);
  await runner.release();
});

test('array find operators bind values and reject unsupported shapes before requests', async (t) => {
  const { EntitySchema, ArrayContains, ArrayOverlap, Any } = require('typeorm');
  t.mock.method(global, 'fetch', async () => Response.json({ result: true }));
  const schema = new EntitySchema({
    name: 'Arrays',
    columns: { id: { type: String, primary: true }, tags: { type: 'array', nullable: true } },
  });
  const db = await new ArcadeDataSource({ ...options, entities: [schema] }).initialize();
  t.after(() => db.destroy());
  const sql = db
    .getRepository(schema)
    .createQueryBuilder('a')
    .where({ tags: ArrayContains(["x' OR 1=1"]) })
    .getQueryAndParameters();
  assert.ok(!sql[0].includes("x' OR 1=1"));
  assert.ok(sql[1].some((value) => Array.isArray(value) && value[0] === "x' OR 1=1"));
  for (const value of [[{}], [['nested']], undefined, 'not-an-array'])
    for (const operator of [ArrayContains, ArrayOverlap, Any])
      assert.throws(
        () =>
          db
            .getRepository(schema)
            .createQueryBuilder()
            .where({ tags: operator(value) })
            .getQueryAndParameters(),
        /array|undefined/i,
      );
});

test('server execution limits validate and survive clones without becoming ignored write hints', () => {
  const db = new ArcadeDataSource(options);
  const qb = db.createQueryBuilder().select('id').from('documents', 'd');
  for (const value of [-1, 0.5, Infinity, NaN, '10'])
    assert.throws(() => qb.maxExecutionTime(value), /integer/i);
  const [sql] = qb.maxExecutionTime(100).clone().getQueryAndParameters();
  assert.match(sql, /^SELECT FROM \(SELECT/);
  assert.match(sql, /TIMEOUT 100 EXCEPTION\)$/);
  assert.doesNotMatch(qb.maxExecutionTime(0).getQueryAndParameters()[0], /TIMEOUT/);
  assert.throws(
    () => qb.maxExecutionTime(10).update('documents').set({ id: 'x' }).getQueryAndParameters(),
    /select/i,
  );
});
