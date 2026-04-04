import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';

@Module({
  imports: [
    MailerModule.forRootAsync({
      useFactory: async (config: ConfigService) => {
        const port = Number(config.get('MAIL_PORT') ?? 587);
        const secureEnv = String(config.get('MAIL_SECURE') ?? '').toLowerCase();
        const secure =
          secureEnv === 'true'
            ? true
            : secureEnv === 'false'
              ? false
              : port === 465;

        const requireTlsEnv = String(
          config.get('MAIL_REQUIRE_TLS') ?? '',
        ).toLowerCase();
        const requireTLS =
          requireTlsEnv === 'true'
            ? true
            : requireTlsEnv === 'false'
              ? false
              : port === 587;

        return {
          transport: {
            host: config.get('MAIL_HOST'),
            port,
            secure,
            requireTLS,
            auth: {
              user: config.get('MAIL_USERNAME'),
              pass: config.get('MAIL_PASSWORD'),
            },
            tls: {
              minVersion: 'TLSv1.2',
              rejectUnauthorized: false,
            },
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 30000,
          },
          defaults: {
            from: `"${config.get('MAIL_FROM_NAME') || 'Cineo'}" <${config.get('MAIL_FROM_ADDRESS')}>`,
          },
          template: {
            dir: join(__dirname, 'templates'),
            adapter: new HandlebarsAdapter(),
            options: {
              strict: true,
            },
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
