# TypeORM query coverage

Compatibility target: **TypeORM 1.1.1 / ArcadeDB 26.9.1**. There are exactly **116 working named examples**. Rejection tests are additional and do not count toward 116. This is broad coverage of the driver's supported query APIs, not a claim that every TypeORM feature or every combination works on ArcadeDB.

```sh
docker compose up -d --wait arcadedb
npm run demo -- up
npm run demo -- seed
npm run demo -- queries
npm run demo -- queries havingAggregate
npm run demo -- queries softRemove
npm run test:docker
```

## Where the 116 examples live

| Numbers | Count | Source                                         | Coverage                                                                                                   |
| ------- | ----- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1–21    | 21    | [queries.ts](queries.ts)                       | Introductory repository reads, projection, pagination, aggregates, native graph patterns and atomic writes |
| 22–46   | 25    | [queries-repository.ts](queries-repository.ts) | Repository read methods, existence, numeric aggregates, comparison/boolean/find operators                  |
| 47–71   | 25    | [queries-builder.ts](queries-builder.ts)       | Query-builder predicates, parameters, cloning, result modes, grouping/HAVING, manager/repository SQL       |
| 72–92   | 21    | [queries-writes.ts](queries-writes.ts)         | Save/insert/update/delete, batches, preload, counters, soft deletion/restoration, rollback                 |
| 93–100  | 8     | [queries-native.ts](queries-native.ts)         | Named/tagged parameters, query runners, isolation levels, reverse graph traversal, edge counts, UNWIND     |
| 101–106 | 6     | [queries-upsert.ts](queries-upsert.ts)         | Upsert insert/conflict/batch/rollback and update/soft-delete returning                                     |
| 107–116 | 10    | [queries-extensions.ts](queries-extensions.ts) | Insert/delete returning, duplicate ignore, named conflicts, array predicates and server deadlines          |

Every exported function is independently callable as `queries.exampleName(dataSource)`. The CLI prints each name and its JSON result. Examples use fixed fixture values so their results can be compared exactly in tests; replace these values with application inputs while retaining parameter binding.

## Supported TypeORM API families

| Family               | Exercised APIs / examples                                                                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository reads     | `find`, `findBy`, `findOne`, `findOneBy`, `findOneOrFail`, `findOneByOrFail`; missing-row null and exception behavior                                                                                                             |
| Paging and counts    | `findAndCount`, `findAndCountBy`, `count`, `countBy`, `getCount`, `getManyAndCount`, `skip`/`take`, `limit`/`offset`, cursor predicates                                                                                           |
| Existence            | `exists`, `existsBy`, `getExists`; translated to a query limited to one row                                                                                                                                                       |
| Numeric aggregates   | `sum`, `average`, `minimum`, `maximum`, arithmetic projections, grouped SUM and COUNT                                                                                                                                             |
| Find operators       | `Equal`, `Not`, `LessThan`, `LessThanOrEqual`, `MoreThan`, `MoreThanOrEqual`, `Between`, `In` including an empty array, `Like`, `ILike`, `And`, `Or`, `Raw`, `IsNull`, `ArrayContains`, `ArrayContainedBy`, `ArrayOverlap`, `Any` |
| Find options         | Object projections, ordering, OR arrays, pagination, UTC date conversion, `withDeleted`, `setFindOptions`                                                                                                                         |
| Builder predicates   | String/object/OR-array `where`, `andWhere`, `orWhere`, `Brackets`, `NotBrackets`, ID predicates, named and spread parameters                                                                                                      |
| Builder state        | `setParameter`, `setParameters`, `clone`, `orderBy`, `addOrderBy`, `select`, `addSelect`, `distinct`                                                                                                                              |
| Builder results      | `getMany`, `getOne`, `getOneOrFail`, `getRawOne`, `getRawMany`, `getRawAndEntities`, `execute`                                                                                                                                    |
| Group filtering      | `groupBy`, `addGroupBy`, `having`, `andHaving`, ordering/pagination after filtering. HAVING aggregate expressions must be projected with aliases; use raw result methods.                                                         |
| Repository writes    | `create` + `save`, existing-record save, chunked save, batch insert, update by criteria/IDs, delete, remove, preload + save, increment, decrement, clear                                                                          |
| Soft deletion        | `softDelete`, `restore`, `softRemove`, `recover`, `withDeleted`; query-builder soft delete and restore; version increment                                                                                                         |
| Mutation builders    | `insert().values().execute()`, `update().set().where().execute()`, arithmetic updates, delete/softDelete/restore builders                                                                                                         |
| Managers and runners | `EntityManager.find`, transaction-manager reads/writes, `QueryRunner.query`, explicit release, data-source transactions with READ COMMITTED and REPEATABLE READ                                                                   |
| Raw queries          | `DataSource`, `EntityManager`, and `Repository` `query()` / tagged `sql`; native arrays, nested documents, SQL subqueries, MATCH, incoming/outgoing graph edges, UNWIND                                                           |

`ILike` translates TypeORM's UPPER expressions into ArcadeDB string methods. HAVING is implemented as an outer filter over the grouped result. Use explicit projection aliases for aggregates, e.g. `.addSelect('sum(item.quantity)', 'units').having('sum(item.quantity) > :minimum', { minimum: 1 })`. SQL functions and expressions still need to be compatible with ArcadeDB; the driver is not a general SQL parser or translator for arbitrary database dialects.

