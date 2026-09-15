# ArcadeDB TypeORM driver

A TypeScript driver connecting TypeORM repositories and query builders to ArcadeDB's native HTTP API. Uses Node's built-in `fetch`; no additional database client is required.

**Compatibility:** Node.js 22+, TypeORM **1.1.1**, ArcadeDB **26.9.1**. TypeORM 0.3 is not supported by this release.

## Build and use

```sh
npm ci
npm run build
```

The package entry point is `dist/index.js`, with TypeScript declarations alongside it. Install this local package into an application with `npm install /path/to/arcadedb-typeorm-driver`.

```ts
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

const db = new ArcadeDataSource({
  url: 'http://127.0.0.1:2480',
  database: 'app',
  username: 'root',
  password: process.env.ARCADEDB_PASSWORD!,
  createDatabase: true, // optional; requires administrator permissions
  entities: [Person],
  synchronize: true, // development only; creates missing schema
});

await db.initialize();
try {
  const people = db.getRepository(Person);
  const person = await people.save({ name: 'Ada', age: 36 });
  console.log(await people.findOneByOrFail({ id: person.id }));

  await db.transaction(async (manager) => {
    await manager.update(Person, { id: person.id }, { age: 37 });
  });
} finally {
  await db.destroy();
}
```

Decorator-based entities work too; enable `experimentalDecorators` and `emitDecoratorMetadata` in your application. Use `ArcadeDataSource` wherever you would otherwise construct a `DataSource`, including a framework's data source factory. This is a real TypeORM `DataSource` subclass.

## Queries and transactions

```ts
const rows = await db
  .getRepository(Person)
  .createQueryBuilder('person')
  .where('person.age > :age', { age: 25 })
  .orderBy('person.age', 'DESC')
  .skip(5)
  .take(10)
  .getMany();

// Raw SQL is native ArcadeDB SQL, without ORM dialect translation.
await db.query('SELECT FROM person WHERE name = :name', { name: 'Ada' });
await db.query('SELECT FROM person WHERE name = :p0', ['Ada']);
await db.sql`SELECT FROM person WHERE name = ${'Ada'}`;

await db.transaction('REPEATABLE READ', async (manager) => {
  // Use this manager to keep every operation in this transaction.
  await manager.getRepository(Person).update({ name: 'Ada' }, { age: 38 });
});
```

Values travel as JSON parameters, separate from SQL. Raw array parameters use `:p0`, `:p1`, etc. Query builders also support named parameters and `:...array` expansion. Explicit function expressions in query builders are trusted SQL, as in TypeORM itself.

Each query runner owns its HTTP transaction session. `READ COMMITTED` is the default; `REPEATABLE READ` is also supported. Releasing a runner rolls back an active transaction. `destroy()` releases outstanding runners. Transactions are not automatically retried; a transport failure during commit can leave its outcome unknown. ArcadeDB also expires idle sessions according to its server configuration.

Connection options include `url` (default `http://127.0.0.1:2480`), required `database`/`username`/`password`, `requestTimeout` (default 30,000 ms), and `createDatabase` (default `false`). Use HTTPS for remote connections. Normal TypeORM entity, logging, naming strategy, and subscriber options are accepted.

## Supported scope

- Repository save, insert, find, count, update, delete, remove, and clear; single-entity query builders, filtering, sorting, and pagination.
- Assigned primary keys and client-generated UUIDs.
- Automatic creation/update timestamps, version columns, soft deletion, and restoration.
- String/text/varchar/UUID, integer/long, float/double, boolean, date/datetime/timestamp, JSON maps, arrays, simple JSON/arrays, and column transformers.
- Document types, properties, defaults, nullability, primary/unique indexes, and ordinary indexes through additive synchronization.
- Native ArcadeDB SQL through `query()` for document and graph operations; TypeORM query errors retain the HTTP status and server exception in `driverError`.

`synchronize` adds missing types, properties and indexes. It never drops existing data or alters existing properties. `driver.createSchemaBuilder().log()` previews pending creation SQL; reverse SQL is not generated. Use reviewed migrations for production schema changes.

Date/time values use UTC. The driver interprets ArcadeDB datetime strings without an offset as UTC; run the server in UTC when using automatic timestamps or native date expressions. Docker tests run the client in Europe/Berlin to exercise this conversion.

**Not supported:** ORM relations/joins, aliased ORM subqueries, graph entity mapping, auto-increment keys, SQL schemas, complete automatic migration generation, query caching, nested transactions/savepoints, streaming, upsert/RETURNING, foreign-key/check/exclusion constraints, views, and specialized indexes. Unsupported schema methods throw explicitly. Use native SQL where applicable. Schema synchronization does not reconcile changes to existing defaults, nullability or indexes.

TypeORM has no public external driver registry. `ArcadeDataSource` bootstraps its constructor with an inert driver dependency, then installs `ArcadeDriver` before connecting. No global factory is patched and no PostgreSQL connection is made. The TypeORM peer version is pinned because this relies on its internal interfaces.

