import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class RenameCatalog1800000000016 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.renameTable('demo_products', 'demo_catalog');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.renameTable('demo_catalog', 'demo_products');
  }
}
