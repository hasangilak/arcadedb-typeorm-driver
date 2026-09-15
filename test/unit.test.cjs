const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ArcadeDataSource } = require('../dist');

const options = { database: 'driver_test', username: 'root', password: 'test-password' };

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
    { username: '' },
    { password: '' },
    { url: 'file:///tmp/database' },
    { requestTimeout: 0 },
    { cache: true },
    { migrationsRun: true },
  ]) assert.throws(() => new ArcadeDataSource({ ...options, ...invalid }));
});

test('binds repeated and spread parameters without touching literals, identifiers or comments', () => {
  const driver = new ArcadeDataSource(options).driver;
  const [sql, values] = driver.escapeQueryWithParameters(
    "SELECT ':name', `:name`, \"?:name\" FROM person WHERE name = :name OR name = :name AND age IN (:...ages) -- :ignored\n/* :ignored */",
    { name: "O'Reilly", ages: [20, 30] },
  );
  assert.equal(sql, "SELECT ':name', `:name`, \"?:name\" FROM person WHERE name = :p0 OR name = :p1 AND age IN (:p2, :p3) -- :ignored\n/* :ignored */");
  assert.deepEqual(values, ["O'Reilly", "O'Reilly", 20, 30]);
  assert.throws(() => driver.escapeQueryWithParameters('SELECT :missing', {}), /missing/i);
  assert.throws(() => driver.escapeQueryWithParameters('SELECT :...ids', { ids: 1 }), /array/i);
  assert.throws(() => driver.escapeQueryWithParameters('SELECT :...ids', { ids: [] }), /empty/i);
  assert.equal(driver.escape('order'), '`order`');
  assert.throws(() => driver.escape('bad`name'));
});

test('translates ORM aliases and pagination while preserving quoted text', () => {
  const driver = new ArcadeDataSource(options).driver;
  const [sql] = driver.escapeQueryWithParameters("SELECT `p`.`name`, '`p`.`name` LIMIT 1 OFFSET 2' AS `text` FROM `person` `p` ORDER BY `p`.`name` LIMIT 2 OFFSET 1", {});
  assert.equal(sql, "SELECT `name`, '`p`.`name` LIMIT 1 OFFSET 2' AS `text` FROM `person`  ORDER BY `name` SKIP 1 LIMIT 2");
  assert.throws(() => driver.escapeQueryWithParameters('SELECT * FROM `person` `p` LEFT JOIN `company` `c` ON 1=1', {}), /joins/i);
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
  assert.equal(requests[0].init.headers.Authorization, 'Basic ' + Buffer.from('root:test-password').toString('base64'));
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  mock.mock.mockImplementation(async () => Response.json({ detail: 'Invalid query', exception: 'SQLParsingException' }, { status: 400 }));
  await assert.rejects(source.query('bad SQL'), error => error instanceof QueryFailedError && error.driverError instanceof ArcadeHttpError && error.driverError.status === 400);
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
    const schema = new EntitySchema({ name: 'Unsupported', columns: { id: { type: String, primary: true }, age: { type: Number } }, ...extra });
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
  assert.equal(driver.prepareHydratedValue('2026-09-15T10:11:12.123', column).toISOString(), '2026-09-15T10:11:12.123Z');
  assert.equal(driver.prepareHydratedValue('2026-09-15T12:11:12.123+02:00', column).toISOString(), '2026-09-15T10:11:12.123Z');
});
