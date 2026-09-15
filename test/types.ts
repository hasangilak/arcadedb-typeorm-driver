import { Column, DataSource, Entity, EntitySchema, PrimaryGeneratedColumn } from 'typeorm';
import { ArcadeDataSource, type ArcadeDataSourceOptions } from '../dist';

@Entity()
class DecoratedPerson {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;
}

const schema = new EntitySchema<DecoratedPerson>({
  name: 'Person',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    name: { type: String },
  },
});

const options: ArcadeDataSourceOptions = {
  type: 'arcadedb',
  database: 'app',
  username: 'root',
  password: 'example',
  entities: [DecoratedPerson, schema],
};
const db: DataSource = new ArcadeDataSource(options);
const people: Promise<DecoratedPerson[]> = db.getRepository(DecoratedPerson).find();
void people;

void db.getRepository(schema).upsert({ id: 'person', name: 'Ada' }, ['id']);
void db.createQueryBuilder().update(schema).set({ name: 'Ada' }).returning(['id', 'name']);
const switchedPeople: Promise<DecoratedPerson[]> = db
  .createQueryBuilder(schema, 'p')
  .update()
  .select('p')
  .getMany();
void switchedPeople;
