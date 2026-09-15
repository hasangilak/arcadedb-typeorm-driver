import { EntitySchema, type EntityManager } from 'typeorm';

export const catalogSchema = new EntitySchema({
  name: 'SeedProduct',
  tableName: 'demo_catalog',
  columns: {
    id: { type: String, primary: true },
    name: { type: String },
    price_cents: { type: 'long' },
    attributes: { type: 'json' },
    tags: { type: 'array' },
  },
});

export async function seedCatalog(manager: EntityManager): Promise<void> {
  await manager.getRepository(catalogSchema).save([
    {
      id: 'book',
      name: 'Database Handbook',
      price_cents: 2500,
      attributes: { format: 'paper', pages: 320 },
      tags: ['database', 'learning'],
    },
    {
      id: 'course',
      name: 'Graph Course',
      price_cents: 12000,
      attributes: { format: 'video', hours: 8 },
      tags: ['graph'],
    },
    {
      id: 'support',
      name: 'Support Session',
      price_cents: 8000,
      attributes: { minutes: 60 },
      tags: [],
    },
  ]);
}