## Unsupported or database-specific paths

| Feature                                                                                   | Current behavior / alternative                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ORM relations, relation query builder, cascades/eager relation loading, tree repositories | Relation/tree entity metadata is rejected. Use native graph SQL for connected data.                                                                                      |
| SQL joins and aliased ORM subqueries                                                      | Rejected by the driver; use native graph traversal or reviewed native SQL subqueries where applicable.                                                                   |
| General `whereExists` / correlated EXISTS                                                 | Not supported. Repository existence and `getExists()` have a dedicated translation; this does not implement general correlated SQL EXISTS.                               |
| CTEs                                                                                      | Rejected; use native subqueries where supported.                                                                                                                         |
| `JsonContains` and raw PostgreSQL operators                                               | Rejected; scalar-array find operators translate to native predicates. Nested arrays and objects are unsupported.                                                         |
| `orIgnore` and advanced upsert options                                                    | Conditional/partial-index upserts, skip-unchanged options and combining ignore with upsert are rejected. Duplicate ignore and named unique targets are supported.        |
| `returning` / `output`                                                                    | Insert, update, delete, soft-delete and restore support `*` or mapped property arrays. Arbitrary expressions are rejected.                                               |
| Streaming                                                                                 | Rejected. Use bounded pages.                                                                                                                                             |
| Query caching                                                                             | Rejected both in DataSource options and query options.                                                                                                                   |
| DISTINCT ON, index hints, time travel                                                     | Rejected instead of silently ignored. Select `maxExecutionTime` enforces a server deadline; `requestTimeout` separately limits HTTP requests.                            |
| Pessimistic/dirty-read locks, NOWAIT, SKIP LOCKED                                         | Rejected. Use the documented transaction isolation levels. Optimistic locking remains TypeORM's entity version/date check and is not a write compare-and-swap guarantee. |
| Nested transactions/savepoints; SERIALIZABLE isolation                                    | Rejected. Supported isolation levels are READ COMMITTED and REPEATABLE READ.                                                                                             |
| Cross-database queries / distributed transactions                                         | Unsupported; select a DataSource per database and coordinate in the application.                                                                                         |
| SQL-dialect-specific functions and arbitrary combinations                                 | Not covered by a general compatibility claim; verify the exact query against the pinned database version.                                                                |

These limitations mean **the driver does not support all possible TypeORM queries**. The tests distinguish working APIs from unsupported paths, including checks that unsupported operations leave the fixtures unchanged.

## Verification and cleanup

`test/queries.test.cjs` requires 116 distinct names and checks each result against independent expected values. It also tests compound HAVING filters, unsupported API rejection, CLI selection and the full 116-query CLI run. Before/after snapshots verify that seeded documents, graph records and schema types are unchanged.

The additional write examples use [query-scratch.ts](query-scratch.ts) to create an isolated temporary type with generated UUIDs, defaults, a version column and soft-delete metadata. Each type is dropped in `finally`. Running those examples requires schema-write permissions. The original atomic-recalculation example rolls back its fixture changes; the temporary-account example inserts and deletes its record in the same committed transaction.

The full Docker suite also exercises migration rollback/replay, schema mutation, constraints, raw parameter handling, transaction isolation and TypeScript consumer declarations. Passing examples are regression evidence for these concrete queries, not proof of arbitrary SQL compatibility.

References: [TypeORM repository API](https://typeorm.io/docs/working-with-entity-manager/repository-api/), [find options](https://typeorm.io/docs/working-with-entity-manager/find-options/), [query builder](https://typeorm.io/docs/query-builder/select-query-builder/).

## Native write extensions (101–106)

| Example               | Verified result                                                             |
| --------------------- | --------------------------------------------------------------------------- |
| `upsertInsert`        | Insert by an assigned primary key; version 1 and returned values            |
| `upsertConflict`      | Update the same key; one record and version 2                               |
| `upsertBatch`         | Update an existing record and insert another, preserving input result order |
| `upsertRollback`      | Manager upsert participates in transaction rollback                         |
| `updateReturning`     | Return selected properties and affected-row count                           |
| `softDeleteReturning` | Return the deletion timestamp and hide the record from normal reads         |

The integration suite additionally covers composite unique keys, physical index validation, stable generated UUIDs, defaults and transformers, database-enforced batch rollback, simultaneous inserts/updates, and update/restore result hydration. Concurrent database conflicts are surfaced; no automatic retry is performed.

## Further extensions (107–116)

[queries-extensions.ts](queries-extensions.ts) demonstrates insert/delete projections, duplicate-key ignore with correct inserted IDs, an upsert against a named primary index, four scalar-array operators, negated overlap and a paginated select deadline. Write examples use temporary types; array reads use the seeded catalog.

Integration tests additionally exercise null/missing lists, empty arrays, null members, duplicate elements, nested boolean predicates, bound values, update/delete array filters, ignored-row events, empty inserts, named composite constraints, missing physical indexes and actual server timeout errors. See the [driver guide](../README.md#queries) for precise semantics and limits.
