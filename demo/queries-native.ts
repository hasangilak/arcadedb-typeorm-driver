import type { ArcadeDataSource } from '../src';
import { accountSchema } from './seeders/02-accounts';
import { catalogSchema } from './seeders/03-catalog';

export const nativeQueries = {
  async namedParameters(db: ArcadeDataSource) {
    return db.query('SELECT id FROM demo_accounts WHERE id = :id AND country = :country', {
      id: 'ada',
      country: 'DE',
    });
  },
  async managerSql(db: ArcadeDataSource) {
    return db.manager.sql`SELECT id FROM demo_accounts WHERE id = ${'grace'}`;
  },
  async runnerQuery(db: ArcadeDataSource) {
    const runner = db.createQueryRunner();
    try {
      return await runner.query('SELECT id FROM demo_accounts WHERE id = :p0', ['linus']);
    } finally {
      await runner.release();
    }
  },
  async readCommitted(db: ArcadeDataSource) {
    return db.transaction('READ COMMITTED', async (manager) =>
      (await manager.find(accountSchema, { where: { active: true }, order: { id: 'ASC' } })).map(
        (row) => row.id,
      ),
    );
  },
  async repeatableRead(db: ArcadeDataSource) {
    return db.transaction('REPEATABLE READ', async (manager) =>
      (await manager.find(catalogSchema, { order: { id: 'ASC' } })).map((row) => row.id),
    );
  },
  async graphIncoming(db: ArcadeDataSource) {
    const rows = await db.query(
      "SELECT expand(in('demo_placed')) FROM demo_order_vertex WHERE order_id = :p0",
      ['legacy-order'],
    );
    return rows.map((row: { account_id: string }) => row.account_id).sort();
  },
  async graphEdgeCount(db: ArcadeDataSource) {
    return db.query(
      "SELECT account_id, out('demo_placed').size() AS orders FROM demo_customer_vertex ORDER BY account_id",
    );
  },
  async nativeUnwind(db: ArcadeDataSource) {
    return db.query(
      'SELECT FROM (SELECT tags AS tag FROM demo_catalog UNWIND tag) WHERE tag IS NOT NULL ORDER BY tag',
    );
  },
};
