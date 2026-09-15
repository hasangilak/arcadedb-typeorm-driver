import type { ArcadeDataSource } from '../../src';
import { accountSchema, seedAccounts } from './02-accounts';
import { catalogSchema, seedCatalog } from './03-catalog';
import { itemSchema, orderSchema, totalSchema, seedOrders } from './04-orders';
import { seedGraph } from './05-graph';

export const seedEntities = [accountSchema, catalogSchema, orderSchema, itemSchema, totalSchema];
export async function seedDemo(db: ArcadeDataSource): Promise<void> {
  await db.transaction(async (manager) => {
    await seedAccounts(manager);
    await seedCatalog(manager);
    await seedOrders(manager);
    await seedGraph(manager);
  });
}
