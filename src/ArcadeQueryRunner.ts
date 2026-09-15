import { QueryFailedError, QueryRunnerAlreadyReleasedError, TransactionNotStartedError, type QueryRunner, Table, TableColumn } from 'typeorm';
import { BaseQueryRunner } from 'typeorm/query-runner/BaseQueryRunner';
import { QueryResult } from 'typeorm/query-runner/QueryResult';
import { Broadcaster } from 'typeorm/subscriber/Broadcaster';
import type { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';
import type { ArcadeDriver } from './ArcadeDriver';

async function unsupported(..._args: unknown[]): Promise<never> {
  throw new Error('This schema/streaming operation is not supported by ArcadeDB; use query() with native SQL');
}

export class ArcadeQueryRunner extends BaseQueryRunner implements QueryRunner {
  private session?: string;

  constructor(readonly driver: ArcadeDriver) {
    super();
    this.dataSource = driver.dataSource;
    this.mode = 'master';
    this.broadcaster = new Broadcaster(this);
    this.manager = this.dataSource.createEntityManager(this);
  }

  private assertConnected(): void {
    if (this.isReleased) throw new QueryRunnerAlreadyReleasedError();
    if (!this.driver.connected) throw new Error('ArcadeDB driver is not connected');
  }

  async connect(): Promise<ArcadeDriver> { this.assertConnected(); return this.driver; }

  async release(): Promise<void> {
    if (this.isReleased) return;
    try {
      if (this.isTransactionActive) await this.rollbackTransaction();
    } finally {
      this.isReleased = true;
      this.driver.runners.delete(this);
    }
  }

  async startTransaction(isolationLevel?: IsolationLevel): Promise<void> {
    this.assertConnected();
    if (this.isTransactionActive) throw new Error('ArcadeDB does not support nested transactions');
    const level = isolationLevel ?? this.dataSource.options.isolationLevel ?? 'READ COMMITTED';
    if (!this.driver.supportedIsolationLevels.includes(level)) throw new Error(`Unsupported ArcadeDB isolation level: ${level}`);
    await this.broadcaster.broadcast('BeforeTransactionStart');
    const { headers } = await this.driver.request(`begin/${this.driver.database}`, { isolationLevel: level.replaceAll(' ', '_') });
    const session = headers.get('arcadedb-session-id');
    if (!session) throw new Error('ArcadeDB did not return a transaction session');
    this.session = session;
    this.isTransactionActive = true;
    this.transactionDepth = 1;
    await this.broadcaster.broadcast('AfterTransactionStart');
  }

  async commitTransaction(): Promise<void> {
    this.assertConnected();
    if (!this.isTransactionActive) throw new TransactionNotStartedError();
    await this.broadcaster.broadcast('BeforeTransactionCommit');
    await this.driver.request(`commit/${this.driver.database}`, {}, this.session);
    this.session = undefined;
    this.isTransactionActive = false;
    this.transactionDepth = 0;
    await this.broadcaster.broadcast('AfterTransactionCommit');
  }

  async rollbackTransaction(): Promise<void> {
    this.assertConnected();
    if (!this.isTransactionActive) throw new TransactionNotStartedError();
    await this.broadcaster.broadcast('BeforeTransactionRollback');
    await this.driver.request(`rollback/${this.driver.database}`, {}, this.session);
    this.session = undefined;
    this.isTransactionActive = false;
    this.transactionDepth = 0;
    await this.broadcaster.broadcast('AfterTransactionRollback');
  }

  async query(query: string, parameters?: any[] | Record<string, any>, useStructuredResult = false): Promise<any> {
    this.assertConnected();
    if (this.sqlMemoryMode) throw new Error('Use schema builder log() to preview ArcadeDB schema SQL');
    this.dataSource.logger.logQuery(query, Array.isArray(parameters) ? parameters : undefined, this);
    const started = Date.now();
    try {
      const params = Array.isArray(parameters) ? Object.fromEntries(parameters.map((value, i) => [`p${i}`, value])) : parameters;
      const { body } = await this.driver.request(`command/${this.driver.database}`, {
        language: 'sql', command: query, params: params ?? {}, serializer: 'record', limit: -1,
      }, this.session);
      if (!Array.isArray(body.result)) throw new Error('ArcadeDB returned an invalid query result');
      const result = new QueryResult();
      result.records = body.result;
      result.raw = body.result;
      if (/^\s*(UPDATE|DELETE)\b/i.test(query)) result.affected = Number(body.result[0]?.count ?? 0);
      else if (/^\s*INSERT\b/i.test(query)) result.affected = body.result.length;
      const elapsed = Date.now() - started;
      if (this.dataSource.options.maxQueryExecutionTime && elapsed > this.dataSource.options.maxQueryExecutionTime) {
        this.dataSource.logger.logQuerySlow(elapsed, query, Array.isArray(parameters) ? parameters : undefined, this);
      }
      return useStructuredResult ? result : result.raw;
    } catch (error) {
      this.dataSource.logger.logQueryError(error as Error, query, Array.isArray(parameters) ? parameters : undefined, this);
      throw new QueryFailedError(query, parameters, error as Error);
    }
  }

  async clearTable(name: string): Promise<void> { await this.query(`DELETE FROM ${this.driver.escape(name)}`); }
  async getCurrentDatabase(): Promise<string> { return this.driver.database; }
  async getCurrentSchema(): Promise<undefined> { return undefined; }
  async getSchemas(): Promise<string[]> { return []; }
  async hasSchema(): Promise<boolean> { return false; }
  async getDatabases(): Promise<string[]> { return (await this.driver.request('databases')).body.result; }
  async hasDatabase(database: string): Promise<boolean> { return (await this.driver.request(`exists/${encodeURIComponent(database)}`)).body.result; }
  async hasTable(table: Table | string): Promise<boolean> { return !!(await this.getTable(typeof table === 'string' ? table : table.name)); }
  async hasColumn(table: Table | string, column: string): Promise<boolean> {
    return !!(await this.getTable(typeof table === 'string' ? table : table.name))?.findColumnByName(column);
  }
  protected async loadTables(names?: string[]): Promise<Table[]> {
    const types = await this.query('SELECT FROM schema:types');
    return types.filter((type: any) => !names || names.includes(type.name)).map((type: any) => new Table({
      name: type.name,
      columns: (type.properties ?? []).map((property: any) => new TableColumn({
        name: property.name, type: property.type.toLowerCase(), isNullable: !property.notNull,
      })),
    }));
  }
  protected async loadViews(): Promise<never[]> { return []; }

  clearDatabase: QueryRunner['clearDatabase'] = unsupported;
  stream: QueryRunner['stream'] = unsupported;
  createDatabase: QueryRunner['createDatabase'] = unsupported;
  dropDatabase: QueryRunner['dropDatabase'] = unsupported;
  createSchema: QueryRunner['createSchema'] = unsupported;
  dropSchema: QueryRunner['dropSchema'] = unsupported;
  createTable: QueryRunner['createTable'] = unsupported;
  dropTable: QueryRunner['dropTable'] = unsupported;
  createView: QueryRunner['createView'] = unsupported;
  dropView: QueryRunner['dropView'] = unsupported;
  renameTable: QueryRunner['renameTable'] = unsupported;
  changeTableComment: QueryRunner['changeTableComment'] = unsupported;
  addColumn: QueryRunner['addColumn'] = unsupported;
  addColumns: QueryRunner['addColumns'] = unsupported;
  renameColumn: QueryRunner['renameColumn'] = unsupported;
  changeColumn: QueryRunner['changeColumn'] = unsupported;
  changeColumns: QueryRunner['changeColumns'] = unsupported;
  dropColumn: QueryRunner['dropColumn'] = unsupported;
  dropColumns: QueryRunner['dropColumns'] = unsupported;
  createPrimaryKey: QueryRunner['createPrimaryKey'] = unsupported;
  updatePrimaryKeys: QueryRunner['updatePrimaryKeys'] = unsupported;
  dropPrimaryKey: QueryRunner['dropPrimaryKey'] = unsupported;
  createUniqueConstraint: QueryRunner['createUniqueConstraint'] = unsupported;
  createUniqueConstraints: QueryRunner['createUniqueConstraints'] = unsupported;
  dropUniqueConstraint: QueryRunner['dropUniqueConstraint'] = unsupported;
  dropUniqueConstraints: QueryRunner['dropUniqueConstraints'] = unsupported;
  createCheckConstraint: QueryRunner['createCheckConstraint'] = unsupported;
  createCheckConstraints: QueryRunner['createCheckConstraints'] = unsupported;
  dropCheckConstraint: QueryRunner['dropCheckConstraint'] = unsupported;
  dropCheckConstraints: QueryRunner['dropCheckConstraints'] = unsupported;
  createExclusionConstraint: QueryRunner['createExclusionConstraint'] = unsupported;
  createExclusionConstraints: QueryRunner['createExclusionConstraints'] = unsupported;
  dropExclusionConstraint: QueryRunner['dropExclusionConstraint'] = unsupported;
  dropExclusionConstraints: QueryRunner['dropExclusionConstraints'] = unsupported;
  createForeignKey: QueryRunner['createForeignKey'] = unsupported;
  createForeignKeys: QueryRunner['createForeignKeys'] = unsupported;
  dropForeignKey: QueryRunner['dropForeignKey'] = unsupported;
  dropForeignKeys: QueryRunner['dropForeignKeys'] = unsupported;
  createIndex: QueryRunner['createIndex'] = unsupported;
  createIndices: QueryRunner['createIndices'] = unsupported;
  dropIndex: QueryRunner['dropIndex'] = unsupported;
  dropIndices: QueryRunner['dropIndices'] = unsupported;
}
