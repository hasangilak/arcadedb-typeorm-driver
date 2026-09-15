import { Table, type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateAccounts1800000000001 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'demo_accounts',
        columns: [
          { name: 'id', type: 'string', isPrimary: true },
          { name: 'name', type: 'string' },
        ],
      }),
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropTable('demo_accounts');
  }
}
