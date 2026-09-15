import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';
import type { BaseDataSourceOptions } from 'typeorm/data-source/BaseDataSourceOptions';
import { ArcadeDriver } from './ArcadeDriver';

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
    if (!/^[A-Za-z0-9_-]+$/.test(options.database)) throw new Error('Invalid ArcadeDB database name');
    if (!options.username || !options.password || options.username.includes(':')) throw new Error('ArcadeDB username and password are required');
    const url = new URL(options.url ?? 'http://127.0.0.1:2480');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('ArcadeDB URL must use HTTP(S), without credentials, query or fragment');
    }
    if (options.requestTimeout !== undefined && (!Number.isSafeInteger(options.requestTimeout) || options.requestTimeout <= 0)) {
      throw new Error('requestTimeout must be a positive integer');
    }
    if (options.cache || options.migrationsRun || options.migrations?.length) {
      throw new Error('ArcadeDB does not support TypeORM query caching or migration execution; use explicit SQL');
    }
    // TypeORM has no external driver registry. Bootstrap its synchronous constructor
    // without loading pg, then replace the driver before any connection is opened.
    super({ ...options, type: 'postgres', url: undefined, driver: {} });
    Object.assign(this, { options: { ...options, type: 'arcadedb' } as unknown as DataSourceOptions });
    this.driver = new ArcadeDriver(this, options);
  }
}
