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
