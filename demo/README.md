# Migration and seeding demo

Run these commands from the repository root against the disposable Docker database:

```sh
npm ci
docker compose up -d --wait arcadedb
npm run demo -- legacy   # first four migrations, then legacy fixture data
npm run demo -- up       # remaining migrations, transforming existing records
npm run demo -- seed     # final schema fixtures, inside a transaction
npm run demo -- seed     # repeat: same IDs and counts
npm run demo -- status   # { pending: false }
npm run demo -- down     # undo the most recent migration
```

The demo uses `driver_demo` by default. Set `ARCADEDB_DATABASE`, `ARCADEDB_URL`, `ARCADEDB_USERNAME` and `ARCADEDB_PASSWORD` to override it. Use a fresh database for `legacy`; final-schema seeders require all 24 migrations. `down` reverts one migration per invocation. Reversing table creation intentionally deletes its data. `legacy` creates fixtures only for the first four migrations and should not be run against the final schema.

## Migration sequence

Each file has explicit `up` and `down` methods. Order is determined by its timestamp.

| #   | Migration                | What it exercises                                             |
| --- | ------------------------ | ------------------------------------------------------------- |
| 1   | CreateAccounts           | Document table and assigned string primary key                |
| 2   | CreateProducts           | Required strings and integer money                            |
| 3   | CreateOrders             | References stored as IDs and a SQL default                    |
| 4   | CreateOrderItems         | Multi-column table without a primary key                      |
| 5   | AddContacts              | Bulk nullable column additions                                |
| 6   | AddDocumentFields        | JSON map and array defaults                                   |
| 7   | AddAuditDefaults         | Boolean/datetime defaults and existing-row backfill           |
| 8   | BackfillContacts         | Deterministic data migration                                  |
| 9   | RequireEmail             | Tighten nullability after backfill                            |
| 10  | UniqueEmails             | Named unique constraint                                       |
| 11  | OrderLookupIndexes       | Bulk ordinary index creation                                  |
| 12  | CompositeItemKey         | Add a composite primary key to existing data                  |
| 13  | UniqueProductNames       | Bulk unique-constraint API                                    |
| 14  | ExpandMoneyStorage       | Add a nullable LONG replacement column                        |
| 15  | BackfillMoneyStorage     | Copy money values, then require them                          |
| 16  | RenameCatalog            | Rename a type while preserving data and index identity        |
| 17  | MigrateDisplayNames      | Add/backfill/require/drop as a reversible column rename       |
| 18  | MaterializeOrderTotals   | Native grouped aggregate into another type                    |
| 19  | NativeQuantityValidation | ArcadeDB MIN/MAX property constraints                         |
| 20  | GraphProjection          | Native vertex and edge schema, indexes and cleanup            |
| 21  | ReplaceOrderIndexes      | Replace a single-column index with a composite index          |
| 22  | ReplaceCompositeKey      | Backfill a new key, then replace the existing primary key     |
| 23  | ArchiveAccountSnapshot   | Copy selected fields into an indexed snapshot                 |
| 24  | ContractMoneyStorage     | Validate and remove legacy money; reverse with overflow guard |

Money values are integer cents throughout: the conversion changes storage width, not units. Snapshot migrations capture data at migration time, not live views. Migration 19 demonstrates native validation; it does not emulate arbitrary SQL CHECK expressions.

## Five seeders

1. `01-legacy.ts`: two accounts, two products, one order and item before schema evolution; inserts only missing IDs.
2. `02-accounts.ts`: three final-schema accounts through TypeORM repositories.
3. `03-catalog.ts`: three products with JSON attributes and array tags.
4. `04-orders.ts`: two orders, two items and recomputed totals using assigned IDs.
5. `05-graph.ts`: customer/order vertices and order edges through native SQL.

Final seeders use stable IDs and values. Repeating them updates the fixture records; it does not duplicate them. Run a single seeder process at a time. They are intended for demo databases, since reseeding overwrites fixture values.

## What the tests prove

```sh
npm run test:docker       # isolated database, build, typecheck, lint, format, all tests, cleanup
npm run test:migrations   # faster iteration against an already running Docker server
```

The suite checks legacy data after conversion, persisted schema metadata, uniqueness and quantity violations, twice-run seed counts, migration history/no-op reruns, all 24 reversals, and full replay after reversal. It also checks data transaction modes, fake execution/revert, DDL rejection inside transactions, and partial schema failure without a history entry. Unsupported QueryRunner APIs are tested for explicit rejection without mutation.

Schema operations default to no transaction because ArcadeDB DDL cannot roll back. Use a deployment lock to serialize migrations per database. Add nullable properties, backfill and validate before requiring them. Dropping an indexed column requires explicitly dropping its dependent indexes first. A failed schema migration may need manual repair before retrying.

Foreign keys, general checks/exclusions, views, SQL schemas, in-place property type/name changes, generated numeric keys and specialized index APIs are unsupported. This suite verifies the driver's supported subset and its rejection boundaries; it does not claim PostgreSQL-equivalent schema support. Automatic schema diffing is additive only and does not generate a complete reversible migration.
