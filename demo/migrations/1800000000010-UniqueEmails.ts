import { TableUnique, type MigrationInterface, type QueryRunner } from 'typeorm';

export class UniqueEmails1800000000010 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createUniqueConstraint(
      'demo_accounts',
      new TableUnique({ name: 'uq_demo_email', columnNames: ['email'] }),
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropUniqueConstraint('demo_accounts', 'uq_demo_email');
  }
}
