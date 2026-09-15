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
  const people = await repo
    .createQueryBuilder('p')
    .where('p.age > :age', { age: 25 })
    .orderBy('p.age', 'DESC')
    .getMany();
  assert.deepEqual(
    people.map((p) => p.name),
    ['Alice', 'Carol'],
  );
  const rows = await source.query('SELECT name FROM test_person WHERE name = :p0', ['Alice']);
  assert.equal(rows[0].name, 'Alice');
  assert.equal(
    (await source.query('SELECT name FROM test_person WHERE name = :name', { name: 'Bob' }))[0]
      .name,
    'Bob',
  );
  assert.equal(
    (await source.sql`SELECT name FROM test_person WHERE name = ${'Carol'}`)[0].name,
    'Carol',
  );
  await assert.rejects(source.query('SELECT FROM definitely_missing_type'), QueryFailedError);
});

test('transaction commit, rollback, session isolation and runner release', async (t) => {
  const source = await new ArcadeDataSource(options).initialize();
  t.after(() => source.destroy());
  const repo = source.getRepository(Person);
  await repo.clear();
  await source.transaction(async (manager) => {
    await manager.save(Person, { name: 'Committed', age: 1, active: true });
  });
  await assert.rejects(
    source.transaction(async (manager) => {
      await manager.save(Person, { name: 'Rolled back', age: 2, active: true });
      throw new Error('rollback me');
    }),
    /rollback me/,
  );
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
  await assert.rejects(
    source.transaction('SERIALIZABLE', async () => {}),
    /isolation/i,
  );
});

