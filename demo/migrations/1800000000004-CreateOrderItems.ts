import { Table, type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateOrderItems1800000000004 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'demo_order_items',
        columns: [
          { name: 'order_id', type: 'string' },
          { name: 'product_id', type: 'string' },
          { name: 'quantity', type: 'integer' },
          { name: 'unit_price', type: 'integer' },
        ],
      }),
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropTable('demo_order_items');
  }
}
