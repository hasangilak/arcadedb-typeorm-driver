import { TableColumn, type MigrationInterface, type QueryRunner } from 'typeorm';

export class ReplaceCompositeKey1800000000022 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.addColumn(
      'demo_order_items',
      new TableColumn({ name: 'line_id', type: 'string', isNullable: true }),
    );
    await q.query("UPDATE demo_order_items SET line_id = order_id + ':' + product_id");
    await q.updatePrimaryKeys('demo_order_items', [
      new TableColumn({ name: 'line_id', type: 'string', isPrimary: true }),
    ]);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.updatePrimaryKeys('demo_order_items', [
      new TableColumn({ name: 'order_id', type: 'string', isPrimary: true }),
      new TableColumn({ name: 'product_id', type: 'string', isPrimary: true }),
    ]);
    await q.dropColumn('demo_order_items', 'line_id');
  }
}
