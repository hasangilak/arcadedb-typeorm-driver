import type { ObjectLiteral, TableColumn, EntityMetadata } from 'typeorm';
import type { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import type { Driver } from 'typeorm/driver/Driver';
import type { ColumnType } from 'typeorm/driver/types/ColumnTypes';
import type { MappedColumnTypes } from 'typeorm/driver/types/MappedColumnTypes';
import type { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';
import { ApplyValueTransformers } from 'typeorm/util/ApplyValueTransformers';
import { OrmUtils } from 'typeorm/util/OrmUtils';
import type { ArcadeDataSource, ArcadeDataSourceOptions } from './ArcadeDataSource';
import { ArcadeQueryRunner } from './ArcadeQueryRunner';
import { ArcadeSchemaBuilder } from './ArcadeSchemaBuilder';
import { bindParameters, escapeIdentifier, translateOrmSql } from './sql';

export class ArcadeHttpError extends Error {
  constructor(message: string, readonly status: number, readonly exception?: string) {
    super(message);
    this.name = 'ArcadeHttpError';
  }
}

export class ArcadeDriver implements Driver {
  readonly options;
  readonly database: string;
  readonly isReplicated = false;
  readonly treeSupport = false;
  readonly transactionSupport = 'simple';
  readonly supportedIsolationLevels: readonly IsolationLevel[] = ['READ COMMITTED', 'REPEATABLE READ'];
  readonly supportedUpsertTypes = [];
  readonly dataTypeDefaults = {};
  readonly spatialTypes = [];
  readonly withLengthColumnTypes = [];
  readonly withPrecisionColumnTypes = [];
  readonly withScaleColumnTypes = [];
  readonly cteCapabilities = { enabled: false };
  readonly supportedDataTypes: ColumnType[] = ['string', 'integer', 'float', 'double', 'boolean', 'date', 'datetime', 'json', 'array'];
  readonly mappedDataTypes: MappedColumnTypes = {
    createDate: 'datetime', createDateDefault: 'sysdate()',
    updateDate: 'datetime', updateDateDefault: 'sysdate()',
    deleteDate: 'datetime', deleteDateNullable: true,
    version: 'integer', treeLevel: 'integer', migrationId: 'integer',
    migrationTimestamp: 'integer', migrationName: 'string', cacheId: 'integer',
    cacheIdentifier: 'string', cacheTime: 'integer', cacheDuration: 'integer',
    cacheQuery: 'string', cacheResult: 'string', metadataType: 'string',
    metadataDatabase: 'string', metadataSchema: 'string', metadataTable: 'string',
    metadataName: 'string', metadataValue: 'string',
  };
  readonly runners = new Set<ArcadeQueryRunner>();
  connected = false;

  constructor(readonly dataSource: ArcadeDataSource, readonly arcadeOptions: ArcadeDataSourceOptions) {
    this.options = dataSource.options;
    this.database = arcadeOptions.database;
  }

  async request(path: string, body?: unknown, session?: string): Promise<{ body: any; headers: Headers }> {
    const response = await fetch(`${(this.arcadeOptions.url ?? 'http://127.0.0.1:2480').replace(/\/$/, '')}/api/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.arcadeOptions.username}:${this.arcadeOptions.password}`).toString('base64')}`,
        'Content-Type': 'application/json',
        ...(session ? { 'arcadedb-session-id': session } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.arcadeOptions.requestTimeout ?? 30_000),
      redirect: 'error',
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { throw new ArcadeHttpError(`ArcadeDB returned a non-JSON response (HTTP ${response.status})`, response.status); }
    if (!response.ok) throw new ArcadeHttpError(data.detail ?? data.error ?? `ArcadeDB HTTP ${response.status}`, response.status, data.exception);
    return { body: data, headers: response.headers };
  }

  async connect(): Promise<void> {
    const { body } = await this.request(`exists/${encodeURIComponent(this.database)}`);
    if (!body.result) {
      if (!this.arcadeOptions.createDatabase) throw new Error(`ArcadeDB database ${this.database} does not exist`);
      await this.request('server', { command: `create database ${this.database}` });
    }
    this.connected = true;
  }

  async afterConnect(): Promise<void> {
    for (const metadata of this.dataSource.entityMetadatas) {
      if (metadata.relations.length || metadata.treeType || metadata.tableType !== 'regular') {
        throw new Error(`ArcadeDB supports document entities without ORM relations: ${metadata.name}`);
      }
      for (const column of metadata.columns) {
        if (column.isGenerated && column.generationStrategy !== 'uuid') {
          throw new Error('ArcadeDB supports generated UUIDs or manually assigned primary keys, not auto-increment');
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    await Promise.all([...this.runners].map(runner => runner.release()));
    this.connected = false;
  }

  createQueryRunner(): ArcadeQueryRunner {
    const runner = new ArcadeQueryRunner(this);
    this.runners.add(runner);
    return runner;
  }

  createSchemaBuilder(): ArcadeSchemaBuilder { return new ArcadeSchemaBuilder(this); }
  escapeQueryWithParameters(sql: string, parameters: ObjectLiteral): [string, any[]] {
    return bindParameters(translateOrmSql(sql), parameters);
  }
  escape = escapeIdentifier;
  createParameter(_name: string, index: number): string { return `:p${index}`; }
  buildTableName(name: string, schema?: string, database?: string): string {
    if (schema || (database && database !== this.database)) throw new Error('ArcadeDB does not support cross-database tables or SQL schemas');
    return name;
  }
  parseTableName(target: Parameters<Driver['parseTableName']>[0]): ReturnType<Driver['parseTableName']> {
    const tableName = typeof target === 'string' ? target : 'tableName' in target ? target.tableName : target.name;
    if (!tableName) throw new Error('ArcadeDB table name is required');
    return { tableName, database: this.database };
  }

  normalizeType(column: Parameters<Driver['normalizeType']>[0]): string {
    if (column.isArray) return 'array';
    const type = column.type;
    if (type === String || ['text', 'varchar', 'uuid', 'simple-array', 'simple-json'].includes(type as string)) return 'string';
    if (type === Number || ['int', 'smallint'].includes(type as string)) return 'integer';
    if (type === Boolean || type === 'bool') return 'boolean';
    if (type === Date || type === 'timestamp') return 'datetime';
    return String(type).toLowerCase();
  }

  preparePersistentValue(value: any, column: ColumnMetadata): any {
    if (column.transformer) value = ApplyValueTransformers.transformTo(column.transformer, value);
    if (value == null) return value;
    if (column.type === 'simple-json') return JSON.stringify(value);
    if (column.type === 'simple-array') return value.join(',');
    if (value instanceof Date) return column.type === 'date' ? value.toISOString().slice(0, 10) : value.toISOString();
    return value;
  }

  prepareHydratedValue(value: any, column: ColumnMetadata): any {
    if (value != null) {
      if (column.type === 'simple-json' && typeof value === 'string') value = JSON.parse(value);
      else if (column.type === 'simple-array' && typeof value === 'string') value = value ? value.split(',') : [];
      else if (this.normalizeType(column) === 'datetime') value = new Date(value);
    }
    return column.transformer ? ApplyValueTransformers.transformFrom(column.transformer, value) : value;
  }

  normalizeDefault(column: ColumnMetadata): string | undefined {
    if (column.default === undefined) return undefined;
    return typeof column.default === 'function' ? column.default() : JSON.stringify(column.default);
  }
  normalizeIsUnique(column: ColumnMetadata): boolean {
    return column.entityMetadata.uniques.some(unique => unique.columns.length === 1 && unique.columns[0] === column);
  }
  getColumnLength(): string { return ''; }
  createFullType(column: TableColumn): string { return this.normalizeType(column); }
  async obtainMasterConnection(): Promise<ArcadeDriver> { return this; }
  async obtainSlaveConnection(): Promise<ArcadeDriver> { return this; }
  isReturningSqlSupported(): boolean { return false; }
  isUUIDGenerationSupported(): boolean { return false; }
  isFullTextColumnTypeSupported(): boolean { return false; }
  createGeneratedMap(metadata: EntityMetadata, row: ObjectLiteral | undefined): ObjectLiteral | undefined {
    if (!row) return undefined;
    return metadata.columns.reduce((map, column) => {
      if (Object.hasOwn(row, column.databaseName)) {
        OrmUtils.mergeDeep(map, column.createValueMap(this.prepareHydratedValue(row[column.databaseName], column)));
      }
      return map;
    }, {});
  }
  findChangedColumns(columns: TableColumn[], metadata: ColumnMetadata[]): ColumnMetadata[] {
    return metadata.filter(column => columns.some(existing => existing.name === column.databaseName && existing.type !== this.normalizeType(column)));
  }
}
