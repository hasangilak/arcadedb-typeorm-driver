import type { ArcadeDataSource } from '../src';
import { scratch } from './query-scratch';

/** Examples 101–106: native conflict updates and returned records through TypeORM. */
export const upsertQueries = {
  async upsertInsert(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const result = await repo.upsert({ id: 'first', title: 'inserted' }, ['id']);
      return {
        id: result.identifiers[0].id,
        title: result.raw[0].title,
        version: result.generatedMaps[0].version,
      };
    });
  },
  async upsertConflict(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      await repo.upsert({ id: 'same', title: 'before' }, ['id']);
      const result = await repo.upsert({ id: 'same', title: 'after' }, ['id']);
      return {
        count: await repo.count(),
        title: result.raw[0].title,
        version: result.generatedMaps[0].version,
      };
    });
  },
  async upsertBatch(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      await repo.upsert({ id: 'one', title: 'before' }, ['id']);
      const result = await repo.upsert(
        [
          { id: 'one', title: 'updated' },
          { id: 'two', title: 'inserted' },
        ],
        ['id'],
      );
      return {
        ids: result.identifiers.map((id) => id.id),
        titles: result.raw.map((row: { title: string }) => row.title),
      };
    });
  },
  async upsertRollback(db: ArcadeDataSource) {
    return scratch(db, async (repo, source) => {
      await repo.upsert({ id: 'one', title: 'original' }, ['id']);
      try {
        await source.transaction(async (manager) => {
          await manager.upsert(repo.target, { id: 'one', title: 'rolled back' }, ['id']);
          throw new Error('demo rollback');
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'demo rollback') throw error;
      }
      return (await repo.findOneByOrFail({ id: 'one' })).title;
    });
  },
  async updateReturning(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      await repo.save({ id: 'one', title: 'before' });
      const result = await repo
        .createQueryBuilder()
        .update()
        .set({ title: 'after' })
        .where({ id: 'one' })
        .returning(['id', 'title'])
        .execute();
      return { affected: result.affected, id: result.raw[0].id, title: result.raw[0].title };
    });
  },
  async softDeleteReturning(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      await repo.save({ id: 'one', title: 'temporary' });
      const result = await repo
        .createQueryBuilder()
        .softDelete()
        .where({ id: 'one' })
        .returning('*')
        .execute();
      return {
        affected: result.affected,
        deleted: result.raw[0].deletedAt !== null,
        visible: await repo.count(),
      };
    });
  },
};
