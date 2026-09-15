import {
  InsertQueryBuilder,
  InsertResult,
  SelectQueryBuilder,
  UpdateQueryBuilder,
  DeleteQueryBuilder,
  QueryBuilder,
  type ObjectLiteral,
  type QueryRunner,
} from 'typeorm';

import type { WhereClauseCondition } from 'typeorm/query-builder/WhereClause';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { randomUUID } from 'node:crypto';
import type { ArcadeDriver } from './ArcadeDriver';
import { SoftDeleteQueryBuilder } from 'typeorm/query-builder/SoftDeleteQueryBuilder';

// TypeORM's global registry creates base builders when switching query kinds.
// Keep those transitions local to this driver; clones retain their constructor.
function withArcadeSwitches<T extends new (...args: any[]) => QueryBuilder<any>>(Base: T): T {
  return class extends Base {
    getQuery(): string {
      if (this.expressionMap.queryType !== 'select' && this.expressionMap.maxExecutionTime > 0)
        throw new Error('ArcadeDB maxExecutionTime is supported only for select queries');
      return Reflect.apply(Base.prototype.getQuery, this, []);
    }
    protected createWhereConditionExpression(
      condition: WhereClauseCondition,
      alwaysWrap = false,
    ): string {
      if (
        typeof condition === 'object' &&
        !Array.isArray(condition) &&
        'parameters' in condition &&
        ['arrayContains', 'arrayContainedBy', 'arrayOverlap', 'any'].includes(condition.operator)
      ) {
        const [left, right] = condition.parameters;
        const value: unknown = this.getParameters()[right.slice(1)];
        if (value === null) return 'null IN [true]';
        if (
          !Array.isArray(value) ||
          value.some(
            (item) => item !== null && !['string', 'number', 'boolean'].includes(typeof item),
          )
        )
          throw new Error('ArcadeDB array operators require an array of scalar values or nulls');
        if (condition.operator === 'any') return `${left} IN ${right}`;
        let predicate: string;
        if (condition.operator === 'arrayContains') {
          predicate = value.includes(null) ? 'false' : `${left} CONTAINSALL ${right}`;
        } else if (condition.operator === 'arrayContainedBy') {
          predicate = `NOT(${left} CONTAINS null) AND (${right} CONTAINSALL ${left})`;
        } else {
          const filtered = value.includes(null)
            ? this.createParameter(value.filter((item) => item !== null))
            : right;
          predicate = `${left} CONTAINSANY ${filtered}`;
        }
        // Native collection predicates return false for null. IN preserves SQL UNKNOWN
        // through NOT/AND/OR on 26.9.1, unlike comparing a nullable boolean to true.
        return `if((${left} IS NULL), null, (${predicate})) IN [true]`;
      }
      return Reflect.apply(Base.prototype.createWhereConditionExpression, this, [
        condition,
        alwaysWrap,
      ]);
    }

    select(...args: any[]): any {
      return arcadeBuilder(Reflect.apply(Base.prototype.select, this, args));
    }
    insert(): any {
      return arcadeBuilder(super.insert());
    }
    update(...args: any[]): any {
      return arcadeBuilder(Reflect.apply(Base.prototype.update, this, args));
    }
    delete(): any {
      return arcadeBuilder(super.delete());
    }
    softDelete(): any {
      return arcadeBuilder(super.softDelete());
    }
    restore(): any {
      return arcadeBuilder(super.restore());
    }
    relation(..._args: any[]): any {
      throw new Error('ORM relations are not supported by ArcadeDB');
    }
  };
}

function arcadeBuilder(builder: QueryBuilder<any>): QueryBuilder<any> {
  const constructors = {
    select: ArcadeSelectQueryBuilder,
    insert: ArcadeInsertQueryBuilder,
    update: ArcadeUpdateQueryBuilder,
    delete: ArcadeDeleteQueryBuilder,
    'soft-delete': ArcadeSoftDeleteQueryBuilder,
    restore: ArcadeSoftDeleteQueryBuilder,
  };
  const Constructor = constructors[
    builder.expressionMap.queryType as keyof typeof constructors
  ] as new (builder: QueryBuilder<any>) => QueryBuilder<any>;
  return builder instanceof Constructor ? builder : new Constructor(builder);
}

