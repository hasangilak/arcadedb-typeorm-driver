import { Table, type MigrationInterface, type QueryRunner } from 'typeorm';

export class MaterializeOrderTotals1800000000018 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'demo_order_totals',
        columns: [
          { name: 'order_id', type: 'string', isPrimary: true },
          { name: 'total_cents', type: 'long' },
        ],
      }),
    );
    await q.query(
      'INSERT INTO demo_order_totals FROM SELECT order_id, sum(quantity * unit_price) AS total_cents FROM demo_order_items GROUP BY order_id',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropTable('demo_order_totals');
  }
}
