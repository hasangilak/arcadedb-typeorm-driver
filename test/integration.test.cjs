const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EntitySchema, In, MoreThan, QueryFailedError } = require('typeorm');
const { ArcadeDataSource } = require('../dist');

const Person = new EntitySchema({
  name: 'Person',
  tableName: 'test_person',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    name: { type: String },
    age: { type: Number },
    active: { type: Boolean },
  },
});

const options = {
  url: process.env.ARCADEDB_URL ?? 'http://127.0.0.1:2480',
  database: process.env.ARCADEDB_DATABASE ?? 'driver_test',
  username: process.env.ARCADEDB_USERNAME ?? 'root',
  password: process.env.ARCADEDB_PASSWORD ?? 'integration-password',
  entities: [Person],
  synchronize: true,
};

test('repository CRUD uses ArcadeDB and preserves TypeORM results', async (t) => {
  const source = await new ArcadeDataSource(options).initialize();
  t.after(() => source.destroy());
  const repo = source.getRepository(Person);
  await repo.clear();

  const person = await repo.save({ name: "O'Reilly :name ?", age: 30, active: true });
  assert.match(person.id, /^[\da-f-]{36}$/);
  assert.deepEqual(await repo.findOneByOrFail({ id: person.id }), person);
  assert.equal(await repo.count(), 1);
  person.age = 31;
  await repo.save(person);
  assert.equal((await repo.findOneByOrFail({ id: person.id })).age, 31);

  const inserted = await repo.insert({ name: 'Bob', age: 21, active: false });
  assert.equal(inserted.identifiers.length, 1);
  const updated = await repo.update({ id: person.id }, { age: 32 });
  assert.equal(updated.affected, 1);
  assert.equal((await repo.delete({ id: person.id })).affected, 1);
  assert.equal((await repo.delete({ id: person.id })).affected, 0);
  const bob = await repo.findOneByOrFail({ id: inserted.identifiers[0].id });
  assert.equal(bob.active, false);
  await repo.remove(bob);
  assert.equal(await repo.count(), 0);
});

test('find operators, query builder, pagination and raw bound SQL', async (t) => {
  const source = await new ArcadeDataSource(options).initialize();
  t.after(() => source.destroy());
  const repo = source.getRepository(Person);
  await repo.clear();
  await repo.save([
    { name: 'Alice', age: 40, active: true },
    { name: 'Bob', age: 20, active: false },
    { name: 'Carol', age: 30, active: true },
  ]);
  assert.equal((await repo.findBy({ name: In(['Alice', 'Carol']), age: MoreThan(25) })).length, 2);
  const [page, count] = await repo.findAndCount({ order: { age: 'ASC' }, skip: 1, take: 1 });
  assert.equal(count, 3);
  assert.equal(page[0].name, 'Carol');
  const people = await repo.createQueryBuilder('p').where('p.age > :age', { age: 25 }).orderBy('p.age', 'DESC').getMany();
  assert.deepEqual(people.map(p => p.name), ['Alice', 'Carol']);
  const rows = await source.query('SELECT name FROM test_person WHERE name = :p0', ['Alice']);
  assert.equal(rows[0].name, 'Alice');
  assert.equal((await source.query('SELECT name FROM test_person WHERE name = :name', { name: 'Bob' }))[0].name, 'Bob');
  assert.equal((await source.sql`SELECT name FROM test_person WHERE name = ${'Carol'}`)[0].name, 'Carol');
  await assert.rejects(source.query('SELECT FROM definitely_missing_type'), QueryFailedError);
});

test('transaction commit, rollback, session isolation and runner release', async (t) => {
  const source = await new ArcadeDataSource(options).initialize();
  t.after(() => source.destroy());
  const repo = source.getRepository(Person);
  await repo.clear();
  await source.transaction(async manager => {
    await manager.save(Person, { name: 'Committed', age: 1, active: true });
  });
  await assert.rejects(source.transaction(async manager => {
    await manager.save(Person, { name: 'Rolled back', age: 2, active: true });
    throw new Error('rollback me');
  }), /rollback me/);
  assert.equal(await repo.count(), 1);
  const runner = source.createQueryRunner();
  await runner.startTransaction('REPEATABLE READ');
  await runner.manager.save(Person, { name: 'Uncommitted', age: 3, active: true });
  assert.equal(await runner.manager.count(Person), 2);
  assert.equal(await repo.count(), 1);
  await assert.rejects(runner.startTransaction(), /nested/i);
  await runner.release();
  assert.equal(await repo.count(), 1);
  await assert.rejects(runner.query('SELECT 1'), /released/i);
  await assert.rejects(source.transaction('SERIALIZABLE', async () => {}), /isolation/i);
});

