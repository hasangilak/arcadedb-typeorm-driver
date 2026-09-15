import { Table, type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateOrders1800000000003 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'demo_orders',
        columns: [
          { name: 'id', type: 'string', isPrimary: true },
          { name: 'account_id', type: 'string' },
          { name: 'status', type: 'string', default: "'pending'" },
        ],
      }),
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropTable('demo_orders');
  }
}
