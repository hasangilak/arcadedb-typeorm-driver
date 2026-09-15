import type { DataSource } from 'typeorm';

/** Run after migration 4, before any backfills. Stable keys make it repeatable. */
export async function seedLegacy(db: DataSource): Promise<void> {
  await db.transaction(async (manager) => {
    for (const [id, name] of [
      ['ada', 'Ada Lovelace'],
      ['grace', 'Grace Hopper'],
    ]) {
      if (!(await manager.query('SELECT FROM demo_accounts WHERE id = :p0', [id])).length)
        await manager.query('INSERT INTO demo_accounts SET id = :p0, name = :p1', [id, name]);
    }
    for (const [id, name, price] of [
      ['book', 'Database Handbook', 2500],
      ['course', 'Graph Course', 12000],
    ]) {
      if (!(await manager.query('SELECT FROM demo_products WHERE id = :p0', [id])).length)
        await manager.query('INSERT INTO demo_products SET id = :p0, name = :p1, price = :p2', [
          id,
          name,
          price,
        ]);
    }
    if (!(await manager.query("SELECT FROM demo_orders WHERE id = 'legacy-order'")).length) {
      await manager.query(
        "INSERT INTO demo_orders SET id = 'legacy-order', account_id = 'ada', status = 'paid'",
      );
      await manager.query(
        "INSERT INTO demo_order_items SET order_id = 'legacy-order', product_id = 'book', quantity = 2, unit_price = 2500",
      );
    }
  });
}
