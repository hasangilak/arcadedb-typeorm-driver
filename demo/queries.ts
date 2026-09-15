import { upsertQueries } from './queries-upsert';
import { randomUUID } from 'node:crypto';
import { Between, Brackets, In, Like } from 'typeorm';
import type { ArcadeDataSource } from '../src';
import { accountSchema } from './seeders/02-accounts';
import { catalogSchema } from './seeders/03-catalog';
import { itemSchema, orderSchema, totalSchema } from './seeders/04-orders';
import { repositoryQueries } from './queries-repository';
import { builderQueries } from './queries-builder';
import { writeQueries } from './queries-writes';
import { nativeQueries } from './queries-native';

/** Run after all demo migrations and seeders. Each function can be called independently. */
export const queries = {
  // BASIC: repositories hydrate database records into entity objects.
  async findAccount(db: ArcadeDataSource) {
    return db.getRepository(accountSchema).findOneByOrFail({ id: 'ada' });
  },

  async activeAccounts(db: ArcadeDataSource) {
    const rows = await db.getRepository(accountSchema).find({
      where: { active: true },
      order: { id: 'ASC' },
    });
    return rows.map((row) => row.id);
  },

  async priceRange(db: ArcadeDataSource) {
    const rows = await db.getRepository(catalogSchema).find({
      where: { price_cents: Between(2500, 8000) },
      order: { price_cents: 'ASC', id: 'ASC' },
    });
    return rows.map((row) => row.id);
  },

  async selectedProducts(db: ArcadeDataSource) {
    const rows = await db.getRepository(catalogSchema).find({
      where: { id: In(['course', 'book']) },
      order: { id: 'ASC' },
    });
    return rows.map((row) => row.id);
  },

  async countPendingOrders(db: ArcadeDataSource) {
    return db.getRepository(orderSchema).countBy({ status: 'pending' });
  },

  async accountProjection(db: ArcadeDataSource) {
    return db.getRepository(accountSchema).find({
      select: { id: true, display_name: true },
      order: { id: 'ASC' },
    });
  },

  // INTERMEDIATE: single-entity query builders, grouping and stable pagination.
  async nestedConditions(db: ArcadeDataSource) {
    const rows = await db
      .getRepository(accountSchema)
      .createQueryBuilder('account')
      .where('account.active = :active', { active: true })
      .andWhere(
        new Brackets((where) => {
          where
            .where('account.country = :country', { country: 'DE' })
            .orWhere('account.id IN (:...ids)', { ids: ['grace'] });
        }),
      )
      .orderBy('account.id', 'ASC')
      .getMany();
    return rows.map((row) => row.id);
  },

  async offsetPage(db: ArcadeDataSource) {
    const [rows, total] = await db
      .getRepository(catalogSchema)
      .createQueryBuilder('product')
      .orderBy('product.price_cents', 'ASC')
      .addOrderBy('product.id', 'ASC')
      .skip(1)
      .take(1)
      .getManyAndCount();
    return { ids: rows.map((row) => row.id), total };
  },

  async cursorPage(db: ArcadeDataSource) {
    // The last row on the preceding page was (2500, 'book'). Include the ID to break ties.
    const rows = await db
      .getRepository(catalogSchema)
      .createQueryBuilder('product')
      .where(
        new Brackets((where) => {
          where
            .where('product.price_cents > :price', { price: 2500 })
            .orWhere('(product.price_cents = :price AND product.id > :id)', {
              price: 2500,
              id: 'book',
            });
        }),
      )
      .orderBy('product.price_cents', 'ASC')
      .addOrderBy('product.id', 'ASC')
      .take(2)
      .getMany();
    return rows.map((row) => row.id);
  },

  async nameSearch(db: ArcadeDataSource) {
    const rows = await db.getRepository(catalogSchema).find({
      where: { name: Like('Database%') },
      order: { id: 'ASC' },
    });
    return rows.map((row) => row.id);
  },

  async salesSummary(db: ArcadeDataSource) {
    // Aggregate projections use getRawOne(), not entity hydration.
    return db
      .getRepository(itemSchema)
      .createQueryBuilder('item')
      .select('sum(item.quantity)', 'units')
      .addSelect('sum(item.quantity * item.unit_price)', 'revenue_cents')
      .getRawOne();
  },

  async totalsByOrder(db: ArcadeDataSource) {
    return db
      .getRepository(itemSchema)
      .createQueryBuilder('item')
      .select('item.order_id', 'order_id')
      .addSelect('sum(item.quantity * item.unit_price)', 'total_cents')
      .groupBy('item.order_id')
      .orderBy('item.order_id', 'ASC')
      .getRawMany();
  },

  async dateWindow(db: ArcadeDataSource) {
    // Find operators apply the driver's UTC date conversion.
    const rows = await db.getRepository(orderSchema).find({
      where: {
        created_at: Between(new Date('2026-09-15T00:00:00Z'), new Date('2026-09-15T23:59:59.999Z')),
      },
      order: { id: 'ASC' },
    });
    return rows.map((row) => row.id);
  },

  async distinctStatuses(db: ArcadeDataSource) {
    return db
      .getRepository(orderSchema)
      .createQueryBuilder('order')
      .select('order.status', 'status')
      .distinct()
      .orderBy('order.status', 'ASC')
      .getRawMany();
  },

  // ADVANCED NATIVE SQL: parameterized through the same DataSource and HTTP driver.
  // These are ArcadeDB expressions, not TypeORM relation joins or aliased ORM subqueries.
  async nestedDocuments(db: ArcadeDataSource) {
    return db.query(
      'SELECT id, attributes.pages AS pages FROM demo_catalog WHERE attributes.format = :p0 ORDER BY id',
      ['paper'],
    );
  },

  async arrayMembership(db: ArcadeDataSource) {
    return db.sql`SELECT id FROM demo_catalog WHERE tags CONTAINS ${'learning'} ORDER BY id`;
  },

  async highValueOrders(db: ArcadeDataSource) {
    return db.query(
      `SELECT id, account_id FROM demo_orders
      WHERE id IN (SELECT order_id FROM demo_order_totals WHERE total_cents >= :p0)
      ORDER BY id`,
      [10000],
    );
  },

  async customerOrders(db: ArcadeDataSource) {
    const rows = await db.query(
      "SELECT expand(out('demo_placed')) FROM demo_customer_vertex WHERE account_id = :p0",
      ['ada'],
    );
    // Graph records are native objects with @rid, not TypeORM entity instances.
    return rows.map((row: { order_id: string }) => row.order_id).sort();
  },

  async graphPattern(db: ArcadeDataSource) {
    return db.query(
      `MATCH {type: demo_customer_vertex, as: customer, where: (account_id = :p0)}
      .out('demo_placed'){type: demo_order_vertex, as: placed}
      RETURN customer.account_id AS account_id, placed.order_id AS order_id`,
      ['ada'],
    );
  },

  // WRITES: the first example previews an atomic change and always rolls it back.
  async atomicRecalculation(db: ArcadeDataSource) {
    const runner = db.createQueryRunner();
    try {
      await runner.startTransaction();
      const items = runner.manager.getRepository(itemSchema);
      await items
        .createQueryBuilder()
        .update()
        .set({ quantity: () => 'quantity + 1' })
        .where('line_id = :id', { id: 'legacy-order:book' })
        .execute();
      const [total] = await runner.query(
        'SELECT sum(quantity * unit_price) AS total_cents FROM demo_order_items WHERE order_id = :p0',
        ['legacy-order'],
      );
      await runner.manager
        .getRepository(totalSchema)
        .update({ order_id: 'legacy-order' }, { total_cents: total.total_cents });
      const item = await items.findOneByOrFail({ line_id: 'legacy-order:book' });
      const storedTotal = await runner.manager
        .getRepository(totalSchema)
        .findOneByOrFail({ order_id: 'legacy-order' });
      return { quantity: item.quantity, total_cents: storedTotal.total_cents };
    } finally {
      try {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
      } finally {
        await runner.release();
      }
    }
  },

  async insertUpdateDelete(db: ArcadeDataSource) {
    // Successful transaction commits; its temporary record is deleted within that transaction.
    return db.transaction(async (manager) => {
      const accounts = manager.getRepository(accountSchema);
      const id = 'query-' + randomUUID();
      const inserted = await accounts.insert({
        id,
        display_name: 'Query example',
        email: id + '@example.test',
        country: 'DE',
        active: true,
      });
      const updated = await accounts.update({ id }, { display_name: 'Updated example' });
      const deleted = await accounts.delete({ id });
      return {
        inserted: inserted.identifiers.length,
        updated: updated.affected,
        deleted: deleted.affected,
      };
    });
  },
  ...repositoryQueries,
  ...builderQueries,
  ...writeQueries,
  ...nativeQueries,
  ...upsertQueries,
};
