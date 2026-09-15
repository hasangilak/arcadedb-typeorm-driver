import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class GraphProjection1800000000020 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE VERTEX TYPE demo_customer_vertex');
    await q.query('CREATE PROPERTY demo_customer_vertex.account_id STRING');
    await q.query('CREATE INDEX uq_demo_vertex ON demo_customer_vertex (account_id) UNIQUE');
    await q.query('CREATE VERTEX TYPE demo_order_vertex');
    await q.query('CREATE PROPERTY demo_order_vertex.order_id STRING');
    await q.query('CREATE INDEX uq_demo_order_vertex ON demo_order_vertex (order_id) UNIQUE');
    await q.query('CREATE EDGE TYPE demo_placed');
    await q.query('CREATE PROPERTY demo_placed.order_id STRING');
    await q.query('CREATE INDEX uq_demo_placed ON demo_placed (order_id) UNIQUE');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DELETE FROM demo_placed');
    await q.query('DELETE FROM demo_order_vertex');
    await q.query('DELETE FROM demo_customer_vertex');
    await q.dropTable('demo_placed');
    await q.dropTable('demo_order_vertex');
    await q.dropTable('demo_customer_vertex');
  }
}
