import type { ArcadeDataSource } from '../src';
import { scratch } from './query-scratch';

export const writeQueries = {
  async saveNew(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const note = await repo.save(repo.create({ title: 'new' }));
      return {
        title: note.title,
        score: note.score,
        version: note.version,
        generatedId: /^[\da-f-]{36}$/.test(note.id),
      };
    });
  },
  async saveExisting(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const note = await repo.save({ title: 'old' });
      note.title = 'changed';
      await repo.save(note);
      const saved = await repo.findOneByOrFail({ id: note.id });
      return { title: saved.title, version: saved.version };
    });
  },
  async saveBatch(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      await repo.save([{ title: 'one' }, { title: 'two' }], { chunk: 1 });
      return (await repo.find({ order: { title: 'ASC' } })).map((row) => row.title);
    });
  },
  async insertBatch(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const result = await repo.insert([{ title: 'one' }, { title: 'two' }]);
      return { inserted: result.identifiers.length, count: await repo.count() };
    });
  },
  async updateCriteria(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      await repo.save({ title: 'target' });
      const result = await repo.update({ title: 'target' }, { score: 7 });
      return {
        affected: result.affected,
        score: (await repo.findOneByOrFail({ title: 'target' })).score,
      };
    });
  },
  async updateByIds(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const rows = await repo.save([{ title: 'one' }, { title: 'two' }]);
      const result = await repo.update(
        rows.map((row) => row.id),
        { score: 8 },
      );
      return { affected: result.affected, scores: (await repo.find()).map((row) => row.score) };
    });
  },
  async deleteCriteria(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      await repo.save([{ title: 'one' }, { title: 'two' }]);
      const result = await repo.delete({ title: 'one' });
      return { affected: result.affected, count: await repo.count() };
    });
  },
  async removeEntity(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const row = await repo.save({ title: 'remove' });
      await repo.remove(row);
      return repo.count();
    });
  },
  async preloadAndSave(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const original = await repo.save({ title: 'old', score: 4 });
      const merged = await repo.preload({ id: original.id, title: 'merged' });
      if (!merged) throw new Error('Expected preloaded note');
      await repo.save(merged);
      const row = await repo.findOneByOrFail({ id: original.id });
      return { title: row.title, score: row.score };
    });
  },
  async increment(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const row = await repo.save({ title: 'counter', score: 3 });
      await repo.increment({ id: row.id }, 'score', 2);
      return (await repo.findOneByOrFail({ id: row.id })).score;
    });
  },
  async decrement(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const row = await repo.save({ title: 'counter', score: 3 });
      await repo.decrement({ id: row.id }, 'score', 2);
      return (await repo.findOneByOrFail({ id: row.id })).score;
    });
  },
  async clearScratch(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      await repo.save([{ title: 'one' }, { title: 'two' }]);
      await repo.clear();
      return repo.count();
    });
  },
  async softDelete(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const row = await repo.save({ title: 'soft' });
      await repo.softDelete(row.id);
      const deleted = await repo.findOneOrFail({ where: { id: row.id }, withDeleted: true });
      return { visible: await repo.count(), deleted: deleted.deletedAt instanceof Date };
    });
  },
  async restore(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const row = await repo.save({ title: 'restore' });
      await repo.softDelete(row.id);
      await repo.restore(row.id);
      return {
        visible: await repo.count(),
        deletedAt: (await repo.findOneByOrFail({ id: row.id })).deletedAt,
      };
    });
  },
  async softRemove(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const row = await repo.save({ title: 'soft' });
      await repo.softRemove(row);
      const deleted = await repo
        .createQueryBuilder('note')
        .withDeleted()
        .where('note.id = :id', { id: row.id })
        .getOneOrFail();
      return { visible: await repo.count(), deleted: deleted.deletedAt instanceof Date };
    });
  },
  async recover(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const row = await repo.save({ title: 'recover' });
      await repo.softRemove(row);
      await repo.recover(row);
      return {
        visible: await repo.count(),
        deletedAt: (await repo.findOneByOrFail({ id: row.id })).deletedAt,
      };
    });
  },
  async builderInsert(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const result = await repo
        .createQueryBuilder()
        .insert()
        .values({ title: 'builder' })
        .execute();
      return {
        inserted: result.identifiers.length,
        title: (await repo.findOneByOrFail({ id: result.identifiers[0].id })).title,
      };
    });
  },
  async builderDelete(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const row = await repo.save({ title: 'delete' });
      const result = await repo
        .createQueryBuilder()
        .delete()
        .where('id = :id', { id: row.id })
        .execute();
      return { affected: result.affected, count: await repo.count() };
    });
  },
  async builderSoftDelete(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const row = await repo.save({ title: 'soft' });
      const result = await repo.createQueryBuilder().softDelete().whereInIds([row.id]).execute();
      return { affected: result.affected, visible: await repo.count() };
    });
  },
  async builderRestore(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const row = await repo.save({ title: 'restore' });
      await repo.softDelete(row.id);
      const result = await repo.createQueryBuilder().restore().whereInIds([row.id]).execute();
      return { affected: result.affected, visible: await repo.count() };
    });
  },
  async transactionRollback(db: ArcadeDataSource) {
    return scratch(db, async (repo, source) => {
      const rollback = new Error('Intentional rollback');
      try {
        await source.transaction(async (manager) => {
          await manager.getRepository(repo.target).save({ title: 'never committed' });
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
      return repo.count();
    });
  },
};
