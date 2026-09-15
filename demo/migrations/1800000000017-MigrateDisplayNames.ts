import { TableColumn, type MigrationInterface, type QueryRunner } from 'typeorm';

export class MigrateDisplayNames1800000000017 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.addColumn(
      'demo_accounts',
      new TableColumn({ name: 'display_name', type: 'string', isNullable: true }),
    );
    await q.query('UPDATE demo_accounts SET display_name = name');
    await q.changeColumn(
      'demo_accounts',
      'display_name',
      new TableColumn({ name: 'display_name', type: 'string' }),
    );
    await q.dropColumn('demo_accounts', 'name');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.addColumn(
      'demo_accounts',
      new TableColumn({ name: 'name', type: 'string', isNullable: true }),
    );
    await q.query('UPDATE demo_accounts SET name = display_name');
    await q.changeColumn(
      'demo_accounts',
      'name',
      new TableColumn({ name: 'name', type: 'string' }),
    );
    await q.dropColumn('demo_accounts', 'display_name');
  }
}
