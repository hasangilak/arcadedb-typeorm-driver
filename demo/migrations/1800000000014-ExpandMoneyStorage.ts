import { TableColumn, type MigrationInterface, type QueryRunner } from 'typeorm';

export class ExpandMoneyStorage1800000000014 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.addColumn(
      'demo_products',
      new TableColumn({ name: 'price_cents', type: 'long', isNullable: true }),
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropColumn('demo_products', 'price_cents');
  }
}
