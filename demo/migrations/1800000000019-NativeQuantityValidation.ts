import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class NativeQuantityValidation1800000000019 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER PROPERTY demo_order_items.quantity MIN 1');
    await q.query('ALTER PROPERTY demo_order_items.quantity MAX 1000');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER PROPERTY demo_order_items.quantity MIN null');
    await q.query('ALTER PROPERTY demo_order_items.quantity MAX null');
  }
}
