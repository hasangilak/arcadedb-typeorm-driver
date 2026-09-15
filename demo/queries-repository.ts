import {
  And,
  Equal,
  ILike,
  LessThan,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
  Not,
  In,
  Or,
  Raw,
} from 'typeorm';
import type { ArcadeDataSource } from '../src';
import { accountSchema } from './seeders/02-accounts';
import { catalogSchema } from './seeders/03-catalog';

const accounts = (db: ArcadeDataSource) => db.getRepository(accountSchema);
const products = (db: ArcadeDataSource) =>
  db.getRepository<{ id: string; name: string; price_cents: number }>(catalogSchema);
const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

export const repositoryQueries = {
  async findByEquality(db: ArcadeDataSource) {
    return ids(await accounts(db).findBy({ country: 'DE' }));
  },
  async findOneOptions(db: ArcadeDataSource) {
    return (await accounts(db).findOne({ where: { country: 'US' } }))?.id;
  },
  async findOneMissing(db: ArcadeDataSource) {
    return accounts(db).findOneBy({ id: 'missing' });
  },
  async findAndCount(db: ArcadeDataSource) {
    const [rows, total] = await accounts(db).findAndCount({
      where: { active: true },
      order: { id: 'ASC' },
      skip: 1,
      take: 1,
    });
    return { ids: ids(rows), total };
  },
  async findAndCountBy(db: ArcadeDataSource) {
    const [rows, total] = await accounts(db).findAndCountBy({ active: true });
    return { ids: ids(rows), total };
  },
  async exists(db: ArcadeDataSource) {
    return accounts(db).exists({ where: { country: 'DE' } });
  },
  async existsByMissing(db: ArcadeDataSource) {
    return accounts(db).existsBy({ id: 'missing' });
  },
  async countFiltered(db: ArcadeDataSource) {
    return accounts(db).count({ where: { active: true } });
  },
  async sumPrices(db: ArcadeDataSource) {
    return products(db).sum('price_cents');
  },
  async averagePrices(db: ArcadeDataSource) {
    return products(db).average('price_cents');
  },
  async minimumPrice(db: ArcadeDataSource) {
    return products(db).minimum('price_cents');
  },
  async maximumPrice(db: ArcadeDataSource) {
    return products(db).maximum('price_cents');
  },
  async notEqual(db: ArcadeDataSource) {
    return ids(await accounts(db).findBy({ id: Not('ada') }));
  },
  async lessThan(db: ArcadeDataSource) {
    return ids(await products(db).findBy({ price_cents: LessThan(8000) }));
  },
  async lessThanOrEqual(db: ArcadeDataSource) {
    return ids(await products(db).findBy({ price_cents: LessThanOrEqual(8000) }));
  },
  async moreThan(db: ArcadeDataSource) {
    return ids(await products(db).findBy({ price_cents: MoreThan(8000) }));
  },
  async moreThanOrEqual(db: ArcadeDataSource) {
    return ids(await products(db).findBy({ price_cents: MoreThanOrEqual(8000) }));
  },
  async equalOperator(db: ArcadeDataSource) {
    return ids(await products(db).findBy({ price_cents: Equal(2500) }));
  },
  async caseInsensitiveLike(db: ArcadeDataSource) {
    return ids(await products(db).findBy({ name: ILike('database%') }));
  },
  async notIn(db: ArcadeDataSource) {
    return ids(await products(db).findBy({ id: Not(In(['book', 'course'])) }));
  },
  async emptyIn(db: ArcadeDataSource) {
    return ids(await products(db).findBy({ id: In([]) }));
  },
  async orFindOptions(db: ArcadeDataSource) {
    return ids(await accounts(db).find({ where: [{ country: 'DE' }, { active: false }] }));
  },
  async andOperator(db: ArcadeDataSource) {
    return ids(await products(db).findBy({ price_cents: And(MoreThan(2500), LessThan(12000)) }));
  },
  async orOperator(db: ArcadeDataSource) {
    return ids(await products(db).findBy({ price_cents: Or(Equal(2500), Equal(12000)) }));
  },
  async rawFindPredicate(db: ArcadeDataSource) {
    // Only the expression is SQL. User values belong in the parameter map.
    return ids(
      await products(db).findBy({
        price_cents: Raw((alias) => `${alias} >= :minimum`, { minimum: 8000 }),
      }),
    );
  },
};
