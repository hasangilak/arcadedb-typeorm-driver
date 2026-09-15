import { EntitySchema, type EntityManager } from 'typeorm';

const Account = new EntitySchema({
  name: 'SeedAccount',
  tableName: 'demo_accounts',
  columns: {
    id: { type: String, primary: true },
    display_name: { type: String },
    email: { type: String },
    country: { type: String, nullable: true },
    active: { type: Boolean },
  },
});

export const accountSchema = Account;
export async function seedAccounts(manager: EntityManager): Promise<void> {
  await manager.getRepository(Account).save([
    {
      id: 'ada',
      display_name: 'Ada Lovelace',
      email: 'ada@example.test',
      country: 'DE',
      active: true,
    },
    {
      id: 'grace',
      display_name: 'Grace Hopper',
      email: 'grace@example.test',
      country: 'US',
      active: true,
    },
    {
      id: 'linus',
      display_name: 'Linus Torvalds',
      email: 'linus@example.test',
      country: 'FI',
      active: false,
    },
  ]);
}
