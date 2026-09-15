import { TableIndex, type MigrationInterface, type QueryRunner } from 'typeorm';

export class ReplaceOrderIndexes1800000000021 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.dropIndex('demo_orders', 'idx_demo_order_status');
    await q.createIndex(
      'demo_orders',
      new TableIndex({
        name: 'idx_demo_order_account_status',
        columnNames: ['account_id', 'status'],
      }),
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropIndex('demo_orders', 'idx_demo_order_account_status');
    await q.createIndex(
      'demo_orders',
      new TableIndex({ name: 'idx_demo_order_status', columnNames: ['status'] }),
    );
  }
}
