import { Table, type MigrationInterface, type QueryRunner } from 'typeorm';

export class ArchiveAccountSnapshot1800000000023 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'demo_account_archive',
        columns: [
          { name: 'account_id', type: 'string', isPrimary: true },
          { name: 'display_name', type: 'string' },
          { name: 'email', type: 'string' },
        ],
      }),
    );
    await q.query(
      'INSERT INTO demo_account_archive FROM SELECT id AS account_id, display_name, email FROM demo_accounts',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropTable('demo_account_archive');
  }
}
