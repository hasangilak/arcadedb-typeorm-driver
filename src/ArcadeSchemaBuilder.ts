import { Query } from 'typeorm/driver/Query';
import { SqlInMemory } from 'typeorm/driver/SqlInMemory';
import type { SchemaBuilder } from 'typeorm/schema-builder/SchemaBuilder';
import type { ArcadeDriver } from './ArcadeDriver';

/** Additive synchronization: never drops types, properties or existing data. */
export class ArcadeSchemaBuilder implements SchemaBuilder {
  constructor(private readonly driver: ArcadeDriver) {}

  async build(): Promise<void> {
    const sql = await this.log();
    const runner = this.driver.createQueryRunner();
    try {
      for (const query of sql.upQueries) await runner.query(query.query);
    } finally { await runner.release(); }
  }

  async log(): Promise<SqlInMemory> {
    const runner = this.driver.createQueryRunner();
    try {
      const tables = await runner.getTables();
      const indexes: { name: string }[] = await runner.query('SELECT FROM schema:indexes');
      const sql = new SqlInMemory();
      const add = (query: string) => sql.upQueries.push(new Query(query));
      const escape = this.driver.escape;
      for (const metadata of this.driver.dataSource.entityMetadatas.filter(entity => entity.synchronize)) {
        const table = tables.find(table => table.name === metadata.tableName);
        if (!table) add(`CREATE DOCUMENT TYPE ${escape(metadata.tableName)} IF NOT EXISTS`);
        for (const column of metadata.columns) {
          const existing = table?.findColumnByName(column.databaseName);
          const type = this.driver.normalizeType(column);
          const nativeType = type === 'json' ? 'MAP' : type === 'array' ? 'LIST' : type.toUpperCase();
          if (existing) {
            if (existing.type !== nativeType.toLowerCase()) throw new Error(`Schema change requires explicit SQL: ${metadata.tableName}.${column.databaseName}`);
            continue;
          }
          const property = `${escape(metadata.tableName)}.${escape(column.databaseName)}`;
          add(`CREATE PROPERTY ${property} IF NOT EXISTS ${nativeType}`);
          if (!column.isNullable) add(`ALTER PROPERTY ${property} NOTNULL true`);
          const defaultValue = this.driver.normalizeDefault(column);
          if (defaultValue !== undefined) add(`ALTER PROPERTY ${property} DEFAULT ${defaultValue}`);
        }
        const desiredIndexes = [
          ...metadata.indices.filter(index => index.synchronize).map(index => ({ name: index.name, columns: index.columns, unique: index.isUnique })),
          ...metadata.uniques.map(unique => ({ name: unique.name, columns: unique.columns, unique: true })),
        ];
        if (metadata.primaryColumns.length) {
          desiredIndexes.push({
            name: this.driver.dataSource.namingStrategy.primaryKeyName(metadata.tableName, metadata.primaryColumns.map(c => c.databaseName)),
            columns: metadata.primaryColumns, unique: true,
          });
        }
        for (const index of desiredIndexes) {
          if (indexes.some(existing => existing.name === index.name)) continue;
          add(`CREATE INDEX ${escape(index.name)} IF NOT EXISTS ON ${escape(metadata.tableName)} (${index.columns.map(c => escape(c.databaseName)).join(', ')}) ${index.unique ? 'UNIQUE' : 'NOTUNIQUE'}`);
        }
      }
      return sql;
    } finally { await runner.release(); }
  }
}
