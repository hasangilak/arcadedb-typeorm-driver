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

  await db.transaction(async manager => {
    await manager.update(Person, { id: person.id }, { age: 37 });
  });
} finally {
  await db.destroy();
}
```

Decorator-based entities work too; enable `experimentalDecorators` and `emitDecoratorMetadata` in your application. Use `ArcadeDataSource` wherever you would otherwise construct a `DataSource`, including a framework's data source factory. This is a real TypeORM `DataSource` subclass.

## Queries and transactions

```ts
const rows = await db.getRepository(Person)
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

await db.transaction('REPEATABLE READ', async manager => {
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
- String/text/varchar/UUID, integer, float/double, boolean, date/datetime/timestamp, JSON maps, arrays, simple JSON/arrays, and column transformers.
- Document types, properties, defaults, nullability, primary/unique indexes, and ordinary indexes through additive synchronization.
- Native ArcadeDB SQL through `query()` for document and graph operations; TypeORM query errors retain the HTTP status and server exception in `driverError`.

`synchronize` adds missing types, properties and indexes. It never drops existing data or alters existing properties. Type changes require explicit SQL. `driver.createSchemaBuilder().log()` previews pending creation SQL; reverse SQL is not generated. Use reviewed native SQL for production schema changes.

Date/time values use UTC. The driver interprets ArcadeDB datetime strings without an offset as UTC; run the server in UTC when using automatic timestamps or native date expressions. Docker tests run the client in Europe/Berlin to exercise this conversion.

**Not supported:** ORM relations/joins, aliased ORM subqueries, graph entity mapping, auto-increment keys, SQL schemas, migration execution/generation, query caching, nested transactions/savepoints, streaming, upsert/RETURNING, check/exclusion constraints, specialized indexes, and general QueryRunner schema mutation methods. Use explicit native SQL where applicable. Schema synchronization does not reconcile changes to existing defaults, nullability or indexes.

TypeORM has no public external driver registry. `ArcadeDataSource` bootstraps its constructor with an inert driver dependency, then installs `ArcadeDriver` before connecting. No global factory is patched and no PostgreSQL connection is made. The TypeORM peer version is pinned because this relies on its internal interfaces.

## Tests

```sh
npm test                  # build and unit tests
npm run test:types        # compile consumer code against exported declarations
npm run test:docker       # build and all tests in Docker against ArcadeDB
```

`test:docker` starts a dedicated Compose project, waits for database readiness, runs the tests, and removes its containers and volumes even when tests fail. The database uses disposable test credentials and binds to localhost only. It requires Docker Desktop or a running Docker daemon.

To iterate against a running Docker database:

```sh
docker compose up -d --wait arcadedb
npm run test:integration
docker compose down --volumes
```

Integration tests use `ARCADEDB_URL`, `ARCADEDB_DATABASE`, `ARCADEDB_USERNAME`, and `ARCADEDB_PASSWORD`, defaulting to the Compose configuration. They clear their `test_*` document types: use a dedicated test database.

Development follows failing tests → implementation → passing Docker tests, with incremental commits.

## References

- [ArcadeDB HTTP API](https://docs.arcadedb.com/arcadedb/reference/http-api/http)
- [ArcadeDB SQL SELECT](https://docs.arcadedb.com/arcadedb/reference/sql/sql-select)
- [TypeORM](https://typeorm.io/)
