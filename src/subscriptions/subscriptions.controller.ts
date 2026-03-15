import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('subscriptions')
@UseGuards(AuthGuard('jwt'))
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  findAll() {
    return this.subscriptionsService.findAll();
  }

  @Post('assign')
  assign(
    @Body() body: { userId: string; type: string; durationMonths?: number },
  ) {
    return this.subscriptionsService.assignSubscription(
      body.userId,
      body.type,
      body.durationMonths,
    );
  }
}
