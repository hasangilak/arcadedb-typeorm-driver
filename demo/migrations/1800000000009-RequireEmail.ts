import { TableColumn, type MigrationInterface, type QueryRunner } from 'typeorm';

export class RequireEmail1800000000009 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.changeColumn(
      'demo_accounts',
      'email',
      new TableColumn({ name: 'email', type: 'string' }),
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.changeColumn(
      'demo_accounts',
      'email',
      new TableColumn({ name: 'email', type: 'string', isNullable: true }),
    );
  }
}
