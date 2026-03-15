import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type RequestType = 'movie' | 'series' | 'tv_channel';
export type RequestStatus = 'pending' | 'approved' | 'rejected';
export type NotificationMethod = 'whatsapp' | 'email' | 'telegram';

@Entity('requests')
export class MediaRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: ['movie', 'series', 'tv_channel'],
  })
  type: RequestType;

  @Column()
  title: string;

  @Column({ nullable: true })
  tmdbId: number;

  @Column({ nullable: true })
  poster: string;

  @Column({ type: 'text', nullable: true })
  overview: string;

  @Column({ nullable: true })
  releaseDate: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  })
  status: RequestStatus;

  @Column({
    type: 'enum',
    enum: ['whatsapp', 'email', 'telegram'],
    nullable: true,
  })
  notificationMethod: NotificationMethod;

  @Column({ nullable: true })
  contactInfo: string;

  @Column({ nullable: true })
  userId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
