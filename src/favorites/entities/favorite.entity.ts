import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('favorites')
@Index(['userId', 'movieId'], { unique: true })
export class Favorite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 36 })
  userId: string;

  @Column('varchar', { length: 36 })
  movieId: string;

  @CreateDateColumn()
  createdAt: Date;
}

