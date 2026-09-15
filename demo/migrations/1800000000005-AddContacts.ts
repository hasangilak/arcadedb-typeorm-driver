import { TableColumn, type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddContacts1800000000005 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.addColumns('demo_accounts', [
      new TableColumn({ name: 'email', type: 'string', isNullable: true }),
      new TableColumn({ name: 'country', type: 'string', isNullable: true }),
    ]);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropColumns('demo_accounts', ['email', 'country']);
  }
}
