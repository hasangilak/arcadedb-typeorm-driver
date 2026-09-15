import { TableColumn, type MigrationInterface, type QueryRunner } from 'typeorm';

export class BackfillMoneyStorage1800000000015 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('UPDATE demo_products SET price_cents = price');
    await q.changeColumn(
      'demo_products',
      'price_cents',
      new TableColumn({ name: 'price_cents', type: 'long' }),
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.changeColumn(
      'demo_products',
      'price_cents',
      new TableColumn({ name: 'price_cents', type: 'long', isNullable: true }),
    );
    await q.query('UPDATE demo_products SET price_cents = null');
  }
}
