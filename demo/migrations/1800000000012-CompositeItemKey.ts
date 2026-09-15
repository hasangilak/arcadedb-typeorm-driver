import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CompositeItemKey1800000000012 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createPrimaryKey('demo_order_items', ['order_id', 'product_id']);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropPrimaryKey('demo_order_items');
  }
}
