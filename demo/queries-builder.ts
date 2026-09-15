import { NotBrackets } from 'typeorm';
import type { ArcadeDataSource } from '../src';
import { accountSchema } from './seeders/02-accounts';
import { catalogSchema } from './seeders/03-catalog';
import { itemSchema, orderSchema } from './seeders/04-orders';

const accounts = (db: ArcadeDataSource) =>
  db.getRepository(accountSchema).createQueryBuilder('account');
const products = (db: ArcadeDataSource) =>
  db.getRepository(catalogSchema).createQueryBuilder('product');
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

export const builderQueries = {
  async objectWhere(db: ArcadeDataSource) {
    return ids(await accounts(db).where({ active: true }).orderBy('account.id').getMany());
  },
  async objectOrWhere(db: ArcadeDataSource) {
    return ids(
      await accounts(db)
        .where([{ country: 'DE' }, { active: false }])
        .orderBy('account.id')
        .getMany(),
    );
  },
  async notBrackets(db: ArcadeDataSource) {
    return ids(
      await accounts(db)
        .where(
          new NotBrackets((q) =>
            q.where('account.id = :a', { a: 'ada' }).orWhere('account.id = :b', { b: 'linus' }),
          ),
        )
        .getMany(),
    );
  },
  async whereInIds(db: ArcadeDataSource) {
    return ids(await products(db).whereInIds(['book', 'course']).orderBy('product.id').getMany());
  },
  async andWhereInIds(db: ArcadeDataSource) {
    return ids(
      await products(db)
        .where('product.price_cents > :min', { min: 2500 })
        .andWhereInIds(['book', 'course'])
        .getMany(),
    );
  },
  async orWhereInIds(db: ArcadeDataSource) {
    return ids(
      await products(db)
        .where('product.id = :id', { id: 'book' })
        .orWhereInIds(['support'])
        .orderBy('product.id')
        .getMany(),
    );
  },
  async setParameter(db: ArcadeDataSource) {
    return ids(await accounts(db).where('account.id = :id').setParameter('id', 'ada').getMany());
  },
  async setParameters(db: ArcadeDataSource) {
    return ids(
      await accounts(db)
        .where('account.id = :id AND account.country = :country')
        .setParameters({ id: 'grace', country: 'US' })
        .getMany(),
    );
  },
  async cloneBuilder(db: ArcadeDataSource) {
    const original = accounts(db)
      .where('account.active = :active', { active: true })
      .orderBy('account.id');
    const clone = original.clone().andWhere('account.id = :id', { id: 'ada' });
    return { original: ids(await original.getMany()), clone: ids(await clone.getMany()) };
  },
  async findOptionsBuilder(db: ArcadeDataSource) {
    return ids(
      await products(db)
        .setFindOptions({ where: { id: 'course' }, take: 1 })
        .getMany(),
    );
  },
  async rawAndEntities(db: ArcadeDataSource) {
    const { raw, entities } = await accounts(db)
      .select(['account.id', 'account.display_name'])
      .where('account.id = :id', { id: 'ada' })
      .getRawAndEntities();
    return { raw, ids: ids(entities) };
  },
  async getOne(db: ArcadeDataSource) {
    return (await accounts(db).where('account.id = :id', { id: 'ada' }).getOne())?.id;
  },
  async getOneOrFail(db: ArcadeDataSource) {
    return (await accounts(db).where('account.id = :id', { id: 'grace' }).getOneOrFail()).id;
  },
  async getCount(db: ArcadeDataSource) {
    return accounts(db).where({ active: true }).getCount();
  },
  async getExists(db: ArcadeDataSource) {
    return accounts(db).where({ id: 'ada' }).getExists();
  },
  async limitOffset(db: ArcadeDataSource) {
    return ids(await products(db).orderBy('product.price_cents').limit(1).offset(1).getMany());
  },
  async skipOnly(db: ArcadeDataSource) {
    return ids(await products(db).orderBy('product.id').skip(2).getMany());
  },
  async havingAggregate(db: ArcadeDataSource) {
    return db
      .getRepository(itemSchema)
      .createQueryBuilder('item')
      .select('item.order_id', 'order_id')
      .addSelect('sum(item.quantity * item.unit_price)', 'total')
      .groupBy('item.order_id')
      .having('sum(item.quantity * item.unit_price) > :min', { min: 5000 })
      .getRawMany();
  },
  async addGroupBy(db: ArcadeDataSource) {
    return db
      .getRepository(orderSchema)
      .createQueryBuilder('order')
      .select('order.account_id', 'account_id')
      .addSelect('order.status', 'status')
      .addSelect('count(*)', 'count')
      .groupBy('order.account_id')
      .addGroupBy('order.status')
      .orderBy('order.account_id')
      .getRawMany();
  },
  async computedProjection(db: ArcadeDataSource) {
    return products(db)
      .select('product.id', 'id')
      .addSelect('product.price_cents * 2', 'double_price')
      .where({ id: 'book' })
      .getRawMany();
  },
  async builderExecute(db: ArcadeDataSource) {
    return products(db).select('product.id', 'id').where({ id: 'book' }).execute();
  },
  async managerFind(db: ArcadeDataSource) {
    return ids(
      await db.manager.find(accountSchema, { where: { active: true }, order: { id: 'ASC' } }),
    );
  },
  async managerQuery(db: ArcadeDataSource) {
    return db.manager.query('SELECT id FROM demo_accounts WHERE id = :p0', ['ada']);
  },
  async repositoryQuery(db: ArcadeDataSource) {
    return db
      .getRepository(accountSchema)
      .query('SELECT id FROM demo_accounts WHERE id = :p0', ['grace']);
  },
  async repositorySql(db: ArcadeDataSource) {
    return db.getRepository(accountSchema).sql`SELECT id FROM demo_accounts WHERE id = ${'linus'}`;
  },
};
