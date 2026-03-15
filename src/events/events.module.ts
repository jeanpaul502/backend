import { Module, Global } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Global()
@Module({
  imports: [AuthModule, UsersModule],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
