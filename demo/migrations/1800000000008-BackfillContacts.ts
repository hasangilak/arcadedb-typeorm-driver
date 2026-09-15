import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class BackfillContacts1800000000008 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      "UPDATE demo_accounts SET email = id + '@example.test', country = 'DE' WHERE email IS NULL",
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('UPDATE demo_accounts SET email = null, country = null');
  }
}
