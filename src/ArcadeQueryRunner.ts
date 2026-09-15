import {
  QueryFailedError,
  QueryRunnerAlreadyReleasedError,
  TransactionNotStartedError,
  type QueryRunner,
  Table,
  TableColumn,
  TableIndex,
  TableUnique,
} from 'typeorm';
import { BaseQueryRunner } from 'typeorm/query-runner/BaseQueryRunner';
import { QueryResult } from 'typeorm/query-runner/QueryResult';
import { BroadcasterResult } from 'typeorm/subscriber/BroadcasterResult';
import { Broadcaster } from 'typeorm/subscriber/Broadcaster';
import type { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';
import { updateReturnsRecords } from './sql';
import type { ArcadeDriver } from './ArcadeDriver';

async function unsupported(..._args: unknown[]): Promise<never> {
  throw new Error(
    'This schema/streaming operation is not supported by ArcadeDB; use query() with native SQL',
  );
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

  async connect(): Promise<ArcadeDriver> {
    this.assertConnected();
    return this.driver;
  }

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
    if (!this.driver.supportedIsolationLevels.includes(level))
      throw new Error(`Unsupported ArcadeDB isolation level: ${level}`);
    await this.broadcaster.broadcast('BeforeTransactionStart');
    const { headers } = await this.driver.request(`begin/${this.driver.database}`, {
      isolationLevel: level.replaceAll(' ', '_'),
    });
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

  async query(
    query: string,
    parameters?: any[] | Record<string, any>,
    useStructuredResult = false,
  ): Promise<any> {
    this.assertConnected();
    const statement = query.replace(/^\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*/, '');
    if (
      this.isTransactionActive &&
      /^(CREATE|ALTER|DROP|REBUILD)\b/i.test(statement) &&
      !/^CREATE\s+(VERTEX|EDGE)\s+(?!TYPE\b)/i.test(statement)
    ) {
      throw new Error(
        'ArcadeDB schema DDL is not transactional; run schema migrations with transaction: none',
      );
    }
    if (this.sqlMemoryMode)
      throw new Error('Use schema builder log() to preview ArcadeDB schema SQL');
    this.dataSource.logger.logQuery(
      query,
      Array.isArray(parameters) ? parameters : undefined,
      this,
    );
    await this.broadcaster.broadcast('BeforeQuery', query, parameters);
    const broadcastResult = new BroadcasterResult();
    const started = Date.now();
    try {
      const params = Array.isArray(parameters)
        ? Object.fromEntries(parameters.map((value, i) => [`p${i}`, value]))
        : parameters;
      const { body } = await this.driver.request(
        `command/${this.driver.database}`,
        {
          language: 'sql',
          command: query,
          params: params ?? {},
          serializer: 'record',
          limit: -1,
        },
        this.session,
      );
      if (!Array.isArray(body.result)) throw new Error('ArcadeDB returned an invalid query result');
      const result = new QueryResult();
      result.records = body.result;
      result.raw = body.result;
      if (/^\s*(UPDATE|DELETE)\b/i.test(statement))
        result.affected = updateReturnsRecords(query)
          ? body.result.length
          : Number(body.result[0]?.count ?? 0);
      else if (/^\s*INSERT\b/i.test(statement))
        result.affected = body.result.filter((row: any) => row['@skipped'] !== true).length;
      const elapsed = Date.now() - started;
      if (
        this.dataSource.options.maxQueryExecutionTime &&
        elapsed > this.dataSource.options.maxQueryExecutionTime
      ) {
        this.dataSource.logger.logQuerySlow(
          elapsed,
          query,
          Array.isArray(parameters) ? parameters : undefined,
          this,
        );
      }
      this.broadcaster.broadcastAfterQueryEvent(
        broadcastResult,
        query,
        parameters,
        true,
        elapsed,
        result.raw,
        undefined,
      );
      return useStructuredResult ? result : result.raw;
    } catch (error) {
      this.dataSource.logger.logQueryError(
        error as Error,
        query,
        Array.isArray(parameters) ? parameters : undefined,
        this,
      );
      this.broadcaster.broadcastAfterQueryEvent(
        broadcastResult,
        query,
        parameters,
        false,
        undefined,
        undefined,
        error,
      );
      throw new QueryFailedError(query, parameters, error as Error);
    } finally {
      await broadcastResult.wait();
    }
  }

  async clearTable(name: string): Promise<void> {
    await this.query(`DELETE FROM ${this.driver.escape(name)}`);
  }
  async getCurrentDatabase(): Promise<string> {
    return this.driver.database;
  }
  async getCurrentSchema(): Promise<undefined> {
    return undefined;
  }
  async getSchemas(): Promise<string[]> {
    return [];
  }
  async hasSchema(): Promise<boolean> {
    return false;
  }
  async getDatabases(): Promise<string[]> {
    return (await this.driver.request('databases')).body.result;
  }
  async hasDatabase(database: string): Promise<boolean> {
    return (await this.driver.request(`exists/${encodeURIComponent(database)}`)).body.result;
  }
  async hasTable(table: Table | string): Promise<boolean> {
    return !!(await this.getTable(typeof table === 'string' ? table : table.name));
  }
  async hasColumn(table: Table | string, column: string): Promise<boolean> {
    return !!(
      await this.getTable(typeof table === 'string' ? table : table.name)
    )?.findColumnByName(column);
  }
  protected async loadTables(names?: string[]): Promise<Table[]> {
    const types = await this.query('SELECT FROM schema:types');
    const indexes = await this.query('SELECT FROM schema:indexes');
    return types
      .filter((type: any) => !names || names.includes(type.name))
      .map((type: any) => {
        const aliases = type.custom?.['typeorm.indexAliases'] ?? {};
        const ownIndexes = indexes
          .filter(
            (index: any) => index.typeName === type.name && index.associatedBucketId === undefined,
          )
          .map((index: any) => ({
            ...index,
            properties: index.properties.flat(),
            name: Object.keys(aliases).find((name) => aliases[name] === index.name) ?? index.name,
          }));
        const primaryName = type.custom?.['typeorm.primaryKey'];
        const primary = ownIndexes.find((index: any) => index.name === primaryName);
        return new Table({
          name: type.name,
          columns: (type.properties ?? []).map(
            (property: any) =>
              new TableColumn({
                name: property.name,
                type: property.type.toLowerCase(),
                isNullable: !property.notNull,
                default: property.default,
                isPrimary: primary?.properties?.includes(property.name) ?? false,
                primaryKeyConstraintName: primary?.properties?.includes(property.name)
                  ? primaryName
                  : undefined,
              }),
          ),
          indices: ownIndexes
            .filter((index: any) => !index.unique)
            .map(
              (index: any) => new TableIndex({ name: index.name, columnNames: index.properties }),
            ),
          uniques: ownIndexes
            .filter((index: any) => index.unique && index.name !== primaryName)
            .map(
              (index: any) => new TableUnique({ name: index.name, columnNames: index.properties }),
            ),
        });
      });
  }
  protected async loadViews(): Promise<never[]> {
    return [];
  }

  clearDatabase: QueryRunner['clearDatabase'] = unsupported;
  stream: QueryRunner['stream'] = unsupported;
  createDatabase: QueryRunner['createDatabase'] = unsupported;
  dropDatabase: QueryRunner['dropDatabase'] = unsupported;
  createSchema: QueryRunner['createSchema'] = unsupported;
  dropSchema: QueryRunner['dropSchema'] = unsupported;
  createView: QueryRunner['createView'] = unsupported;
  dropView: QueryRunner['dropView'] = unsupported;
  changeTableComment: QueryRunner['changeTableComment'] = unsupported;
  renameColumn: QueryRunner['renameColumn'] = unsupported;
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

  private tableName(table: Table | string): string {
    return typeof table === 'string' ? table : table.name;
  }
  private async requireTable(table: Table | string): Promise<Table> {
    const found = await this.getTable(this.tableName(table));
    if (!found) throw new Error(`Table ${this.tableName(table)} does not exist`);
    return found;
  }
  private columnType(column: TableColumn): string {
    const type = this.driver.normalizeType(column);
    if (!this.driver.supportedDataTypes.includes(type as any) && !['map', 'list'].includes(type))
      throw new Error(`Column type ${type} is not supported`);
    if (
      column.isGenerated ||
      column.asExpression ||
      column.generatedType ||
      column.length ||
      column.precision != null ||
      column.scale != null ||
      column.enum ||
      column.unsigned ||
      column.onUpdate ||
      column.charset ||
      column.collation
    ) {
      throw new Error(
        `Generated/precision/enum/SQL-specific column options are not supported: ${column.name}`,
      );
    }
    return (type === 'json' ? 'map' : type === 'array' ? 'list' : type).toUpperCase();
  }
  private validateIndex(index: TableIndex): void {
    if (
      !index.columnNames.length ||
      index.where ||
      index.isFulltext ||
      index.isSpatial ||
      index.type
    )
      throw new Error('Empty, partial and specialized indexes are not supported');
  }

  async createTable(
    table: Table,
    ifNotExists = false,
    createForeignKeys = true,
    createIndices = true,
  ): Promise<void> {
    this.driver.buildTableName(table.name, table.schema, table.database);
    table.columns.forEach((column) => this.columnType(column));
    if (
      table.checks.length ||
      table.exclusions.length ||
      (createForeignKeys && table.foreignKeys.length)
    )
      throw new Error('Foreign keys, checks and exclusion constraints are not supported');
    if (createIndices) table.indices.forEach((index) => this.validateIndex(index));
    if (await this.hasTable(table)) {
      if (ifNotExists) return;
      throw new Error(`Table ${table.name} already exists`);
    }
    await this.query(`CREATE DOCUMENT TYPE ${this.driver.escape(table.name)}`);
    for (const column of table.columns)
      await this.addColumn(
        table.name,
        Object.assign(column.clone(), { isPrimary: false, isUnique: false }),
      );
    if (table.primaryColumns.length)
      await this.createPrimaryKey(
        table.name,
        table.primaryColumns.map((c) => c.name),
        table.primaryColumns[0].primaryKeyConstraintName,
      );
    for (const column of table.columns.filter((c) => c.isUnique))
      await this.createUniqueConstraint(
        table.name,
        new TableUnique({ columnNames: [column.name] }),
      );
    await this.createUniqueConstraints(table.name, table.uniques);
    if (createIndices) await this.createIndices(table.name, table.indices);
  }
  async dropTable(table: Table | string, ifExists = false): Promise<void> {
    const found = await this.getTable(this.tableName(table));
    if (!found) {
      if (ifExists) return;
      throw new Error(`Table ${this.tableName(table)} does not exist`);
    }
    // Drop logical indexes first: 26.9.1 can fail while dropping multiple indexes inside DROP TYPE.
    for (const index of [...found.indices, ...found.uniques])
      await this.dropIndex(found.name, index.name!);
    if (found.primaryColumns.length) await this.dropPrimaryKey(found.name);
    await this.query(`DROP TYPE ${this.driver.escape(found.name)}`);
  }
  async renameTable(table: Table | string, name: string): Promise<void> {
    const found = await this.requireTable(table);
    if (await this.hasTable(name)) throw new Error(`Table ${name} already exists`);
    await this.query(
      `ALTER TYPE ${this.driver.escape(found.name)} NAME ${this.driver.escape(name)}`,
    );
    // ArcadeDB renames logical indexes during type rename. Keep TypeORM's names stable.
    const indexes = await this.query('SELECT FROM schema:indexes');
    const previous = [...found.indices, ...found.uniques];
    if (found.primaryColumns.length)
      previous.push(
        new TableUnique({
          name: found.primaryColumns[0].primaryKeyConstraintName,
          columnNames: found.primaryColumns.map((c) => c.name),
        }),
      );
    const aliases: Record<string, string> = {};
    for (const old of previous) {
      const current = indexes.find(
        (index: any) =>
          index.typeName === name &&
          index.associatedBucketId === undefined &&
          JSON.stringify(index.properties.flat()) === JSON.stringify(old.columnNames),
      );
      if (current && old.name) aliases[old.name] = current.name;
    }
    await this.query(
      `ALTER TYPE ${this.driver.escape(name)} CUSTOM ${this.driver.escape('typeorm.indexAliases')} = ${JSON.stringify(aliases)}`,
    );
  }
  async addColumn(table: Table | string, column: TableColumn): Promise<void> {
    const type = this.columnType(column);
    const found = await this.requireTable(table);
    if (found.findColumnByName(column.name))
      throw new Error(`Column ${column.name} already exists`);
    if (
      !column.isNullable &&
      column.default == null &&
      (await this.query(`SELECT count(*) AS n FROM ${this.driver.escape(found.name)}`))[0].n
    ) {
      throw new Error('Add a nullable column, backfill, then changeColumn to NOT NULL');
    }
    const property = `${this.driver.escape(found.name)}.${this.driver.escape(column.name)}`;
    await this.query(`CREATE PROPERTY ${property} ${type}`);
    if (column.default !== undefined) {
      await this.query(`ALTER PROPERTY ${property} DEFAULT ${column.default}`);
      await this.query(
        `UPDATE ${this.driver.escape(found.name)} SET ${this.driver.escape(column.name)} = ${column.default} WHERE ${this.driver.escape(column.name)} IS NULL`,
      );
    }
    await this.query(`ALTER PROPERTY ${property} NOTNULL ${!column.isNullable}`);
    await this.query(`ALTER PROPERTY ${property} MANDATORY ${!column.isNullable}`);
    if (column.isUnique)
      await this.createUniqueConstraint(
        found.name,
        new TableUnique({ columnNames: [column.name] }),
      );
    if (column.isPrimary)
      await this.createPrimaryKey(found.name, [
        ...found.primaryColumns.map((c) => c.name),
        column.name,
      ]);
  }
  async addColumns(table: Table | string, columns: TableColumn[]): Promise<void> {
    columns.forEach((column) => this.columnType(column));
    for (const column of columns) await this.addColumn(table, column);
  }
  async changeColumn(
    table: Table | string,
    old: TableColumn | string,
    column: TableColumn,
  ): Promise<void> {
    const type = this.columnType(column);
    const found = await this.requireTable(table);
    const previous = found.findColumnByName(typeof old === 'string' ? old : old.name);
    if (!previous) throw new Error('Column does not exist');
    if (previous.name !== column.name || previous.type.toUpperCase() !== type)
      throw new Error(
        'In-place column rename/type changes are not supported; use add, backfill, validate, drop',
      );
    if (previous.isPrimary !== column.isPrimary || previous.isUnique !== column.isUnique)
      throw new Error('Use primary key or unique constraint methods to change keys');
    if (
      !column.isNullable &&
      (
        await this.query(
          `SELECT count(*) AS n FROM ${this.driver.escape(found.name)} WHERE ${this.driver.escape(column.name)} IS NULL`,
        )
      )[0].n
    )
      throw new Error('Backfill NULL values before enforcing NOT NULL');
    const property = `${this.driver.escape(found.name)}.${this.driver.escape(column.name)}`;
    await this.query(`ALTER PROPERTY ${property} NOTNULL ${!column.isNullable}`);
    await this.query(`ALTER PROPERTY ${property} MANDATORY ${!column.isNullable}`);
    await this.query(`ALTER PROPERTY ${property} DEFAULT ${column.default ?? 'null'}`);
  }
  async changeColumns(
    table: Table | string,
    columns: { oldColumn: TableColumn; newColumn: TableColumn }[],
  ): Promise<void> {
    for (const pair of columns) await this.changeColumn(table, pair.oldColumn, pair.newColumn);
  }
  async dropColumn(
    table: Table | string,
    column: TableColumn | string,
    ifExists = false,
  ): Promise<void> {
    const found = await this.requireTable(table);
    const name = typeof column === 'string' ? column : column.name;
    if (!found.findColumnByName(name)) {
      if (ifExists) return;
      throw new Error(`Column ${name} does not exist`);
    }
    if (
      found.primaryColumns.some((c) => c.name === name) ||
      [...found.indices, ...found.uniques].some((i) => i.columnNames.includes(name))
    )
      throw new Error('Drop dependent indexes/keys before dropping a column');
    await this.query(`DROP PROPERTY ${this.driver.escape(found.name)}.${this.driver.escape(name)}`);
    // DROP PROPERTY only removes the schema in ArcadeDB. TypeORM drops the values too.
    await this.query(`UPDATE ${this.driver.escape(found.name)} REMOVE ${this.driver.escape(name)}`);
  }
  async dropColumns(
    table: Table | string,
    columns: TableColumn[] | string[],
    ifExists = false,
  ): Promise<void> {
    for (const column of columns) await this.dropColumn(table, column, ifExists);
  }
  async createIndex(table: Table | string, index: TableIndex): Promise<void> {
    this.validateIndex(index);
    const found = await this.requireTable(table);
    if (index.columnNames.some((name) => !found.findColumnByName(name)))
      throw new Error('Index references a missing column');
    const name =
      index.name ?? this.dataSource.namingStrategy.indexName(found.name, index.columnNames);
    await this.query(
      `CREATE INDEX ${this.driver.escape(name)} ON ${this.driver.escape(found.name)} (${index.columnNames.map(this.driver.escape).join(', ')}) ${index.isUnique ? 'UNIQUE' : 'NOTUNIQUE'}`,
    );
  }
  async createIndices(table: Table | string, indexes: TableIndex[]): Promise<void> {
    for (const index of indexes) await this.createIndex(table, index);
  }
  async dropIndex(
    table: Table | string,
    index: TableIndex | string,
    ifExists = false,
  ): Promise<void> {
    const found = await this.requireTable(table);
    const name = typeof index === 'string' ? index : index.name;
    if (!name) throw new Error('Index name is required');
    const primary = found.primaryColumns[0]?.primaryKeyConstraintName;
    if (![...found.indices, ...found.uniques].some((i) => i.name === name) && primary !== name) {
      if (ifExists) return;
      throw new Error(`Index ${name} does not exist on ${found.name}`);
    }
    // 26.9.1 keeps the original lookup key even when rename changes its displayed name.
    await this.query(`DROP INDEX ${this.driver.escape(name)}`);
  }
  async dropIndices(table: Table | string, indexes: TableIndex[], ifExists = false): Promise<void> {
    for (const index of indexes) await this.dropIndex(table, index, ifExists);
  }
  async createUniqueConstraint(table: Table | string, unique: TableUnique): Promise<void> {
    await this.createIndex(
      table,
      new TableIndex({
        name:
          unique.name ??
          this.dataSource.namingStrategy.uniqueConstraintName(
            this.tableName(table),
            unique.columnNames,
          ),
        columnNames: unique.columnNames,
        isUnique: true,
      }),
    );
  }
  async createUniqueConstraints(table: Table | string, uniques: TableUnique[]): Promise<void> {
    for (const unique of uniques) await this.createUniqueConstraint(table, unique);
  }
  async dropUniqueConstraint(
    table: Table | string,
    unique: TableUnique | string,
    ifExists = false,
  ): Promise<void> {
    await this.dropIndex(
      table,
      typeof unique === 'string'
        ? unique
        : (unique.name ??
            this.dataSource.namingStrategy.uniqueConstraintName(
              this.tableName(table),
              unique.columnNames,
            )),
      ifExists,
    );
  }
  async dropUniqueConstraints(
    table: Table | string,
    uniques: TableUnique[],
    ifExists = false,
  ): Promise<void> {
    for (const unique of uniques) await this.dropUniqueConstraint(table, unique, ifExists);
  }
  async createPrimaryKey(
    table: Table | string,
    names: string[],
    constraintName?: string,
  ): Promise<void> {
    const found = await this.requireTable(table);
    if (found.primaryColumns.length)
      throw new Error('Primary key already exists; use updatePrimaryKeys');
    const name = constraintName ?? this.dataSource.namingStrategy.primaryKeyName(found.name, names);
    for (const column of names) {
      if (!found.findColumnByName(column))
        throw new Error('Primary key references a missing column');
      if (
        (
          await this.query(
            `SELECT count(*) AS n FROM ${this.driver.escape(found.name)} WHERE ${this.driver.escape(column)} IS NULL`,
          )
        )[0].n
      )
        throw new Error('Primary key cannot contain NULL');
    }
    await this.createIndex(
      found.name,
      new TableIndex({ name, columnNames: names, isUnique: true }),
    );
    for (const column of names) {
      await this.query(
        `ALTER PROPERTY ${this.driver.escape(found.name)}.${this.driver.escape(column)} NOTNULL true`,
      );
      await this.query(
        `ALTER PROPERTY ${this.driver.escape(found.name)}.${this.driver.escape(column)} MANDATORY true`,
      );
    }
    await this.query(
      `ALTER TYPE ${this.driver.escape(found.name)} CUSTOM ${this.driver.escape('typeorm.primaryKey')} = ${JSON.stringify(name)}`,
    );
  }
  async dropPrimaryKey(
    table: Table | string,
    constraintName?: string,
    ifExists = false,
  ): Promise<void> {
    const found = await this.requireTable(table);
    const name = found.primaryColumns[0]?.primaryKeyConstraintName;
    if (!name) {
      if (ifExists) return;
      throw new Error('Primary key does not exist');
    }
    if (constraintName && name !== constraintName)
      throw new Error('Primary key name does not match');
    await this.dropIndex(found.name, name);
    await this.query(
      `ALTER TYPE ${this.driver.escape(found.name)} CUSTOM ${this.driver.escape('typeorm.primaryKey')} = null`,
    );
  }
  async updatePrimaryKeys(table: Table | string, columns: TableColumn[]): Promise<void> {
    // Validate replacement uniqueness before removing the old constraint.
    const found = await this.requireTable(table);
    const names = columns.map((c) => c.name);
    const previous = found.primaryColumns.map((c) => c.name);
    if (JSON.stringify(names) === JSON.stringify(previous)) return;
    if (!names.length) return this.dropPrimaryKey(found.name);
    if (!previous.length) return this.createPrimaryKey(found.name, names);
    const name = this.dataSource.namingStrategy.primaryKeyName(found.name, names);
    for (const column of names) {
      if (!found.findColumnByName(column))
        throw new Error('Primary key references a missing column');
      if (
        (
          await this.query(
            `SELECT count(*) AS n FROM ${this.driver.escape(found.name)} WHERE ${this.driver.escape(column)} IS NULL`,
          )
        )[0].n
      )
        throw new Error('Primary key cannot contain NULL');
    }
    await this.createIndex(
      found.name,
      new TableIndex({ name, columnNames: names, isUnique: true }),
    );
    await this.dropPrimaryKey(found.name);
    for (const column of names) {
      await this.query(
        `ALTER PROPERTY ${this.driver.escape(found.name)}.${this.driver.escape(column)} NOTNULL true`,
      );
      await this.query(
        `ALTER PROPERTY ${this.driver.escape(found.name)}.${this.driver.escape(column)} MANDATORY true`,
      );
    }
    await this.query(
      `ALTER TYPE ${this.driver.escape(found.name)} CUSTOM ${this.driver.escape('typeorm.primaryKey')} = ${JSON.stringify(name)}`,
    );
  }
}
