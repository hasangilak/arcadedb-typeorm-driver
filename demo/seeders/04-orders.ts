import { EntitySchema, type EntityManager } from 'typeorm';

export const orderSchema = new EntitySchema({
  name: 'SeedOrder',
  tableName: 'demo_orders',
  columns: {
    id: { type: String, primary: true },
    account_id: { type: String },
    status: { type: String },
    created_at: { type: Date },
  },
});
export const itemSchema = new EntitySchema({
  name: 'SeedItem',
  tableName: 'demo_order_items',
  columns: {
    line_id: { type: String, primary: true },
    order_id: { type: String },
    product_id: { type: String },
    quantity: { type: Number },
    unit_price: { type: Number },
  },
});
export const totalSchema = new EntitySchema({
  name: 'SeedTotal',
  tableName: 'demo_order_totals',
  columns: {
    order_id: { type: String, primary: true },
    total_cents: { type: 'long' },
  },
});

export async function seedOrders(manager: EntityManager): Promise<void> {
  const orders = [
    { id: 'legacy-order', account_id: 'ada', status: 'paid' },
    { id: 'grace-order', account_id: 'grace', status: 'pending' },
  ];
  for (const order of orders) {
    await manager
      .getRepository(orderSchema)
      .save({ ...order, created_at: new Date('2026-09-15T10:00:00Z') });
  }
  await manager.getRepository(itemSchema).save([
    {
      line_id: 'legacy-order:book',
      order_id: 'legacy-order',
      product_id: 'book',
      quantity: 2,
      unit_price: 2500,
    },
    {
      line_id: 'grace-order:course',
      order_id: 'grace-order',
      product_id: 'course',
      quantity: 1,
      unit_price: 12000,
    },
  ]);
  const totals = await manager.query(
    'SELECT order_id, sum(quantity * unit_price) AS total_cents FROM demo_order_items GROUP BY order_id',
  );
  await manager.getRepository(totalSchema).save(totals);
}
