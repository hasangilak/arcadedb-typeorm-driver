import { ArcadeDataSource } from '../src';
import { migrations } from './migrations';

export function demoDataSource(
  selected = migrations,
  automatic = false,
  database = process.env.ARCADEDB_DATABASE ?? 'driver_demo',
): ArcadeDataSource {
  return new ArcadeDataSource({
    url: process.env.ARCADEDB_URL ?? 'http://127.0.0.1:2480',
    database,
    username: process.env.ARCADEDB_USERNAME ?? 'root',
    password: process.env.ARCADEDB_PASSWORD ?? 'integration-password',
    createDatabase: true,
    migrations: selected,
    migrationsRun: automatic,
    migrationsTableName: 'demo_migrations',
    migrationsTransactionMode: 'none',
    synchronize: false,
  });
}

// TypeORM CLI accepts this compiled DataSource export.
export default demoDataSource();