test('schema defaults, uniqueness, nullability, JSON, dates, transformers and additive sync', async (t) => {
  const Document = new EntitySchema({
    name: 'Document', tableName: 'test_document',
    columns: {
      id: { type: 'uuid', primary: true, generated: 'uuid' },
      slug: { type: String, unique: true },
      title: { type: String, default: 'Untitled' },
      score: { type: Number, default: 0 },
      enabled: { type: Boolean, default: false },
      note: { type: String, nullable: true },
      data: { type: 'json' },
      tags: { type: 'array' },
      date: { type: Date },
      encoded: { type: String, transformer: { to: value => value == null ? value : 'stored:' + value, from: value => value == null ? value : value.replace(/^stored:/, '') } },
    },
    indices: [{ name: 'idx_test_document_score', columns: ['score'] }],
  });
  const source = await new ArcadeDataSource({ ...options, entities: [Document] }).initialize();
  t.after(() => source.destroy());
  const repo = source.getRepository(Document);
  await repo.clear();
  const data = { nested: { text: "O'Reilly", values: [1, false, null] } };
  const date = new Date('2026-09-15T10:11:12.123Z');
  const doc = await repo.save({ slug: 'first', data, tags: ['a', 'b'], date, encoded: 'secret' });
  const loaded = await repo.findOneByOrFail({ id: doc.id });
  assert.equal(loaded.title, 'Untitled');
  assert.equal(loaded.score, 0);
  assert.equal(loaded.enabled, false);
  assert.equal(loaded.note, null);
  assert.deepEqual(loaded.data, data);
  assert.deepEqual(loaded.tags, ['a', 'b']);
  assert.equal(loaded.date.toISOString(), date.toISOString());
  assert.equal(loaded.encoded, 'secret');
  await assert.rejects(repo.insert({ ...doc, id: undefined }), /duplicat/i);
  await assert.rejects(repo.insert({ ...doc, id: undefined, slug: 'second', title: null }), /null/i);
  await source.synchronize();
  assert.equal(await repo.count(), 1);
  assert.equal((await source.driver.createSchemaBuilder().log()).upQueries.length, 0);
  const indexes = await source.query('SELECT FROM schema:indexes');
  assert.ok(indexes.some(index => index.name === 'idx_test_document_score'));
});

test('automatic timestamps, versions, soft deletion and restoration', async (t) => {
  const Audit = new EntitySchema({
    name: 'Audit', tableName: 'test_audit',
    columns: {
      id: { type: 'uuid', primary: true, generated: 'uuid' },
      name: { type: String },
      createdAt: { type: Date, createDate: true },
      updatedAt: { type: Date, updateDate: true },
      deletedAt: { type: Date, deleteDate: true },
      version: { type: Number, version: true },
    },
  });
  const source = await new ArcadeDataSource({ ...options, entities: [Audit] }).initialize();
  t.after(() => source.destroy());
  const repo = source.getRepository(Audit);
  const item = await repo.save({ name: 'first' });
  assert.ok(item.createdAt instanceof Date && Number.isFinite(item.createdAt.getTime()));
  assert.equal(item.version, 1);
  await repo.update(item.id, { name: 'second' });
  const updated = await repo.findOneByOrFail({ id: item.id });
  assert.equal(updated.version, 2);
  assert.ok(updated.updatedAt instanceof Date && Number.isFinite(updated.updatedAt.getTime()));
  assert.equal((await repo.softDelete(item.id)).affected, 1);
  assert.equal(await repo.count(), 0);
  const deleted = await repo.findOne({ where: { id: item.id }, withDeleted: true });
  assert.ok(deleted.deletedAt instanceof Date);
  await repo.restore(item.id);
  assert.equal(await repo.count(), 1);
});

test('independent concurrent transactions and rollback on data source destruction', async () => {
  const source = await new ArcadeDataSource(options).initialize();
  const repo = source.getRepository(Person);
  await repo.clear();
  const first = source.createQueryRunner();
  const second = source.createQueryRunner();
  try {
    await Promise.all([first.startTransaction(), second.startTransaction()]);
    await first.manager.save(Person, { name: 'first', age: 1, active: true });
    await second.manager.save(Person, { name: 'second', age: 2, active: true });
    assert.equal(await first.manager.count(Person), 1);
    assert.equal(await second.manager.count(Person), 1);
    await first.commitTransaction();
    await source.destroy(); // rolls back second
    assert.ok(first.isReleased && second.isReleased);
    await source.initialize();
    assert.deepEqual((await repo.find()).map(p => p.name), ['first']);
  } finally {
    if (source.isInitialized) await source.destroy();
  }
});
