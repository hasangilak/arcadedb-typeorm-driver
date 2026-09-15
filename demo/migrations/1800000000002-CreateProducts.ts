import { Table, type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateProducts1800000000002 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'demo_products',
        columns: [
          { name: 'id', type: 'string', isPrimary: true },
          { name: 'name', type: 'string' },
          { name: 'price', type: 'integer' },
        ],
      }),
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropTable('demo_products');
  }
}
