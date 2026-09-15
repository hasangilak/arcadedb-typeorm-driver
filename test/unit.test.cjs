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
