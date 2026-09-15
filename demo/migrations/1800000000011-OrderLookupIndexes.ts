import { TableIndex, type MigrationInterface, type QueryRunner } from 'typeorm';

export class OrderLookupIndexes1800000000011 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createIndices('demo_orders', [
      new TableIndex({ name: 'idx_demo_order_account', columnNames: ['account_id'] }),
      new TableIndex({ name: 'idx_demo_order_status', columnNames: ['status'] }),
    ]);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropIndices('demo_orders', [
      new TableIndex({ name: 'idx_demo_order_status', columnNames: ['status'] }),
      new TableIndex({ name: 'idx_demo_order_account', columnNames: ['account_id'] }),
    ]);
  }
}
