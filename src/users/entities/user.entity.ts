import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  OneToMany,
  BeforeInsert,
} from 'typeorm';
import { Session } from './session.entity';
import { v4 as uuidv4 } from 'uuid';

@Entity()
export class User {
  @PrimaryColumn('varchar', { length: 36 }) // UUIDs are 36 chars long
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }

  @Column()
  email: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column()
  password?: string;

  @Column({ type: 'varchar', nullable: true })
  resetCode: string | null;

  @Column({ type: 'datetime', nullable: true })
  resetCodeExpires: Date | null;

  @Column({ default: 0 })
  resetCodeAttempts: number;

  @Column({ type: 'datetime', nullable: true })
  resetLockoutUntil: Date | null;

  @Column({ default: false })
  isVerified: boolean;

  @Column({ type: 'varchar', nullable: true })
  verificationCode: string | null;

  @Column({ type: 'datetime', nullable: true })
  verificationCodeExpires: Date | null;

  @Column({ default: 0 })
  verificationCodeAttempts: number;

  @Column({ type: 'datetime', nullable: true })
  verificationLockoutUntil: Date | null;

  @Column({ type: 'longtext', nullable: true })
  profilePicture: string | null;

  @Column({
    type: 'enum',
    enum: ['free', 'premium', 'vip'],
    default: 'free',
  })
  subscriptionType: string;

  @Column({
    type: 'enum',
    enum: ['user', 'admin'],
    default: 'user',
  })
  role: string;

  @Column({ type: 'datetime', nullable: true })
  subscriptionEndDate: Date | null;

  @Column({ default: true })
  emailNotifications: boolean;

  @Column({ nullable: true })
  whatsappPhone: string;

  @Column({ nullable: true })
  telegramChatId: string;

  @Column({ nullable: true })
  telegramUsername: string;

  @Column({
    type: 'enum',
    enum: ['active', 'blocked'],
    default: 'active',
  })
  accountStatus: string;

  @Column({ nullable: true })
  lastIp: string;

  @Column({ nullable: true })
  lastCountry: string;

  @Column({ nullable: true })
  lastCountryCode: string;

  @Column({ nullable: true })
  lastCity: string;

  @Column({ nullable: true })
  lastDevice: string;

  @Column({ type: 'datetime', nullable: true })
  lastActive: Date;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => Session, (session) => session.user)
  sessions: Session[];
}
