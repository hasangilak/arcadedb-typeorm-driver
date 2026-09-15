import { MigrationExecutor, Table, type Migration, type QueryRunner } from 'typeorm';

/** Reuses TypeORM's migration ordering, transactions, fake runs and rollback. */
export class ArcadeMigrationExecutor extends MigrationExecutor {
  private get ledger(): string {
    return this.dataSource.options.migrationsTableName ?? 'migrations';
  }

  protected async createMigrationsTableIfNotExist(q: QueryRunner): Promise<void> {
    if (await q.hasTable(this.ledger)) return;
    await q.createTable(
      new Table({
        name: this.ledger,
        columns: [
          { name: 'id', type: 'long', isPrimary: true },
          { name: 'timestamp', type: 'long' },
          { name: 'name', type: 'string', isUnique: true },
        ],
      }),
    );
  }

  protected async insertExecutedMigration(q: QueryRunner, migration: Migration): Promise<void> {
    // ponytail: one migration process at a time; use a deployment lock for multiple deployers.
    const [row] = await q.query(
      `SELECT max(id) AS id FROM ${this.dataSource.driver.escape(this.ledger)}`,
    );
    await q.manager
      .createQueryBuilder()
      .insert()
      .into(this.ledger)
      .values({
        id: Number(row?.id ?? 0) + 1,
        timestamp: migration.timestamp,
        name: migration.name,
      })
      .execute();
  }
}
