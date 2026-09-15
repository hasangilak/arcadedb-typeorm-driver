import type { EntityManager } from 'typeorm';

export async function seedGraph(manager: EntityManager): Promise<void> {
  const orders = await manager.query('SELECT FROM demo_orders');
  for (const order of orders) {
    let [customer] = await manager.query(
      'SELECT FROM demo_customer_vertex WHERE account_id = :p0',
      [order.account_id],
    );
    if (!customer)
      [customer] = await manager.query('CREATE VERTEX demo_customer_vertex SET account_id = :p0', [
        order.account_id,
      ]);
    let [vertex] = await manager.query('SELECT FROM demo_order_vertex WHERE order_id = :p0', [
      order.id,
    ]);
    if (!vertex)
      [vertex] = await manager.query('CREATE VERTEX demo_order_vertex SET order_id = :p0', [
        order.id,
      ]);
    if (!(await manager.query('SELECT FROM demo_placed WHERE order_id = :p0', [order.id])).length) {
      await manager.query('CREATE EDGE demo_placed FROM :p0 TO :p1 SET order_id = :p2', [
        customer['@rid'],
        vertex['@rid'],
        order.id,
      ]);
    }
  }
}
