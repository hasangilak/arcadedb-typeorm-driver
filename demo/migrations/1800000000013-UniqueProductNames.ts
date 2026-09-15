import { TableUnique, type MigrationInterface, type QueryRunner } from 'typeorm';

export class UniqueProductNames1800000000013 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createUniqueConstraints('demo_products', [
      new TableUnique({ name: 'uq_demo_product_name', columnNames: ['name'] }),
    ]);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropUniqueConstraints('demo_products', [
      new TableUnique({ name: 'uq_demo_product_name', columnNames: ['name'] }),
    ]);
  }
}
