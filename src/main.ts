import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { join } from 'path';

import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust proxies (required to get real client IP behind Nginx/Cloudflare/etc.)
  app.getHttpAdapter().getInstance().set('trust proxy', true);

  // Serve static files from the public directory (for APK downloads, etc.)
  app.useStaticAssets(join(__dirname, '..', 'public'), {
    prefix: '/',
  });

  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: false,
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({
    origin: true, // Reflète l'origine de la requête (indispensable pour credentials: true)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    exposedHeaders: [
      'Authorization',
      'Content-Disposition',
      'Content-Length',
      'X-Estimated-Bytes',
    ],
  });

  // Important pour les plateformes de déploiement (Koyeb, Render, Railway, Dokploy, etc.)
  // On privilégie le port 3000 par défaut car c'est le standard pour beaucoup de plateformes.
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on port: ${port}`);
}
bootstrap();