class ArcadeUpdateQueryBuilder<Entity extends ObjectLiteral> extends withArcadeSwitches(
  UpdateQueryBuilder,
)<Entity> {
  override returning(columns: string | string[]): this {
    validateReturning(this, columns);
    return super.returning(columns);
  }
}
class ArcadeDeleteQueryBuilder<Entity extends ObjectLiteral> extends withArcadeSwitches(
  DeleteQueryBuilder,
)<Entity> {
  override returning(columns: string | string[]): this {
    validateReturning(this, columns);
    return super.returning(columns);
  }
  protected override createDeleteExpression(): string {
    return `DELETE FROM ${this.getTableName(this.getMainTableName())}${this.expressionMap.returning?.length ? ' RETURN BEFORE' : ''}${this.createWhereExpression()}`;
  }
  override async execute() {
    const result = await super.execute();
    result.raw = projectReturnedRows(this, result.raw);
    return result;
  }
}
class ArcadeSoftDeleteQueryBuilder<Entity extends ObjectLiteral> extends withArcadeSwitches(
  SoftDeleteQueryBuilder,
)<Entity> {
  override returning(columns: string | string[]): this {
    validateReturning(this, columns);
    return super.returning(columns);
  }
}

function validateReturning(builder: QueryBuilder<any>, columns: string | string[]): void {
  if (columns === '*') return;
  const metadata = builder.expressionMap.mainAlias?.hasMetadata
    ? builder.expressionMap.mainAlias.metadata
    : undefined;
  if (
    !Array.isArray(columns) ||
    !metadata ||
    columns.some((name) => !metadata.findColumnsWithPropertyPath(name).length)
  )
    throw new Error(
      'ArcadeDB returning expressions are not supported; use * or an array of mapped entity property names',
    );
}

function projectReturnedRows(builder: QueryBuilder<any>, rows: ObjectLiteral[]): ObjectLiteral[] {
  const returning = builder.expressionMap.returning;
  if (!Array.isArray(returning) || !returning.length) return rows;
  const columns = returning.flatMap((name) =>
    builder.expressionMap.mainAlias!.metadata.findColumnsWithPropertyPath(name),
  );
  return rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column.databaseName, row[column.databaseName]])),
  );
}

/** Reject options TypeORM otherwise silently ignores for an external driver. */
export class ArcadeSelectQueryBuilder<Entity extends ObjectLiteral> extends withArcadeSwitches(
  SelectQueryBuilder,
)<Entity> {
  override maxExecutionTime(milliseconds: number): this {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0)
      throw new Error('maxExecutionTime must be a non-negative safe integer');
    return super.maxExecutionTime(milliseconds);
  }

  override getQueryAndParameters(): [string, any[]] {
    const [sql, parameters] = super.getQueryAndParameters();
    const timeout = this.expressionMap.maxExecutionTime;
    // 26.9.1's HTTP endpoint appends LIMIT after a top-level TIMEOUT. An outer
    // SELECT leaves that limit valid while the inner executor enforces the deadline.
    return [timeout > 0 ? `SELECT FROM (${sql} TIMEOUT ${timeout} EXCEPTION)` : sql, parameters];
  }

  protected override async executeExistsQuery(queryRunner: QueryRunner): Promise<boolean> {
    const results = await new ArcadeSelectQueryBuilder(this.dataSource, queryRunner)
      .fromDummy()
      .select('1', 'row_exists')
      .whereExists(this)
      .limit(1)
      .maxExecutionTime(this.expressionMap.maxExecutionTime)
      .getRawMany();
    return results.length > 0;
  }

  override timeTravelQuery(_timeTravelFn?: string | boolean): this {
    throw new Error('Time travel queries are not supported by ArcadeDB');
  }
  override getQuery(): string {
    const map = this.expressionMap;
    if (
      map.selectDistinctOn.length ||
      map.cache ||
      map.useIndex?.length ||
      map.timeTravel ||
      (map.lockMode && map.lockMode !== 'optimistic') ||
      map.onLocked ||
      map.commonTableExpressions.length
    ) {
      throw new Error(
        'DISTINCT ON, caching, index/time hints, pessimistic locks and CTEs are not supported by ArcadeDB',
      );
    }
    return super.getQuery();
  }
}

