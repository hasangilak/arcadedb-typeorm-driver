import { randomUUID } from 'node:crypto';
import { EntitySchema, type Repository } from 'typeorm';
import { ArcadeDataSource } from '../src';

interface Note {
  id: string;
  title: string;
  score: number;
  version: number;
  deletedAt: Date | null;
}

/** Write examples own their temporary type; seeded application records are never deleted. */
export async function scratch<T>(
  db: ArcadeDataSource,
  run: (repo: Repository<Note>, source: ArcadeDataSource) => Promise<T>,
): Promise<T> {
  const tableName = 'query_scratch_' + randomUUID().replaceAll('-', '');
  const schema = new EntitySchema<Note>({
    name: tableName,
    tableName,
    columns: {
      id: { type: 'uuid', primary: true, generated: 'uuid' },
      title: { type: String },
      score: { type: Number, default: 0 },
      version: { type: Number, version: true },
      deletedAt: { type: Date, deleteDate: true, nullable: true },
    },
  });
  const source = new ArcadeDataSource({
    ...db.driver.arcadeOptions,
    entities: [schema],
    migrations: [],
    migrationsRun: false,
    synchronize: true,
  });
  try {
    await source.initialize();
    return await run(source.getRepository(schema), source);
  } finally {
    const runner = db.createQueryRunner();
    try {
      if (source.isInitialized) await source.destroy();
      await runner.dropTable(tableName, true);
    } finally {
      await runner.release();
    }
  }
}
