import { TableColumn, type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddAuditDefaults1800000000007 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.addColumn(
      'demo_accounts',
      new TableColumn({ name: 'active', type: 'boolean', default: 'true' }),
    );
    await q.addColumn(
      'demo_orders',
      new TableColumn({ name: 'created_at', type: 'datetime', default: 'sysdate()' }),
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropColumn('demo_orders', 'created_at');
    await q.dropColumn('demo_accounts', 'active');
  }
}
