import { demoDataSource } from './data-source';
import { seedDemo, seedEntities } from './seeders';
import { seedLegacy } from './seeders/01-legacy';
import { migrations } from './migrations';
import { queries } from './queries';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  if (!['up', 'down', 'status', 'seed', 'legacy', 'queries'].includes(command))
    throw new Error('Use up, down, status, seed, legacy or queries');
  const selectedQuery = process.argv[3];
  if (command === 'queries' && selectedQuery && !Object.hasOwn(queries, selectedQuery))
    throw new Error(`Unknown query. Choose: ${Object.keys(queries).join(', ')}`);
  const db = demoDataSource(command === 'legacy' ? migrations.slice(0, 4) : migrations);
  if (command === 'seed' || command === 'queries') db.setOptions({ entities: seedEntities });
  await db.initialize();
  try {
    if (command === 'up' || command === 'legacy') {
      console.log((await db.runMigrations()).map((migration) => migration.name));
      if (command === 'legacy') await seedLegacy(db);
    } else if (command === 'down') await db.undoLastMigration();
    else if (command === 'status') console.log({ pending: await db.showMigrations() });
    else if (command === 'queries') {
      for (const [name, run] of Object.entries(queries)) {
        if (!selectedQuery || selectedQuery === name)
          console.log(JSON.stringify({ query: name, result: await run(db) }, null, 2));
      }
    } else {
      await seedDemo(db);
      console.log('Seeded accounts, catalog, orders, totals and graph.');
    }
  } finally {
    await db.destroy();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
