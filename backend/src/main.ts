import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { raw } from 'express';
import { WMS_NATIVE_BODY_LIMIT } from './modules/integration/wms/wms-native.contract';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
    bodyParser: false,
    rawBody: true,
  });

  const configService = app.get(ConfigService);
  app.enableShutdownHooks();
  const prefix = configService.get('API_PREFIX') || '/api/v1';
  const corsOriginRaw = configService.get<string>('CORS_ORIGIN') || '*';
  const corsOrigins =
    corsOriginRaw === '*'
      ? true
      : corsOriginRaw
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean);

  // Register parsers once with Nest's rawBody support so webhook HMAC validation
  // uses the original Shopify payload instead of a re-serialized JSON string.
  // WMS imports and attachments keep their original multipart boundary/bytes.
  // This parser is scoped to the authenticated native proxy; all other routes
  // retain their existing body parsers and limits.
  app.use(prefix + '/wms/native/proxy', raw({ type: 'multipart/form-data', limit: WMS_NATIVE_BODY_LIMIT }));
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '50mb' });

  // 全域驗證管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // CORS 設定
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization, X-DOA-Actor, X-WMS-Session, X-WMS-Entity, X-Repair-Report-Token, If-None-Match',
    exposedHeaders: 'Content-Disposition, X-Request-ID, ETag',
  });

  // Some hosting/CDN setups may send Reporting API (Report-To / NEL) beacons to
  // endpoints like `/report/*` or other custom paths. These are not part of our
  // public API (which is under `/api/v1/*`), but missing handlers can cause noisy
  // 404s in the browser console.
  // Swallow them with 204 to keep UX clean.
  app.use('/report', (req, res) => {
    res.status(204).end();
  });
  app.use('/import/erp', (req, res) => {
    res.status(204).end();
  });

  // Force restart trigger
  console.log('Server restarting...');

  // API 前綴
  app.setGlobalPrefix(prefix);

  // Swagger 文件設定（Production 也啟用）
  const config = new DocumentBuilder()
    .setTitle('Accounting API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  // 啟動服務
  const port = configService.get('PORT') || 3000;

  await app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`📘 Swagger available at /api-docs`);
    console.log(`🌍 Listening on 0.0.0.0:${port}`);
  });
}

bootstrap();