test('schema defaults, uniqueness, nullability, JSON, dates, transformers and additive sync', async (t) => {
  const Document = new EntitySchema({
    name: 'Document',
    tableName: 'test_document',
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
      encoded: {
        type: String,
        transformer: {
          to: (value) => (value == null ? value : 'stored:' + value),
          from: (value) => (value == null ? value : value.replace(/^stored:/, '')),
        },
      },
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
  await assert.rejects(
    repo.insert({ ...doc, id: undefined, slug: 'second', title: null }),
    /null/i,
  );
  await source.synchronize();
  assert.equal(await repo.count(), 1);
  assert.equal((await source.driver.createSchemaBuilder().log()).upQueries.length, 0);
  const indexes = await source.query('SELECT FROM schema:indexes');
  assert.ok(indexes.some((index) => index.name === 'idx_test_document_score'));
});

test('automatic timestamps, versions, soft deletion and restoration', async (t) => {
  const Audit = new EntitySchema({
    name: 'Audit',
    tableName: 'test_audit',
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
  await repo.clear();
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
    assert.deepEqual(
      (await repo.find()).map((p) => p.name),
      ['first'],
    );
  } finally {
    if (source.isInitialized) await source.destroy();
  }
});

test('query subscriber events cover repository operations and transaction sessions', async (t) => {
  const source = await new ArcadeDataSource(options).initialize();
  t.after(() => source.destroy());
  await source.getRepository(Person).clear();
  const events = [];
  source.subscribers.push({
    async beforeQuery(event) {
      events.push(['before', event]);
    },
    async afterQuery(event) {
      events.push(['after', event]);
    },
  });
  await source.transaction(async (manager) => {
    await manager.insert(Person, { name: 'event', age: 42, active: true });
    assert.equal(await manager.count(Person), 1);
    assert.ok(events.every(([, event]) => event.queryRunner === manager.queryRunner));
  });
  assert.ok(events.length >= 4);
  for (let i = 0; i < events.length; i += 2) {
    assert.equal(events[i][0], 'before');
    assert.equal(events[i + 1][0], 'after');
    assert.equal(events[i][1].query, events[i + 1][1].query);
    assert.equal(events[i + 1][1].success, true);
  }
  await assert.rejects(source.query('SELECT FROM test_missing_events_type'), QueryFailedError);
  assert.equal(events.at(-1)[1].success, false);
  assert.ok(events.at(-1)[1].error);
});

test('UPDATE returning hydrates entity changes, projects columns and reports affected rows', async (t) => {
  const Returning = new EntitySchema({
    name: 'Returning',
    tableName: 'test_returning',
    columns: {
      id: { type: String, primary: true },
      title: { name: 'stored_title', type: String },
      count: { type: Number },
      updatedAt: { type: Date, updateDate: true },
      deletedAt: { type: Date, deleteDate: true },
      version: { type: Number, version: true },
    },
  });
  const db = await new ArcadeDataSource({ ...options, entities: [Returning] }).initialize();
  t.after(() => db.destroy());
  const repo = db.getRepository(Returning);
  await repo.clear();
  await repo.save([
    { id: 'one', title: 'first', count: 90 },
    { id: 'two', title: 'second', count: 91 },
  ]);
  const result = await repo
    .createQueryBuilder()
    .update()
    .set({ title: 'changed WHERE RETURNING' })
    .where('id IN (:...ids)', { ids: ['one', 'two'] })
    .returning(['id', 'title', 'count'])
    .execute();
  assert.equal(result.affected, 2);
  assert.deepEqual(result.raw.map((row) => row.id).sort(), ['one', 'two']);
  assert.ok(result.raw.every((row) => row.stored_title === 'changed WHERE RETURNING'));
  assert.equal(result.raw[0].count >= 90, true);
  assert.equal(
    (
      await repo
        .createQueryBuilder()
        .update()
        .set({ count: 1 })
        .where('id = :id', { id: 'absent' })
        .returning('*')
        .execute()
    ).affected,
    0,
  );
  const entity = await repo.findOneByOrFail({ id: 'one' });
  entity.title = 'saved';
  await repo.save(entity);
  assert.equal(entity.version, 3);
  assert.ok(entity.updatedAt instanceof Date);
  const removed = await repo
    .createQueryBuilder()
    .softDelete()
    .where('id = :id', { id: 'one' })
    .returning('*')
    .execute();
  assert.equal(removed.affected, 1);
  assert.ok(removed.raw[0].deletedAt);
  const restored = await repo
    .createQueryBuilder()
    .restore()
    .where('id = :id', { id: 'one' })
    .returning(['id', 'deletedAt'])
    .execute();
  assert.equal(restored.affected, 1);
  assert.equal(restored.raw[0].deletedAt, null);
  await assert.rejects(
    db.transaction(async (manager) => {
      const changed = await manager
        .createQueryBuilder()
        .update(Returning)
        .set({ count: 500 })
        .where('id = :id', { id: 'one' })
        .returning('*')
        .execute();
      assert.equal(changed.raw[0].count, 500);
      throw new Error('undo returning');
    }),
    /undo returning/,
  );
  assert.equal((await repo.findOneByOrFail({ id: 'one' })).count, 90);
});

test('native upsert preserves identity, handles conflicts, rolls back batches and returns hydrated results', async (t) => {
  const Item = new EntitySchema({
    name: 'UpsertItem',
    tableName: 'test_upsert_item',
    columns: {
      id: { type: 'uuid', primary: true, generated: 'uuid' },
      tenant: { type: String },
      slug: { name: 'natural_key', type: String },
      title: { type: String },
      note: { type: String, nullable: true },
      status: { type: String, default: 'draft' },
      encoded: {
        type: String,
        nullable: true,
        transformer: {
          to: (v) => (v == null ? v : 'stored:' + v),
          from: (v) => (v == null ? v : v.replace(/^stored:/, '')),
        },
      },
      createdAt: { type: Date, createDate: true },
      updatedAt: { type: Date, updateDate: true },
      version: { type: Number, version: true },
    },
    uniques: [{ name: 'uq_upsert_tenant_slug', columns: ['tenant', 'slug'] }],
  });
  const db = await new ArcadeDataSource({ ...options, entities: [Item] }).initialize();
  t.after(() => db.destroy());
  const repo = db.getRepository(Item);
  await repo.clear();
  const paths = ['tenant', 'slug'];
  const first = await repo.upsert(
    { tenant: 'a', slug: 'one', title: 'first', encoded: 'secret' },
    paths,
  );
  assert.match(first.identifiers[0].id, /^[\da-f-]{36}$/);
  assert.equal(first.generatedMaps[0].encoded, 'secret');
  assert.ok(first.generatedMaps[0].createdAt instanceof Date);
  assert.equal(first.generatedMaps[0].version, 1);
  assert.equal(first.generatedMaps[0].status, 'draft');
  const initial = await repo.findOneByOrFail({ id: first.identifiers[0].id });
  const second = await repo.upsert(
    { tenant: 'a', slug: 'one', title: 'second' },
    { conflictPaths: { tenant: true, slug: true } },
  );
  assert.deepEqual(second.identifiers, first.identifiers);
  assert.equal(second.raw[0].title, 'second');
  assert.equal(second.generatedMaps[0].version, 2);
  assert.equal(second.generatedMaps[0].encoded, 'secret');
  assert.equal(second.generatedMaps[0].createdAt.getTime(), initial.createdAt.getTime());
  assert.equal(await repo.count(), 1);
  // Non-overwritten nullable values must remain null, not be filled with incoming values.
  await repo
    .createQueryBuilder()
    .insert()
    .values({ tenant: 'a', slug: 'one', title: 'third', note: 'ignored' })
    .orUpdate(['title'], ['tenant', 'natural_key'])
    .execute();
  assert.equal((await repo.findOneByOrFail({ id: initial.id })).note, null);
  const batch = await repo.upsert(
    [
      { tenant: 'a', slug: 'one', title: 'batch update' },
      { tenant: 'b', slug: 'one', title: 'batch insert' },
    ],
    paths,
  );
  assert.equal(batch.identifiers.length, 2);
  assert.equal(batch.identifiers[0].id, initial.id);
  assert.equal(await repo.count(), 2);
  await assert.rejects(
    repo.upsert(
      [
        { tenant: 'a', slug: 'one', title: 'must rollback' },
        { tenant: 'c', slug: 'one', title: null },
      ],
      paths,
    ),
    /null/i,
  );
  assert.equal((await repo.findOneByOrFail({ id: initial.id })).title, 'batch update');
  await assert.rejects(
    db.transaction(async (manager) => {
      await manager.upsert(
        Item,
        { tenant: 'a', slug: 'one', title: 'transaction rollback' },
        paths,
      );
      await manager.upsert(Item, { tenant: 'd', slug: 'one', title: 'also rollback' }, paths);
      throw new Error('undo upsert');
    }),
    /undo upsert/,
  );
  assert.equal((await repo.findOneByOrFail({ id: initial.id })).title, 'batch update');
  assert.equal(await repo.count(), 2);
  // The second row fails at the server's primary-key index, after the first write.
  await assert.rejects(
    repo.upsert(
      [
        { tenant: 'a', slug: 'one', title: 'rollback after actual write' },
        { id: initial.id, tenant: 'collision', slug: 'new', title: 'duplicate primary key' },
      ],
      paths,
    ),
    /duplicat/i,
  );
  assert.equal((await repo.findOneByOrFail({ id: initial.id })).title, 'batch update');
  assert.equal(await repo.count(), 2);
  const concurrent = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      repo.upsert({ tenant: 'race', slug: 'same', title: 'writer ' + i }, paths),
    ),
  );
  assert.ok(concurrent.some((r) => r.status === 'fulfilled'));
  for (const result of concurrent) {
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof QueryFailedError);
      assert.match(result.reason.message, /concurrent|duplicat|retry|lock|conflict/i);
    }
  }
  assert.equal(await repo.countBy({ tenant: 'race', slug: 'same' }), 1);
  const raced = await repo.findOneByOrFail({ tenant: 'race', slug: 'same' });
  for (const result of concurrent.filter((result) => result.status === 'fulfilled'))
    assert.equal(result.value.identifiers[0].id, raced.id);
  const updates = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      repo.upsert({ tenant: 'race', slug: 'same', title: 'update ' + i }, paths),
    ),
  );
  for (const result of updates.filter((result) => result.status === 'rejected')) {
    assert.ok(result.reason instanceof QueryFailedError);
    assert.match(result.reason.message, /concurrent|duplicat|retry|lock|conflict/i);
  }
  assert.equal(
    (await repo.findOneByOrFail({ id: raced.id })).version,
    raced.version + updates.filter((result) => result.status === 'fulfilled').length,
  );

  for (const invalid of [
    () => repo.upsert({ tenant: 'a', title: 'missing' }, paths),
    () => repo.upsert({ tenant: 'a', slug: null, title: 'null' }, paths),
    () => repo.upsert({ tenant: 'a', slug: 'one', title: 'unindexed' }, ['title']),
    () =>
      repo.upsert(
        { tenant: 'a', slug: 'one', title: 'partial' },
        { conflictPaths: paths, indexPredicate: 'tenant IS NOT NULL' },
      ),
    () =>
      repo.upsert(
        { tenant: 'a', slug: 'one', title: 'skip' },
        { conflictPaths: paths, skipUpdateIfNoValuesChanged: true },
      ),
  ])
    await assert.rejects(invalid, /upsert|conflict|unique/i);
  assert.equal((await repo.findOneByOrFail({ id: initial.id })).title, 'batch update');
  const runner = db.createQueryRunner();
  try {
    await runner.dropUniqueConstraint('test_upsert_item', 'uq_upsert_tenant_slug');
    await assert.rejects(
      repo.upsert({ tenant: 'a', slug: 'one', title: 'no installed index' }, paths),
      /installed unique index/,
    );
  } finally {
    await runner.release();
  }
});

