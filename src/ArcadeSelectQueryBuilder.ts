import {
  InsertQueryBuilder,
  InsertResult,
  SelectQueryBuilder,
  UpdateQueryBuilder,
  DeleteQueryBuilder,
  QueryBuilder,
  type ObjectLiteral,
} from 'typeorm';

import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { randomUUID } from 'node:crypto';
import type { ArcadeDriver } from './ArcadeDriver';
import { SoftDeleteQueryBuilder } from 'typeorm/query-builder/SoftDeleteQueryBuilder';

// TypeORM's global registry creates base builders when switching query kinds.
// Keep those transitions local to this driver; clones retain their constructor.
function withArcadeSwitches<T extends new (...args: any[]) => QueryBuilder<any>>(Base: T): T {
  return class extends Base {
    getQuery(): string {
      return Reflect.apply(Base.prototype.getQuery, this, []);
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
)<Entity> {}
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
    throw new Error('ArcadeDB returning requires * or an array of mapped entity property names');
}

/** Reject options TypeORM otherwise silently ignores for an external driver. */
export class ArcadeSelectQueryBuilder<Entity extends ObjectLiteral> extends withArcadeSwitches(
  SelectQueryBuilder,
)<Entity> {
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
      map.maxExecutionTime > 0 ||
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
  override getQuery(): string {
    if (this.expressionMap.onIgnore)
      throw new Error('Insert conflict-ignore is not supported by ArcadeDB');
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
    const conflict = options.conflict;
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
    if (!this.expressionMap.onUpdate) return super.createInsertExpression();
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
    if (!this.expressionMap.onUpdate) return super.execute();
    const { columns } = this.upsertColumns();
    const values = this.getValueSets();
    if (!values.length) return new InsertResult();
    const runner = this.obtainQueryRunner();
    let started = false;
    try {
      // Check the installed schema, not just decorator claims about uniqueness.
      const table = await runner.getTable(this.getMainTableName());
      const uniqueKeys = table
        ? [
            table.primaryColumns.map((column) => column.name),
            ...table.uniques.map((unique) => unique.columnNames),
            ...table.indices.filter((index) => index.isUnique).map((index) => index.columnNames),
          ]
        : [];
      if (
        !uniqueKeys.some(
          (key) =>
            key.length === columns.length &&
            columns.every((column) => key.includes(column.databaseName)),
        )
      )
        throw new Error(
          'ArcadeDB upsert conflict columns require a matching installed unique index',
        );
      if (!runner.isTransactionActive && (values.length > 1 || this.expressionMap.useTransaction)) {
        await runner.startTransaction();
        started = true;
      }
      const result = new InsertResult();
      result.raw = [];
      for (const value of values) {
        const single = this.clone()
          .setQueryRunner(runner)
          .values(value as QueryDeepPartialEntity<Entity>);
        const next = await single.executeSingleUpsert();
        result.raw.push(...next.raw);
        result.identifiers.push(...next.identifiers);
        result.generatedMaps.push(...next.generatedMaps);
      }
      if (started) await runner.commitTransaction();
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

  private executeSingleUpsert(): Promise<InsertResult> {
    return super.execute();
  }
}
