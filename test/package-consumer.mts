import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource, EntitySchema } from 'typeorm';
import { ArcadeDataSource, type ArcadeDataSourceOptions } from 'arcadedb-typeorm-driver';

interface Note {
  id: string;
  title: string;
}
const Note = new EntitySchema<Note>({
  name: 'PackageNote',
  tableName: 'package_notes',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    title: { type: String },
  },
});
const options: ArcadeDataSourceOptions = {
  database: 'package_test_' + randomUUID().replaceAll('-', ''),
  url: process.env.ARCADEDB_URL ?? 'http://127.0.0.1:2480',
  username: process.env.ARCADEDB_USERNAME ?? 'root',
  password: process.env.ARCADEDB_PASSWORD ?? 'integration-password',
  entities: [Note],
  createDatabase: true,
  synchronize: true,
};
const db = new ArcadeDataSource(options);
assert.ok(db instanceof DataSource);
await db.initialize();
try {
  const repo = db.getRepository(Note);
  const note = await repo.save({ title: 'external consumer' });
  assert.deepEqual(await repo.findOneByOrFail({ id: note.id }), note);
  const upserted = await repo.upsert({ id: note.id, title: 'upserted' }, ['id']);
  assert.equal(upserted.identifiers[0].id, note.id);
  const updated = await repo
    .createQueryBuilder()
    .update()
    .set({ title: 'returned' })
    .where({ id: note.id })
    .returning(['id', 'title'])
    .execute();
  assert.equal(updated.affected, 1);
  assert.equal(updated.raw[0].title, 'returned');
  await assert.rejects(
    db.transaction(async (manager) => {
      await manager.update(Note, note.id, { title: 'rollback' });
      throw new Error('undo');
    }),
    /undo/,
  );
  assert.equal((await repo.findOneByOrFail({ id: note.id })).title, 'returned');
} finally {
  await db.destroy();
  await db.driver.request('server', { command: 'drop database ' + options.database });
}
