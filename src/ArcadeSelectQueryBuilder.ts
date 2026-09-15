import {
  InsertQueryBuilder,
  SelectQueryBuilder,
  UpdateQueryBuilder,
  DeleteQueryBuilder,
  QueryBuilder,
  type ObjectLiteral,
} from 'typeorm';

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
    if (this.expressionMap.onIgnore || this.expressionMap.onUpdate)
      throw new Error('Insert conflict-ignore and upsert are not supported by ArcadeDB');
    return super.getQuery();
  }
}
