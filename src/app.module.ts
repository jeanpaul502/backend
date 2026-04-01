import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { MailModule } from './mail/mail.module';
import { MoviesModule } from './movies/movies.module';
import { ProxyModule } from './proxy/proxy.module';
import { ChannelsModule } from './channels/channels.module';
import { databaseConfig } from './config/database.config';
import { UserActivityInterceptor } from './users/user-activity.interceptor';
import { RequestsModule } from './requests/requests.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { FavoritesModule } from './favorites/favorites.module';
import { AnnouncementsModule } from './announcements/announcements.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: databaseConfig,
      inject: [ConfigService],
    }),
    UsersModule,
    AuthModule,
    SubscriptionsModule,
    MailModule,
    MoviesModule,
    ProxyModule,
    ChannelsModule,
    RequestsModule,
    FavoritesModule,
    AnnouncementsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: UserActivityInterceptor,
    },
  ],
})
export class AppModule {}