test('insert/delete returning and duplicate ignore preserve result identity and atomicity', async (t) => {
  const Item = new EntitySchema({
    name: 'InsertReturns',
    tableName: 'test_insert_returns',
    columns: {
      id: { type: 'uuid', primary: true, generated: 'uuid' },
      slug: { type: String, unique: true },
      title: { name: 'stored_title', type: String },
      count: { type: Number, default: 99 },
      createdAt: { type: Date, createDate: true },
    },
  });
  const db = await new ArcadeDataSource({ ...options, entities: [Item] }).initialize();
  t.after(() => db.destroy());
  const repo = db.getRepository(Item);
  await repo.clear();
  const inserted = await repo
    .createQueryBuilder()
    .insert()
    .values({ slug: 'one', title: 'first' })
    .returning(['title'])
    .execute();
  assert.deepEqual(inserted.raw, [{ stored_title: 'first' }]);
  assert.match(inserted.identifiers[0].id, /^[\da-f-]{36}$/);
  assert.equal(inserted.generatedMaps[0].count, 99);
  assert.ok(inserted.generatedMaps[0].createdAt instanceof Date);
  const events = [];
  db.subscribers.push({
    afterInsert(event) {
      events.push(event.entity.slug);
    },
  });
  const ignored = await repo
    .createQueryBuilder()
    .insert()
    .values([
      { slug: 'one', title: 'skip first' },
      { slug: 'two', title: 'insert second' },
      { slug: 'two', title: 'skip third' },
      { slug: 'three', title: 'insert fourth' },
    ])
    .orIgnore()
    .returning('*')
    .execute();
  assert.deepEqual(
    ignored.raw.map((row) => row.slug),
    ['two', 'three'],
  );
  assert.deepEqual(events, ['two', 'three']);
  assert.equal(ignored.identifiers.length, 2);
  assert.equal(ignored.generatedMaps.length, 2);
  for (let i = 0; i < 2; i++) assert.equal(ignored.identifiers[i].id, ignored.raw[i].id);
  assert.equal((await repo.findOneByOrFail({ slug: 'one' })).title, 'first');
  const allSkipped = await repo
    .createQueryBuilder()
    .insert()
    .values({ slug: 'one', title: 'skip' })
    .orIgnore()
    .execute();
  assert.deepEqual(allSkipped.raw, []);
  assert.deepEqual(allSkipped.identifiers, []);
  await assert.rejects(
    repo
      .createQueryBuilder()
      .insert()
      .values([
        { slug: 'rollback', title: 'rollback' },
        { slug: 'invalid', title: null },
      ])
      .orIgnore()
      .execute(),
    /null/i,
  );
  assert.equal(await repo.countBy({ slug: 'rollback' }), 0);
  await assert.rejects(
    db.transaction(async (manager) => {
      const removed = await manager
        .createQueryBuilder()
        .delete()
        .from(Item)
        .where({ slug: 'two' })
        .output(['title', 'count'])
        .execute();
      assert.equal(removed.affected, 1);
      assert.deepEqual(removed.raw, [{ stored_title: 'insert second', count: 99 }]);
      throw new Error('restore deletion');
    }),
    /restore deletion/,
  );
  assert.equal(await repo.count(), 3);
  const deleted = await repo
    .createQueryBuilder()
    .delete()
    .where('slug IN (:...slugs)', { slugs: ['two', 'three'] })
    .returning('*')
    .execute();
  assert.equal(deleted.affected, 2);
  assert.equal(deleted.raw.length, 2);
  const absent = await repo
    .createQueryBuilder()
    .delete()
    .where({ slug: 'absent' })
    .returning(['id'])
    .execute();
  assert.equal(absent.affected, 0);
  assert.deepEqual(absent.raw, []);
});
