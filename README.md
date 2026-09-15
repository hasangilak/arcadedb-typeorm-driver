# ArcadeDB TypeORM driver

A TypeScript driver connecting TypeORM repositories, query builders and migrations to ArcadeDB’s native HTTP API. Uses Node’s built-in `fetch`; no separate database client is required.

**This is a partial TypeORM implementation.** The demo contains 116 verified queries, 24 reversible migrations and five seeders. That coverage does not mean every TypeORM API or combination of options works. See [unsupported driver features](#unsupported-driver-features) and [known-issues-and-coverage-gaps](#known-issues-and-coverage-gaps) before choosing it for an application.

| Component | Supported/tested version                                      |
| --------- | ------------------------------------------------------------- |
| Node.js   | 22+; Docker tests use Node 24                                 |
| TypeORM   | **1.1.1**, pinned peer dependency; TypeORM 0.3 is unsupported |
| ArcadeDB  | **26.9.1**, pinned Docker image                               |
| Package   | `arcadedb-typeorm-driver` 0.1.0                               |

## Contents

- [Run the demo](#run-the-demo)
- [Install and use in an application](#install-and-use-in-an-application)
- [Connection options](#connection-options)
- [Supported features and data types](#supported-features-and-data-types)
- [Queries](#queries)
- [Transactions and errors](#transactions-and-errors)
- [Schema synchronization and migrations](#schema-synchronization-and-migrations)
- [ArcadeDB’s own limitations and differences](#arcadedbs-own-limitations-and-differences)
- [Unsupported driver features](#unsupported-driver-features)
- [Known issues and coverage gaps](#known-issues-and-coverage-gaps)
- [Partitioning, sharding and replication](#partitioning-sharding-and-replication)
- [Testing and development](#testing-and-development)

## Run the demo

From this repository, with Node.js and Docker installed:

```sh
npm ci
docker compose up -d --wait arcadedb
npm run demo -- up
npm run demo -- seed
npm run demo -- queries
```

The server listens on `http://127.0.0.1:2480` with disposable credentials `root` / `integration-password`. The demo creates a separate `driver_demo` database. Override `ARCADEDB_URL`, `ARCADEDB_DATABASE`, `ARCADEDB_USERNAME` and `ARCADEDB_PASSWORD` as needed. Database creation requires administrator permissions.

```sh
npm run demo -- status               # whether migrations are pending
npm run demo -- queries graphPattern # run one named example
npm run demo -- down                 # revert the last migration; may delete data
```

The query cookbook includes reads and writes. Write examples create and drop temporary document types, so the demo user needs schema permissions. Seeders can be run repeatedly; the migration suite verifies this. The `legacy` command creates and seeds the first four migrations to exercise later data upgrades.

See the [demo guide](demo/README.md) for migration and seeder details, and the [query compatibility matrix](demo/QUERY_SUPPORT.md) for all 116 examples and expected API coverage.

## Install and use in an application

The package is private (`private: true` prevents npm publication). Install a tarball or a pinned Git revision. Both CommonJS `require()` and ESM `import` work, and TypeScript declarations are included. Applications need Node.js 22+ and TypeORM **1.1.1**; an existing TypeORM 0.3 application must migrate before using this driver.

### Option 1: private tarball

In this repository:

```sh
npm ci
npm pack
```

This produces `arcadedb-typeorm-driver-0.1.0.tgz` with compiled JavaScript, declarations, source maps, README and license. In the other project:

```sh
npm install /absolute/path/arcadedb-typeorm-driver-0.1.0.tgz typeorm@1.1.1 reflect-metadata@^0.2.2
```

For a team or CI, copy the tarball into that project's `vendor/` directory and commit it with its lockfile, or distribute it through your private artifact storage:

```sh
npm install ./vendor/arcadedb-typeorm-driver-0.1.0.tgz typeorm@1.1.1 reflect-metadata@^0.2.2
```

The installed tarball runs without a TypeScript compiler or build scripts. Rebuild and reinstall the tarball when updating the driver; use a new package version for a new distributed release.

### Option 2: pinned Git dependency

Once the desired commit is pushed to your private repository, replace `<commit-sha>` with its full hash:

```sh
npm install 'git+ssh://git@github.com/hasangilak/arcadedb-typeorm-driver.git#<commit-sha>' typeorm@1.1.1 reflect-metadata@^0.2.2
```

Git and repository access must be available to the installing machine. npm builds the source through `prepare`; Git installs therefore need build dependencies and lifecycle scripts enabled. Keep the commit pinned and commit the consuming project's lockfile. Tarball installs avoid this build step. See [npm lifecycle documentation](https://docs.npmjs.com/cli/v11/using-npm/scripts/).

For another project on the same machine, a local Git revision is also supported:

```sh
npm install 'git+file:///absolute/path/to/arcadedb-typeorm-driver#<commit-sha>'
```

### Import and connect

```js
// CommonJS
const { ArcadeDataSource } = require('arcadedb-typeorm-driver');
```

The TypeScript/ESM example below uses the same public package entry point. Import from `arcadedb-typeorm-driver`, rather than internal `dist/` paths.

This example creates a document type, saves a record and reads it back. Set `ARCADEDB_PASSWORD` before running it.

```ts
import 'reflect-metadata';
import { EntitySchema } from 'typeorm';
import { ArcadeDataSource } from 'arcadedb-typeorm-driver';

interface Person {
  id: string;
  name: string;
  age: number;
}

const Person = new EntitySchema<Person>({
  name: 'Person',
  tableName: 'person',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    name: { type: String },
    age: { type: Number },
  },
});

async function main(): Promise<void> {
  const password = process.env.ARCADEDB_PASSWORD;
  if (!password) throw new Error('Set ARCADEDB_PASSWORD');

  const db = new ArcadeDataSource({
    url: 'http://127.0.0.1:2480',
    database: 'app',
    username: 'root',
    password,
    createDatabase: true, // requires administrator permissions
    entities: [Person],
    synchronize: true, // development only; creates missing schema
  });

  await db.initialize();
  try {
    const people = db.getRepository(Person);
    const person = await people.save({ name: 'Ada', age: 36 });
    console.log(await people.findOneByOrFail({ id: person.id }));
    await people.update({ id: person.id }, { age: 37 });
  } finally {
    await db.destroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

Use `ArcadeDataSource` wherever your application or framework constructs a `DataSource`, including framework data source factories. Ordinary `new DataSource({ type: 'arcadedb' })` is not registered by this package.

Runtime tests primarily use `EntitySchema`. Decorator entities have a compile-time consumer test, but equivalent runtime coverage is incomplete. Decorator applications need `experimentalDecorators`, `emitDecoratorMetadata` and `reflect-metadata`.

## Connection options

| Option                      | Default / meaning                                                                 |
| --------------------------- | --------------------------------------------------------------------------------- |
| `database`                  | Required; letters, numbers, underscores and hyphens                               |
| `username`, `password`      | Required, nonempty HTTP credentials                                               |
| `url`                       | `http://127.0.0.1:2480`; HTTP(S), without embedded credentials, query or fragment |
| `type`                      | Optional `'arcadedb'`                                                             |
| `requestTimeout`            | `30000` milliseconds per request; positive integer                                |
| `createDatabase`            | `false`; create the database if missing, with sufficient permissions              |
| `entities`                  | TypeORM entity definitions                                                        |
| `synchronize`               | `false`; additive schema creation only                                            |
| `migrations`                | TypeORM migration classes or paths                                                |
| `migrationsRun`             | `false`; run pending migrations during initialization                             |
| `migrationsTableName`       | TypeORM migration history name; configurable                                      |
| `migrationsTransactionMode` | Driver default `'none'`; see migration restrictions below                         |

Use HTTPS for remote connections. Options inherited from TypeORM are not a promise that their behavior is implemented. In particular, query caching is rejected; see the coverage section for other restrictions. Query subscribers receive awaited `beforeQuery` / `afterQuery` events, including parameters, runner context, results and failures.

## Supported features and data types

| Area                          | Implemented and exercised                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Repositories / entity manager | Save, insert, find, count, exists, numeric aggregates, update, delete, remove, clear, preload, increment and decrement; batch saves/inserts     |
| Select query builders         | Single-entity filters, parameters, brackets, projections, raw/entity results, ordering, offset/cursor pagination, distinct results and grouping |
| Aggregate filtering           | Adapted `HAVING` for projected aggregates; use raw result methods                                                                               |
| Write query builders          | Insert, update, delete, soft delete and restore within the supported single-type scope                                                          |
| Entity columns                | Assigned keys, client-generated UUIDs, creation/update timestamps, version columns, soft deletion and basic value transformers                  |
| Transactions                  | Commit/rollback, transaction managers and separate query-runner sessions                                                                        |
| Schema                        | Document types, properties, defaults, nullability, ordinary/unique indexes and primary keys                                                     |
| Migrations                    | Ordered execution, history, pending checks, revert, fake execution/revert and supported transaction modes                                       |
| Native SQL                    | Parameterized document queries, graph operations and database-specific commands through `query()` / `sql`                                       |

The [116-query matrix](demo/QUERY_SUPPORT.md) identifies specific tested operations. These categories do not imply support for every overload, relation or option.

### Column mappings

| Entity column type                            | ArcadeDB storage                 |
| --------------------------------------------- | -------------------------------- |
| `String`, `string`, `text`, `varchar`, `uuid` | `STRING`                         |
| `Number`, `integer`, `int`, `smallint`        | `INTEGER`                        |
| `long`                                        | `LONG`                           |
| `float`, `double`                             | `FLOAT`, `DOUBLE`                |
| `Boolean`, `boolean`, `bool`                  | `BOOLEAN`                        |
| `date`                                        | `DATE`                           |
| `Date`, `datetime`, `timestamp`               | `DATETIME`                       |
| `json`                                        | `MAP`                            |
| `array`, or a column with `array: true`       | `LIST`                           |
| `simple-json`                                 | JSON text in `STRING`            |
| `simple-array`                                | Comma-separated text in `STRING` |

`simple-json` and `simple-array` are implemented but lack dedicated round-trip coverage. Prefer `json` and `array` for the demonstrated use cases. `simple-array` cannot preserve commas within individual values.

Dates use UTC. Datetime strings without an offset are interpreted as UTC; run the server in UTC when using automatic timestamps or native date expressions. Docker tests run the client in Europe/Berlin to exercise conversion.

A `LONG` hydrated as a JavaScript `number` is not lossless beyond JavaScript’s safe integer range. Native `DECIMAL`, `BINARY`, `LINK` and embedded-record mappings are not implemented. JavaScript `bigint` is not supported by the JSON parameter transport. ArcadeDB’s internal `@rid` is separate from an entity’s application primary-key property.

## Queries

The following examples assume the initialized `db` and `Person` schema above, inside an async function.

### Filter, order and paginate

```ts
const rows = await db
  .getRepository(Person)
  .createQueryBuilder('person')
  .where('person.age > :age', { age: 25 })
  .andWhere('person.name IN (:...names)', { names: ['Ada', 'Grace'] })
  .orderBy('person.age', 'DESC')
  .addOrderBy('person.id', 'ASC')
  .skip(0)
  .take(10)
  .getMany();
```

Repository find operators include comparisons, ranges, lists, null checks, `Like`, `ILike` and Boolean combinations covered by the cookbook. The driver translates `ILike` case conversion and TypeORM’s existence-query wrapper to ArcadeDB-compatible SQL; this is not general correlated-subquery support.

### Group and filter aggregates

```ts
const groups = await db
  .getRepository(Person)
  .createQueryBuilder('person')
  .select('person.age', 'age')
  .addSelect('COUNT(*)', 'people_count')
  .groupBy('person.age')
  .having('COUNT(*) > :minimum', { minimum: 1 })
  .getRawMany();
```

Aggregate expressions used by `HAVING` must also be selected with aliases. The driver filters an outer query over the grouped results. This path is tested with raw results, not arbitrary entity hydration or nested expressions.

### Upsert by a unique key

```ts
const result = await db
  .getRepository(Person)
  .upsert({ id: 'person-ada', name: 'Ada', age: 38 }, ['id']);
console.log(result.identifiers, result.generatedMaps, result.raw);
```

Repository and entity-manager `upsert()` translate to native `UPDATE ... UPSERT RETURN AFTER`. Conflict paths are entity property names, supplied as an array or `conflictPaths` object; composite keys work. The driver checks for an **installed unique index matching exactly those columns**. Conflict values must be supplied, non-null scalars. Keep the index installed throughout the operation.

Insert builders also support `.orUpdate(overwriteColumns, conflictColumns)`, using **database column names**. Entity metadata is required. Generated UUIDs and creation dates survive conflicts; omitted fields remain unchanged on updates, new records receive schema defaults, and automatic version/update-date columns advance. Results contain identifiers, hydrated generated maps and native returned records. Use `.returning()` on the insert builder to project its raw result; without it, upserts return full records.

Batch upserts execute one statement per input row, in order, within a transaction. A failed batch rolls back when the driver owns that transaction. Inside a caller-owned transaction, propagate failures and let the caller roll back. Single-row upserts use the native atomic operation; concurrent conflicts may still raise database errors, and the driver does not retry them automatically.

Unsupported upsert options are rejected: `skipUpdateIfNoValuesChanged: true`, index predicates, overwrite conditions, alternative upsert types and insert-from-select. Batch SQL cannot be represented by one `getQuery()` result; use `execute()`. See [runnable upsert/returning examples](demo/queries-upsert.ts).

Named targets are supported as `.orUpdate(['name', 'age'], 'constraint_name')`. The name must resolve to a primary key, unique constraint or unique index in entity metadata **and** match an installed index with the same columns. Unknown names and non-unique indexes are rejected. Explicit `primaryKeyConstraintName` values are honored when creating a schema; existing schemas created with the old default name need a reviewed index migration because synchronization is additive.

### Returned write records

```ts
const updated = await db
  .getRepository(Person)
  .createQueryBuilder()
  .update()
  .set({ age: 38 })
  .where({ name: 'Ada' })
  .returning(['id', 'name', 'age'])
  .execute();
console.log(updated.affected, updated.raw);
```

Insert, update, delete, soft-delete and restore builders accept `returning('*')` or an array of mapped entity property names. `output()` is an alias. Inserts return inserted records, deletes return the records before deletion, and updates return records after modification. `raw` uses database column names and native values; generated maps and entity hydration still convert dates and transformers. Projection does not prevent generated IDs/defaults from being hydrated. Additional version/timestamp columns may be returned for TypeORM’s entity updates. Update/delete with no matches return `affected: 0` and an empty array. Arbitrary returning expressions are unsupported.

```ts
const inserted = await db
  .getRepository(Person)
  .createQueryBuilder()
  .insert()
  .values({ name: 'Ada', age: 38 })
  .returning(['id', 'name'])
  .execute();
const deleted = await db
  .getRepository(Person)
  .createQueryBuilder()
  .delete()
  .where({ id: inserted.identifiers[0].id })
  .output(['id', 'name'])
  .execute();
```

### Ignore duplicate keys

```ts
const inserted = await db
  .getRepository(Person)
  .createQueryBuilder()
  .insert()
  .values([
    { id: 'person-ada', name: 'Ada', age: 38 },
    { id: 'person-grace', name: 'Grace', age: 40 },
  ])
  .orIgnore()
  .returning(['id'])
  .execute();
```

`orIgnore()` uses native `ON DUPLICATE KEY SKIP`: only unique-key conflicts are skipped. Other errors still fail. `raw`, `identifiers` and `generatedMaps` contain only inserted rows, in input order, and `afterInsert` fires only for those rows. `beforeInsert` runs for every candidate. Batches use a transaction; caller-owned transactions must be rolled back by the caller on failure. Combining ignore with upsert or insert-from-select is rejected. Raw native SQL retains the server’s skipped-row metadata. See [native INSERT](https://docs.arcadedb.com/arcadedb/reference/sql/sql-insert).

### Array find operators

For a mapped `array` / `LIST` column, use TypeORM `ArrayContains(['a'])`, `ArrayContainedBy(['a', 'b'])` or `ArrayOverlap(['b'])`. Use `Any(['id1', 'id2'])` against a scalar property. These also work in object-form query-builder filters, including update/delete predicates, `Not`, `And` and `Or`. See the [runnable examples](demo/queries-extensions.ts).

Values are bound arrays of strings, numbers, booleans or nulls; nested arrays and objects are rejected. Containment ignores duplicate elements. Null/missing columns do not match, including under negation. Empty arrays follow set semantics: every non-null list contains the empty list; an empty list is contained by every non-null list; overlap with an empty list never matches. Null elements cannot satisfy containment or overlap. `Any` follows SQL `IN` null semantics, so `Not(Any(['a', null]))` matches no rows. `JsonContains` and raw PostgreSQL operator syntax remain unsupported.

### Server execution deadlines

```ts
const people = await db
  .getRepository(Person)
  .createQueryBuilder('person')
  .where('person.age > :age', { age: 25 })
  .maxExecutionTime(1000)
  .getMany();
```

`maxExecutionTime(milliseconds)` uses native `TIMEOUT ... EXCEPTION` for selects; expiration fails with `QueryFailedError`, rather than returning partial results. Use a non-negative safe integer; zero disables it. It works with clones, pagination, aggregates, counts and `getExists()`. The limit applies to each executed query, not an entire transaction or a multi-query operation. Switching to a write builder with an active deadline is rejected.

On ArcadeDB 26.9.1, the HTTP endpoint appends a limit after a top-level timeout clause. The driver wraps the translated select to keep that SQL valid. Inspect `getQueryAndParameters()` for the executed SQL. `requestTimeout` separately limits the HTTP request; allow enough time for the server deadline and response. See [native SELECT](https://docs.arcadedb.com/arcadedb/reference/sql/sql-select).

### Native SQL and parameters

```ts
await db.query('SELECT FROM person WHERE name = :name', { name: 'Ada' });
await db.query('SELECT FROM person WHERE name = :p0', ['Ada']);
await db.sql`SELECT FROM person WHERE name = ${'Ada'}`;
```

Values travel separately from SQL as JSON parameters. Raw array parameters use `:p0`, `:p1`, etc.; query builders support named parameters and `:...array` expansion. Bind values, not table names or SQL syntax. Function expressions supplied to TypeORM query builders are trusted SQL.

Raw `query()` uses native ArcadeDB SQL without ORM dialect translation. It is available through the data source, entity manager, repository and query runner; SQL template tags are covered too. The HTTP language is currently fixed to `sql`.

Graph creation/traversal is demonstrated with native SQL in the seeded [graph examples](demo/queries.ts). TypeORM relations are not mapped to ArcadeDB edges or links.

## Transactions and errors

```ts
await db.transaction('REPEATABLE READ', async (manager) => {
  await manager.getRepository(Person).update({ name: 'Ada' }, { age: 38 });
  await manager.getRepository(Person).save({ name: 'Grace', age: 40 });
});
```

Use the provided manager for every operation in the transaction. Each query runner owns one HTTP transaction session; querying through the outer data source does not automatically join it. Releasing a runner rolls back an active transaction, and `destroy()` releases outstanding runners.

`READ COMMITTED` is the default; `REPEATABLE READ` is also supported by the driver and the [ArcadeDB HTTP API](https://docs.arcadedb.com/arcadedb/reference/http-api/http). Other TypeORM isolation levels, nested transactions and savepoints are unsupported. Idle transaction sessions can expire according to server configuration.

Query failures are exposed as TypeORM `QueryFailedError`; its `driverError` retains the HTTP `status` and server `exception` when available. Requests have a timeout but no automatic retry. A transport failure during commit can leave the outcome unknown; check application state before retrying a write.

## Schema synchronization and migrations

### Additive synchronization

`synchronize: true` creates missing types, properties and indexes. It does not reconcile changes to existing types, defaults, nullability or indexes, and it does not remove obsolete schema or data. `db.driver.createSchemaBuilder().log()` previews pending creation SQL; reverse SQL is not generated.

Use reviewed migrations with `synchronize: false` for production changes. Complete automatic migration generation is unsupported.

### Write a migration

Use ordinary TypeORM migration classes. Migration names end with a timestamp, as in TypeORM:

```ts
import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreatePerson1800000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'person',
        columns: [
          { name: 'id', type: 'string', isPrimary: true },
          { name: 'name', type: 'string' },
          { name: 'age', type: 'integer' },
        ],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('person');
  }
}
```

For a fresh application database, replace `synchronize: true` in the connection example with:

```ts
synchronize: false,
migrations: [CreatePerson1800000000000],
migrationsTransactionMode: 'none',
```

After initialization, call `await db.runMigrations()`. `await db.showMigrations()` reports whether migrations are pending; `await db.undoLastMigration()` reverts the last migration and can delete data. `migrationsRun: true` runs them during initialization. Custom history table names and fake execution/revert are also supported. Programmatic APIs and the demo CLI are tested; the full stock TypeORM CLI workflow is not.

### Migration capabilities and restrictions

- Create, drop and rename tables; add/drop columns, including bulk methods.
- Change existing column defaults and nullability.
- Create/drop ordinary and unique indexes; create/drop/replace single or composite primary keys.
- Primary keys use a unique index plus required properties. Composite-key schema changes are tested; composite-key repository CRUD needs more coverage.
- In-place column rename and type changes are rejected. Use add → backfill → validate → remove, as demonstrated by the migration suite.
- `TableColumn.default` is a native SQL expression: use `default: "'pending'"` for a string literal. Entity column defaults use TypeORM’s value conversion.
- Dropping a column removes its stored values as well as its property definition. Remove dependent indexes/constraints first.

**Schema migrations use `transaction: 'none'` by default.** This driver rejects schema DDL inside an active HTTP transaction and provides no atomic schema rollback guarantee. Data-only migrations can use `all` or `each`; rollback is tested. A failed schema migration can leave partial changes without a history entry, so inspect and repair the schema before retrying.

Run one migrator per database at a time, using a deployment lock if necessary. Migration history IDs are allocated by the driver and are not a concurrent migration coordination mechanism.

The [24 demo migrations and five seeders](demo/README.md) progress from tables and indexes to data conversions, composite key replacement, aggregate snapshots and a native graph projection. Tests run every migration up/down, replay the full sequence and seed twice.

## ArcadeDB’s own limitations and differences

These describe the database or its SQL model, separately from missing driver implementation. The linked online documentation may cover releases newer than the pinned **26.9.1** test server.

| Database behavior                                                                                           | Consequence for a TypeORM application                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native SQL does not provide conventional relational `JOIN` syntax                                           | Use links, property navigation or graph traversal in native SQL. Relational joins cannot simply be forwarded unchanged. See [SQL introduction](https://docs.arcadedb.com/arcadedb/reference/sql/sql-introduction).                                                                            |
| Queries and transactions are scoped to one database; there are no cross-database joins or transactions      | Cross-database/shard operations require application coordination. See [databases](https://docs.arcadedb.com/arcadedb/concepts/databases).                                                                                                                                                     |
| Schema constraints use ArcadeDB’s property and index model                                                  | Do not assume relational foreign-key, arbitrary SQL `CHECK` or exclusion-constraint definitions are portable. Native property constraints include mandatory, not-null, range and regular-expression rules. See [properties](https://docs.arcadedb.com/arcadedb/reference/sql/sql-properties). |
| Documented `ALTER PROPERTY` changes attributes; it does not expose SQL-style property name/type replacement | This driver uses add/backfill/drop migrations for those changes. See [property alteration](https://docs.arcadedb.com/arcadedb/reference/sql/sql-properties).                                                                                                                                  |
| Native `DROP PROPERTY` removes the schema definition but leaves record values                               | The driver’s `dropColumn()` additionally removes values to implement column-drop semantics. See [property removal](https://docs.arcadedb.com/arcadedb/reference/sql/sql-properties).                                                                                                          |

### Native capabilities and their TypeORM integration

| Native capability                                            | Current driver boundary                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL `UPDATE ... UPSERT` and `RETURN BEFORE` / `RETURN AFTER` | TypeORM `upsert()` / `orUpdate()` and write `returning()` are supported within the documented restrictions. Delete returns pre-deletion records; update `RETURN BEFORE` requires raw SQL. Use reviewed native SQL where appropriate. See [UPDATE](https://docs.arcadedb.com/arcadedb/reference/sql/sql-update). |
| Links, vertices and edges                                    | Native SQL examples work; ORM relations, cascades and graph entity mapping are missing. See [database basics](https://docs.arcadedb.com/arcadedb/concepts/basics).                                                                                                                                              |
| Specialized indexes, including full-text and vector indexes  | The schema adapter covers ordinary and unique indexes. Specialized indexes need native commands and their own version-specific tests. See [indexes](https://docs.arcadedb.com/arcadedb/concepts/indexes).                                                                                                       |
| More native property types and constraints                   | Only the mappings listed above are implemented; unsupported mappings are not evidence that ArcadeDB lacks the type. See [properties](https://docs.arcadedb.com/arcadedb/reference/sql/sql-properties).                                                                                                          |
| Multiple HTTP query languages                                | This driver submits `sql`; it has no language selector for Cypher, Gremlin or other server languages. See [HTTP API](https://docs.arcadedb.com/arcadedb/reference/http-api/http).                                                                                                                               |
| Bucket partitioning and HA replication                       | No automatic shard routing, topology discovery or replica routing; see below.                                                                                                                                                                                                                                   |

The pinned server also needs dialect adaptations for the TypeORM existence wrapper, case-conversion expressions and aggregate filtering. Those implemented translations do not make arbitrary SQL from another database portable.

## Unsupported driver features

The following are **driver limitations**, not blanket claims about ArcadeDB:

- ORM relations, relation query builders, relation cascades/eager loading, tree repositories and graph entity mapping.
- Relational joins, aliased ORM subqueries, general correlated `EXISTS` and common table expressions.
- Conditional/partial-index upserts, skipping unchanged upserts, insert-from-select upserts and combining `orIgnore()` with `orUpdate()`. Arbitrary returning expressions are unsupported.
- `JsonContains`, nested-array/object containment and raw PostgreSQL operator syntax. Scalar-array `ArrayContains`, `ArrayContainedBy`, `ArrayOverlap` and `Any` are supported as described above.
- Query caching, result streaming, pessimistic/dirty-read locks, `NOWAIT` / `SKIP LOCKED`, `distinctOn()`, index hints and execution-time hints on writes. Select `maxExecutionTime()` uses a server deadline; `requestTimeout` separately limits the client request.
- Auto-increment/identity generation, SQL schemas, views, foreign-key/check/exclusion schema APIs and specialized index metadata.
- In-place property rename/type conversion and complete generated migration diffs.
- Nested transactions/savepoints and isolation levels other than those documented above.
- Automatic failover, read-replica routing, application shard routing and distributed transactions.

Many unsupported paths throw explicit errors. The regression suite checks guards across builder-type switches and clones.

## Known issues and coverage gaps

Query-builder guards are preserved across write/select switches and clones. Query subscriber events are tested for successful and failed requests, including transaction sessions. Transaction lifecycle subscriber hooks still need dedicated event tests.

**Implemented or inherited behavior needing more coverage:**

- Decorator entities at runtime, embedded properties, custom column names, naming strategies and `select: false` / `insert: false` / `update: false` combinations.
- Composite-key repository operations; optimistic-lock conflicts, same-row concurrent writes and repeatable-read visibility under contention. Basic version-column behavior is covered.
- Custom repositories (`extend`, transactional `withRepository`), Active Record and `updateAll` / `deleteAll`.
- Null/undefined handling options; save options such as `reload`, `listeners`, `transaction` and subscriber data; batch failure behavior.
- `simple-json`, `simple-array` and transformer chains beyond the basic transformer case.
- Stock TypeORM CLI workflows, clustered operation, failover and sharding.

Treat these as unverified, not as supported merely because the method is available in TypeScript. The 116-query demo exercises concrete cases; it is not a complete TypeORM conformance suite.

## Partitioning, sharding and replication

| Mechanism                                      | How to use it with this driver                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bucket partitioning within one database        | Keep one entity/type. Configure its buckets and selection strategy using native commands in a migration; ordinary repositories query the type.                     |
| Application sharding across databases/clusters | Resolve tenant → shard, select that shard’s initialized `ArcadeDataSource`, then obtain its repository. Run migrations and retain history separately per database. |
| HA replication                                 | Configure ArcadeDB’s cluster separately and supply an appropriate endpoint. The driver accepts one URL and does not discover topology or route reads to replicas.  |

ArcadeDB types can span buckets, and type queries cover those buckets. Hash-based `partitioned(...)` selection groups records by properties; explicit bucket placement needs native queries. This does not automatically distribute independent shards across servers. See [bucket selection](https://docs.arcadedb.com/arcadedb/concepts/basics) and [HA replication](https://docs.arcadedb.com/arcadedb/concepts/high-availability).

Keep each transaction, uniqueness requirement and connected graph within one application shard. Routing, rebalancing and cross-shard coordination belong to the application. Partition/repartition commands need tests against your exact server version; the Docker suite tests a single server, not cluster behavior.

## Testing and development

```sh
npm test                  # build and unit tests
npm run test:types        # compile the TypeScript consumer fixture
npm run test:docker       # build and all tests against a disposable Docker server
```

The latest full Docker run passed **204 tests, including subtests**. It includes assertions for the 116 query examples, migrations, seed repeatability, transactions and explicitly rejected APIs. This number describes the suite, not the number of supported TypeORM features.

`test:docker` starts a dedicated Compose project, waits for database readiness and removes its containers and volumes even on failure. It also builds the driver/demo, checks types, ESLint and formatting, and installs the private package into isolated consumer apps through both tarball and pinned Git dependencies. Consumer tests verify CommonJS/ESM imports, TypeScript declarations, CRUD, upserts, returning results and rollback against Docker. The packaging test needs Git and access to npm dependencies. Stop any other server using port 2480 before running it.

For local iteration against a running Docker database:

```sh
docker compose up -d --wait arcadedb
npm run test:integration
npm run test:migrations
npm run test:queries
npm run test:package       # install tarball and Git revision in isolated consumer apps
docker compose down --volumes # removes this local Compose database data
```

Tests use `ARCADEDB_URL`, `ARCADEDB_DATABASE`, `ARCADEDB_USERNAME` and `ARCADEDB_PASSWORD`, defaulting to the Compose test configuration. Use a dedicated test database: integration and migration fixtures clear/drop their test data and schema.

### Commit hooks

`npm ci` installs the native Git hook through `prepare` when running in the repository. Run `npm run hooks:install` to reinstall it. Every commit checks **ESLint and Prettier** over the working tree; failures stop the commit. The hook does not rewrite or stage files.

```sh
npm run lint
npm run format       # apply formatting
npm run format:check
```

Implementation changes follow failing tests → implementation → passing Docker tests, with incremental commits.

### TypeORM integration

TypeORM has no public external driver registry. `ArcadeDataSource` bootstraps its constructor with an inert driver dependency, then installs `ArcadeDriver` before connecting. No global factory is patched and no PostgreSQL connection is made. The pinned TypeORM version is intentional: upgrading it requires retesting the internal interfaces used by this driver.

License: ISC.