## Migrations and seeders

For **100 runnable examples** progressing from repository reads to aggregates, pagination, JSON/array filters, native graph traversal and transactional writes, see the [query cookbook](demo/README.md#query-examples-easy-to-sophisticated) and [TypeORM compatibility matrix](demo/QUERY_SUPPORT.md). After migrating and seeding, run `npm run demo -- queries` or select an example such as `npm run demo -- queries graphPattern`.

Pass ordinary TypeORM `MigrationInterface` classes in `migrations`, then call `runMigrations()`, `showMigrations()` or `undoLastMigration()`. `migrationsRun`, custom history table names, fake execution/revert, and transaction modes are supported.

Schema migrations default to `transaction: 'none'`: ArcadeDB DDL is not transactional. Data-only migrations can use `all` or `each`. A schema migration failure can leave partial changes without a history entry; inspect and repair those changes before retrying. Run one migration process per database at a time, using a deployment lock when necessary.

QueryRunner supports create/drop/rename table; add/drop columns; change defaults/nullability; create/drop ordinary and unique indexes; and create/drop/replace primary keys, including composite keys. Bulk variants are supported. In-place column rename/type changes are rejected: add a new column, backfill and validate it, then drop the old one. Primary keys are backed by a unique index and required properties. SQL defaults in `TableColumn` are native SQL expressions, for example `default: "'pending'"`.

The [demo](demo/README.md) contains **24 reversible migrations and five seeders**, progressing from basic tables to data conversions, composite key replacement, aggregate snapshots and a graph projection. Docker tests run every migration up/down, replay the full sequence, and seed twice to check repeatability.

## Partitioning, sharding and replication

| Mechanism            | Where it happens                                       | TypeORM integration                                                                                                                          |
| -------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Bucket partitioning  | Multiple physical buckets within one ArcadeDB database | Keep one entity/type; configure buckets and selection strategy with native SQL in a migration. Normal repositories query the type.           |
| Application sharding | Separate databases or clusters holding different data  | Resolve tenant → shard, then select that shard's initialized `ArcadeDataSource` before obtaining a repository.                               |
| HA replication       | Copies of a database across servers                    | Use a suitable cluster endpoint; this driver currently accepts one URL and provides no topology discovery, failover or read-replica routing. |

ArcadeDB types can span buckets, and type queries cover their buckets. Hash-based `partitioned(...)` selection groups records by a property; explicit time/region bucket placement requires native queries. See [ArcadeDB buckets and selection strategies](https://docs.arcadedb.com/arcadedb/concepts/basics). The online documentation can describe features newer than the pinned 26.9.1 image; partition/repartition SQL needs its own version-specific tests before use.

For application sharding, keep an explicit tenant-to-shard map. Run the same migrations separately on every shard, retaining a migration history per database. Keep each transaction, uniqueness requirement and connected graph within one shard; cross-shard operations need application coordination. This driver does not provide routing, rebalancing, distributed joins or distributed transactions. Bucket partitioning does not by itself assign data to independent servers; [HA replication](https://docs.arcadedb.com/arcadedb/concepts/high-availability) maintains copies for availability.

The Docker suite tests a single server, not cluster failover or sharding.

## Commit hooks

`npm ci` installs the repository's native Git hook through `prepare` (or run `npm run hooks:install`). Each commit runs **ESLint and Prettier's check** over the working tree and stops on failure. It does not rewrite or stage files.

```sh
npm run lint
npm run format       # apply formatting before committing
npm run format:check
```

## Tests

```sh
npm test                  # build and unit tests
npm run test:types        # compile consumer code against exported declarations
npm run test:migrations   # migration suite against a running Docker database
npm run test:queries      # query cookbook against a running Docker database
npm run test:docker       # build and all tests in Docker against ArcadeDB
```

`test:docker` starts a dedicated Compose project, waits for database readiness, runs the tests, and removes its containers and volumes even when tests fail. The database uses disposable test credentials and binds to localhost only. It requires Docker Desktop or a running Docker daemon.

To iterate against a running Docker database:

```sh
docker compose up -d --wait arcadedb
npm run test:integration
npm run test:migrations
docker compose down --volumes
```

Integration tests use `ARCADEDB_URL`, `ARCADEDB_DATABASE`, `ARCADEDB_USERNAME`, and `ARCADEDB_PASSWORD`, defaulting to the Compose configuration. They clear their `test_*` document types: use a dedicated test database.

Development follows failing tests → implementation → passing Docker tests, with incremental commits.

## References

- [ArcadeDB HTTP API](https://docs.arcadedb.com/arcadedb/reference/http-api/http)
- [ArcadeDB SQL SELECT](https://docs.arcadedb.com/arcadedb/reference/sql/sql-select)
- [TypeORM](https://typeorm.io/)
