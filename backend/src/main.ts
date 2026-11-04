import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { UPLOAD_DIR } from './catalog/uploads.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // rawBody is required later to verify payment-webhook signatures.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const isProd = process.env.NODE_ENV === 'production';

  app.set('trust proxy', 1);
  // Uploaded product images are public and may be embedded by the (separate-origin) storefront.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.useStaticAssets(UPLOAD_DIR, { prefix: '/uploads', index: false, maxAge: '7d' });
  app.use(cookieParser());
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('Vella Market API')
      .setDescription('REST API for the Vella Market international e-commerce platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

bootstrap();
