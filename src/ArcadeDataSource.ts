import 'reflect-metadata';
import {
  CannotExecuteNotConnectedError,
  DataSource,
  type DataSourceOptions,
  type EntityTarget,
  type ObjectLiteral,
  type QueryRunner,
  type SelectQueryBuilder,
} from 'typeorm';
import type { BaseDataSourceOptions } from 'typeorm/data-source/BaseDataSourceOptions';
import { ArcadeDriver } from './ArcadeDriver';
import { ArcadeMigrationExecutor } from './ArcadeMigrationExecutor';
import { ArcadeSelectQueryBuilder } from './ArcadeSelectQueryBuilder';

export interface ArcadeDataSourceOptions extends Omit<BaseDataSourceOptions, 'type'> {
  type?: 'arcadedb';
  url?: string;
  database: string;
  username: string;
  password: string;
  requestTimeout?: number;
  /** Requires server administrator permissions. Defaults to false. */
  createDatabase?: boolean;
}

export class ArcadeDataSource extends DataSource {
  declare driver: ArcadeDriver;

  constructor(options: ArcadeDataSourceOptions) {
    if (typeof options.database !== 'string' || !/^[A-Za-z0-9_-]+$/.test(options.database))
      throw new Error('Invalid ArcadeDB database name');
    if (
      typeof options.username !== 'string' ||
      typeof options.password !== 'string' ||
      !options.username ||
      !options.password ||
      options.username.includes(':')
    )
      throw new Error('ArcadeDB username and password are required');
    const url = new URL(options.url ?? 'http://127.0.0.1:2480');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error('ArcadeDB URL must use HTTP(S), without credentials, query or fragment');
    }
    if (
      options.requestTimeout !== undefined &&
      (!Number.isSafeInteger(options.requestTimeout) || options.requestTimeout <= 0)
    ) {
      throw new Error('requestTimeout must be a positive integer');
    }
    if (options.cache) throw new Error('ArcadeDB does not support TypeORM query caching');
    // TypeORM has no external driver registry. Bootstrap its synchronous constructor
    // without loading pg, then replace the driver before any connection is opened.
    super({ ...options, type: 'postgres', url: undefined, driver: {} });
    Object.assign(this, {
      options: { ...options, type: 'arcadedb' } as unknown as DataSourceOptions,
    });
    this.driver = new ArcadeDriver(this, options);
  }

  override createQueryBuilder<Entity extends ObjectLiteral>(
    entity: EntityTarget<Entity>,
    alias: string,
    queryRunner?: QueryRunner,
  ): SelectQueryBuilder<Entity>;
  override createQueryBuilder(queryRunner?: QueryRunner): SelectQueryBuilder<any>;
  override createQueryBuilder(
    entityOrRunner?: EntityTarget<any> | QueryRunner,
    alias?: string,
    queryRunner?: QueryRunner,
  ): SelectQueryBuilder<any> {
    if (alias) {
      const metadata = this.getMetadata(entityOrRunner as EntityTarget<any>);
      return new ArcadeSelectQueryBuilder(this, queryRunner)
        .select(alias)
        .from(metadata.target, alias);
    }
    return new ArcadeSelectQueryBuilder(this, entityOrRunner as QueryRunner | undefined);
  }

  private migrationExecutor(options?: {
    transaction?: 'all' | 'none' | 'each';
    fake?: boolean;
  }): ArcadeMigrationExecutor {
    if (!this.isInitialized) throw new CannotExecuteNotConnectedError();
    const executor = new ArcadeMigrationExecutor(this);
    executor.transaction = options?.transaction ?? this.options.migrationsTransactionMode ?? 'none';
    executor.fake = options?.fake ?? false;
    return executor;
  }
  override runMigrations(options?: Parameters<DataSource['runMigrations']>[0]) {
    return this.migrationExecutor(options).executePendingMigrations();
  }
  override undoLastMigration(options?: Parameters<DataSource['undoLastMigration']>[0]) {
    return this.migrationExecutor(options).undoLastMigration();
  }
  override showMigrations() {
    return this.migrationExecutor().showMigrations();
  }
}
