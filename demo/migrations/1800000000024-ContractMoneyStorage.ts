import { TableColumn, type MigrationInterface, type QueryRunner } from 'typeorm';

export class ContractMoneyStorage1800000000024 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    const [invalid] = await q.query(
      'SELECT count(*) AS n FROM demo_catalog WHERE price_cents IS NULL OR price_cents <> price',
    );
    if (invalid.n) throw new Error('Money backfill validation failed; old column retained');
    await q.dropColumn('demo_catalog', 'price');
  }
  async down(q: QueryRunner): Promise<void> {
    const [invalid] = await q.query(
      'SELECT count(*) AS n FROM demo_catalog WHERE price_cents > 2147483647 OR price_cents < -2147483648',
    );
    if (invalid.n) throw new Error('Cannot restore integer prices without overflow');
    await q.addColumn(
      'demo_catalog',
      new TableColumn({ name: 'price', type: 'integer', isNullable: true }),
    );
    await q.query('UPDATE demo_catalog SET price = price_cents');
    await q.changeColumn(
      'demo_catalog',
      'price',
      new TableColumn({ name: 'price', type: 'integer' }),
    );
  }
}
