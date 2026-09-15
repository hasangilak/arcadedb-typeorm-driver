import { Any, ArrayContains, ArrayContainedBy, ArrayOverlap, Not } from 'typeorm';
import type { ArcadeDataSource } from '../src';
import { scratch } from './query-scratch';
import { catalogSchema } from './seeders/03-catalog';

/** Examples 107–116: returned writes, conflicts, array predicates and server deadlines. */
export const extensionQueries = {
  async insertReturning(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      const result = await repo
        .createQueryBuilder()
        .insert()
        .values({ id: 'one', title: 'inserted' })
        .returning(['title'])
        .execute();
      return { raw: result.raw, inserted: result.identifiers.length };
    });
  },
  async deleteReturning(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      await repo.insert({ id: 'one', title: 'removed', score: 7 });
      const result = await repo
        .createQueryBuilder()
        .delete()
        .where({ id: 'one' })
        .output(['title', 'score'])
        .execute();
      return { raw: result.raw, affected: result.affected };
    });
  },
  async ignoreDuplicates(db: ArcadeDataSource) {
    return scratch(db, async (repo) => {
      await repo.insert({ id: 'one', title: 'original' });
      const result = await repo
        .createQueryBuilder()
        .insert()
        .values([
          { id: 'one', title: 'ignored' },
          { id: 'two', title: 'inserted' },
        ])
        .orIgnore()
        .execute();
      return { ids: result.identifiers.map((row) => row.id), count: await repo.count() };
    });
  },
  async upsertNamedConstraint(db: ArcadeDataSource) {
    return scratch(db, async (repo, source) => {
      await repo.insert({ id: 'one', title: 'original' });
      const constraint = source.namingStrategy.primaryKeyName(repo.metadata.tableName, ['id']);
      const result = await repo
        .createQueryBuilder()
        .insert()
        .values({ id: 'one', title: 'updated' })
        .orUpdate(['title'], constraint)
        .returning(['id', 'title'])
        .execute();
      return result.raw;
    });
  },
  async arrayContains(db: ArcadeDataSource) {
    const rows = await db.getRepository(catalogSchema).find({
      where: { tags: ArrayContains(['database']) },
      order: { id: 'ASC' },
    });
    return rows.map((row) => row.id);
  },
  async arrayContainedBy(db: ArcadeDataSource) {
    const rows = await db.getRepository(catalogSchema).find({
      where: { tags: ArrayContainedBy(['database', 'learning']) },
      order: { id: 'ASC' },
    });
    return rows.map((row) => row.id);
  },
  async arrayOverlap(db: ArcadeDataSource) {
    const rows = await db.getRepository(catalogSchema).find({
      where: { tags: ArrayOverlap(['graph', 'learning']) },
      order: { id: 'ASC' },
    });
    return rows.map((row) => row.id);
  },
  async arrayAny(db: ArcadeDataSource) {
    const rows = await db.getRepository(catalogSchema).find({
      where: { id: Any(['book', 'support']) },
      order: { id: 'ASC' },
    });
    return rows.map((row) => row.id);
  },
  async arrayNegation(db: ArcadeDataSource) {
    const rows = await db.getRepository(catalogSchema).find({
      where: { tags: Not(ArrayOverlap(['graph'])) },
      order: { id: 'ASC' },
    });
    return rows.map((row) => row.id);
  },
  async queryDeadline(db: ArcadeDataSource) {
    const rows = await db
      .getRepository(catalogSchema)
      .createQueryBuilder('product')
      .orderBy('product.id', 'ASC')
      .skip(1)
      .take(1)
      .maxExecutionTime(1000)
      .getMany();
    return rows.map((row) => row.id);
  },
};
