import { TableColumn, type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddDocumentFields1800000000006 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.addColumns('demo_products', [
      new TableColumn({ name: 'attributes', type: 'json', default: '{}' }),
      new TableColumn({ name: 'tags', type: 'array', default: '[]' }),
    ]);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropColumns('demo_products', ['attributes', 'tags']);
  }
}
