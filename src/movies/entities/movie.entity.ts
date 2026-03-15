import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('movies')
export class Movie {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column()
  poster: string;

  @Column()
  coverImage: string;

  @Column()
  titleLogo: string;

  @Column('text')
  description: string;

  @Column()
  ageRating: string;

  @Column('float')
  score: number;

  @Column({ type: 'int', nullable: true })
  voteCount: number;

  @Column()
  section: string;

  @Column('simple-array')
  genres: string[];

  @Column()
  releaseDate: string;

  @Column({ default: false })
  isTop10: boolean;

  @Column({ default: false })
  isHero: boolean;

  @Column({
    type: 'enum',
    enum: ['active', 'inactive', 'scheduled'],
    default: 'active',
  })
  status: 'active' | 'inactive' | 'scheduled';

  @Column({ nullable: true })
  scheduledDate: string;

  @Column({ nullable: true })
  badge: string;

  @Column({ nullable: true })
  videoUrl: string;

  @Column({ nullable: true })
  director: string;

  @Column('simple-json', { nullable: true })
  cast: { name: string; image: string }[];

  @Column({ nullable: true })
  duration: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
