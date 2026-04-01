import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('announcements')
export class Announcement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: true })
  isUpdate: boolean;

  @Column({ nullable: true })
  version: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'json' })
  features: string[];

  @Column({ default: false })
  isActive: boolean;

  @Column({ type: 'bigint', default: 0 })
  recallCount: number;

  @Column({ default: false })
  hasAndroidApp: boolean;

  @Column({ nullable: true })
  androidAppUrl: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
