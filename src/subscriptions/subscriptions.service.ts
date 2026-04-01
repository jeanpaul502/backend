import { Injectable, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from './entities/subscription.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class SubscriptionsService implements OnModuleInit {
  constructor(
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    private usersService: UsersService,
  ) {}

  async onModuleInit() {
    await this.seed();
  }

  async seed() {
    const count = await this.subscriptionRepository.count();
    if (count === 0) {
      const plans = [
        {
          type: 'free',
          name: 'Accès Standard',
          price: 0,
          durationMonths: null,
          description: 'Accès gratuit',
        },
      ];
      await this.subscriptionRepository.save(plans);
      console.log('Subscriptions seeded');
    }
  }

  findAll() {
    return this.subscriptionRepository.find();
  }

  async assignSubscription(
    userId: string,
    type: string,
    durationMonths?: number,
  ) {
    const sub = await this.subscriptionRepository.findOneBy({ type });
    if (!sub) throw new NotFoundException('Subscription type not found');

    let endDate: Date | null = null;

    // If specific duration is passed, use it, otherwise use plan default
    const duration = durationMonths || sub.durationMonths;

    if (duration && sub.type !== 'vip' && sub.type !== 'free') {
      // Logic: VIP is unlimited (null endDate) unless specified?
      // User said "VIP, c'est accès illimité". So endDate should be null or very far.
      // User said "Premium ... il y a le nombre de mois".
      // Free is unlimited time but limited access.

      const date = new Date();
      date.setMonth(date.getMonth() + duration);
      endDate = date;
    } else if (sub.type === 'vip') {
      // VIP unlimited time? User said "c'est accès illimité".
      // But usually VIP has a duration (yearly).
      // Let's assume null means forever for now.
      endDate = null;
    }

    await this.usersService.update(userId, {
      subscriptionType: sub.type,
      subscriptionEndDate: endDate,
    });

    const updated = await this.usersService.findOne(userId);
    return updated;
  }
}