class ArcadeInsertQueryBuilder<Entity extends ObjectLiteral> extends withArcadeSwitches(
  InsertQueryBuilder,
)<Entity> {
  override returning(columns: string | string[]): this {
    validateReturning(this, columns);
    return super.returning(columns);
  }
  override getQuery(): string {
    if (
      this.expressionMap.onIgnore &&
      (this.expressionMap.onUpdate || this.expressionMap.insertFromSelect)
    )
      throw new Error(
        'Combining conflict-ignore with upsert or insert-from-select is not supported',
      );
    return super.getQuery();
  }

  private upsertColumns() {
    const map = this.expressionMap;
    const options = map.onUpdate;
    if (!map.mainAlias?.hasMetadata || !options)
      throw new Error('ArcadeDB upsert requires mapped entity metadata');
    if (
      map.insertFromSelect ||
      map.insertColumns.length ||
      map.commonTableExpressions.length ||
      options.skipUpdateIfNoValuesChanged ||
      options.indexPredicate ||
      options.overwriteCondition ||
      (options.upsertType && options.upsertType !== 'on-conflict-do-update')
    )
      throw new Error('These ArcadeDB upsert options are not supported');
    const metadata = map.mainAlias.metadata;
    let conflict = options.conflict;
    if (typeof conflict === 'string') {
      const primaryName =
        metadata.primaryColumns[0]?.primaryKeyConstraintName ??
        this.dataSource.namingStrategy.primaryKeyName(
          metadata.tableName,
          metadata.primaryColumns.map((column) => column.databaseName),
        );
      const named = [
        ...metadata.uniques,
        ...metadata.indices.filter((index) => index.isUnique),
      ].find((index) => index.name === conflict);
      const namedColumns =
        named?.columns ?? (conflict === primaryName ? metadata.primaryColumns : undefined);
      if (!namedColumns?.length) throw new Error(`Unknown mapped unique constraint: ${conflict}`);
      conflict = namedColumns.map((column) => column.databaseName);
    }
    if (!Array.isArray(conflict) || !conflict.length || new Set(conflict).size !== conflict.length)
      throw new Error('ArcadeDB upsert requires explicit conflict columns');
    const columns = conflict.map((name) => {
      const column = metadata.columns.find((column) => column.databaseName === name);
      if (!column || !column.isInsert) throw new Error(`Invalid upsert conflict column: ${name}`);
      return column;
    });
    const overwrite = options.overwrite ?? [];
    if (
      overwrite.some(
        (name) =>
          !metadata.columns.some((column) => column.databaseName === name && column.isUpdate),
      )
    )
      throw new Error('Invalid upsert overwrite column');
    return { metadata, columns, overwrite };
  }

  protected override createInsertExpression(): string {
    if (!this.expressionMap.onUpdate)
      return (
        super
          .createInsertExpression()
          .replace(/ ON CONFLICT DO NOTHING\s*$/, ' ON DUPLICATE KEY SKIP') + ' RETURN @this'
      );
    const { metadata, columns, overwrite } = this.upsertColumns();
    const values = this.getValueSets();
    if (values.length !== 1)
      throw new Error('Batch upsert has multiple statements; use execute() instead of getQuery()');
    const value = values[0];
    const driver = this.dataSource.driver as ArcadeDriver;
    const where = columns.map((column) => {
      const input = column.getEntityValue(value);
      if (input == null || typeof input === 'function')
        throw new Error(`Upsert conflict value is required: ${column.propertyPath}`);
      const stored = driver.preparePersistentValue(input, column);
      if (stored == null || typeof stored === 'object')
        throw new Error('Upsert conflict values must be non-null scalars');
      return `${this.escape(column.databaseName)} = ${this.createParameter(stored)}`;
    });
    const assignments: string[] = [];
    for (const column of metadata.columns) {
      if (!column.isInsert) continue;
      const name = this.escape(column.databaseName);
      const input = column.getEntityValue(value);
      let expression: string;
      if (input !== undefined) {
        expression =
          typeof input === 'function'
            ? input()
            : this.createParameter(driver.preparePersistentValue(input, column));
      } else if (column.isGenerated && column.generationStrategy === 'uuid') {
        expression = this.createParameter(randomUUID());
      } else if (column.isVersion) {
        assignments.push(`${name} = if((@rid IS NULL), 1, ${name} + 1)`);
        continue;
      } else if (column.isUpdateDate) {
        assignments.push(`${name} = sysdate()`);
        continue;
      } else if (column.isCreateDate) {
        expression = 'sysdate()';
      } else continue;
      // @rid distinguishes insertion from update even when an existing field is null.
      const preserve =
        (column.isGenerated && input === undefined) ||
        !overwrite.includes(column.databaseName) ||
        column.isCreateDate ||
        !column.isUpdate;
      assignments.push(
        `${name} = ${preserve ? `if((@rid IS NULL), ${expression}, ${name})` : expression}`,
      );
    }
    if (!assignments.length) throw new Error('Upsert requires values to write');
    return `UPDATE ${this.getTableName(metadata.tablePath)} SET ${assignments.join(', ')} UPSERT RETURN AFTER @this WHERE ${where.join(' AND ')}`;
  }

  override async execute(): Promise<InsertResult> {
    if (!this.expressionMap.onUpdate && !this.expressionMap.onIgnore) {
      const result = await super.execute();
      result.raw = projectReturnedRows(this, result.raw);
      return result;
    }
    const columns = this.expressionMap.onUpdate ? this.upsertColumns().columns : undefined;
    const values = this.getValueSets();
    if (!values.length) return new InsertResult();
    const runner = this.obtainQueryRunner();
    let started = false;
    try {
      // Check the installed schema, not just decorator claims about uniqueness.
      const table = columns ? await runner.getTable(this.getMainTableName()) : undefined;
      const uniqueKeys = table
        ? [
            {
              name: table.primaryColumns[0]?.primaryKeyConstraintName,
              columns: table.primaryColumns.map((column) => column.name),
            },
            ...table.uniques.map((unique) => ({ name: unique.name, columns: unique.columnNames })),
            ...table.indices
              .filter((index) => index.isUnique)
              .map((index) => ({ name: index.name, columns: index.columnNames })),
          ]
        : [];
      if (
        columns &&
        !uniqueKeys.some(
          (key) =>
            key.columns.length === columns.length &&
            (typeof this.expressionMap.onUpdate?.conflict !== 'string' ||
              key.name === this.expressionMap.onUpdate.conflict) &&
            columns.every((column) => key.columns.includes(column.databaseName)),
        )
      )
        throw new Error(
          'ArcadeDB upsert conflict columns require a matching installed unique index',
        );
      if (!runner.isTransactionActive && (values.length > 1 || this.expressionMap.useTransaction)) {
        await runner.startTransaction();
        started = true;
      }
      const result = this.expressionMap.onIgnore
        ? await this.executeIgnoringDuplicates(runner)
        : new InsertResult();
      result.raw ??= [];
      for (const value of this.expressionMap.onIgnore ? [] : values) {
        const single = this.clone()
          .setQueryRunner(runner)
          .values(value as QueryDeepPartialEntity<Entity>);
        const next = await single.executeSingleUpsert();
        result.raw.push(...next.raw);
        result.identifiers.push(...next.identifiers);
        result.generatedMaps.push(...next.generatedMaps);
      }
      if (started) await runner.commitTransaction();
      result.raw = projectReturnedRows(this, result.raw);
      return result;
    } catch (error) {
      if (started && runner.isTransactionActive) {
        try {
          await runner.rollbackTransaction();
        } catch {
          /* preserve the original failure */
        }
      }
      throw error;
    } finally {
      if (runner !== this.queryRunner) await runner.release();
    }
  }

  private async executeIgnoringDuplicates(runner: QueryRunner): Promise<InsertResult> {
    const values = this.getValueSets();
    const metadata = this.expressionMap.mainAlias?.hasMetadata
      ? this.expressionMap.mainAlias.metadata
      : undefined;
    if (this.expressionMap.callListeners && metadata)
      for (const value of values)
        await runner.broadcaster.broadcast('BeforeInsert', metadata, value);
    const [sql, parameters] = this.getQueryAndParameters();
    const queryResult = await runner.query(sql, parameters, true);
    const result = new InsertResult();
    result.raw = [];
    for (const [index, row] of queryResult.records.entries()) {
      if (row['@skipped'] === true) continue;
      result.raw.push(row);
      if (metadata && this.expressionMap.updateEntity) {
        const generated = this.dataSource.driver.createGeneratedMap(metadata, row) ?? {};
        runner.manager.merge(metadata.target, values[index], generated);
        result.generatedMaps.push(generated);
        result.identifiers.push(metadata.getEntityIdMap(values[index]) ?? {});
      }
      if (this.expressionMap.callListeners && metadata)
        await runner.broadcaster.broadcast('AfterInsert', metadata, values[index]);
    }
    return result;
  }

  private executeSingleUpsert(): Promise<InsertResult> {
    return super.execute();
  }
}
