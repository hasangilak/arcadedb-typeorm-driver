import { InsertQueryBuilder, SelectQueryBuilder, type ObjectLiteral } from 'typeorm';

/** Reject options TypeORM otherwise silently ignores for an external driver. */
export class ArcadeSelectQueryBuilder<
  Entity extends ObjectLiteral,
> extends SelectQueryBuilder<Entity> {
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

  override insert(): InsertQueryBuilder<Entity> {
    this.expressionMap.queryType = 'insert';
    return new ArcadeInsertQueryBuilder(this);
  }
}

class ArcadeInsertQueryBuilder<Entity extends ObjectLiteral> extends InsertQueryBuilder<Entity> {
  override getQuery(): string {
    if (this.expressionMap.onIgnore || this.expressionMap.onUpdate)
      throw new Error('Insert conflict-ignore and upsert are not supported by ArcadeDB');
    return super.getQuery();
  }
}
