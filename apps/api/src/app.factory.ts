import { INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import type { AppConfig } from './config';
import { APP_HEADER } from './auth/actor';

export const API_PREFIX = 'v1';

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const doc = new DocumentBuilder()
    .setTitle('Utsavora API')
    .setDescription(
      'Utsavora marketplace API. All responses are `{ data }` (lists add `meta`); errors are `{ error: { code, message, details } }`. ' +
        `Send the \`${APP_HEADER}\` header (customer | vendor | admin) on every request; it selects the session cookie and is required on writes.`,
    )
    .setVersion('1.0.0')
    .addCookieAuth('uts_customer', { type: 'apiKey', in: 'cookie', name: 'uts_customer' }, 'customer')
    .addCookieAuth('uts_vendor', { type: 'apiKey', in: 'cookie', name: 'uts_vendor' }, 'vendor')
    .addCookieAuth('uts_admin', { type: 'apiKey', in: 'cookie', name: 'uts_admin' }, 'admin')
    .addGlobalParameters({ name: APP_HEADER, in: 'header', required: false, schema: { type: 'string', enum: ['customer', 'vendor', 'admin'] } })
    .build();
  return SwaggerModule.createDocument(app, doc);
}

export async function createApp(config: AppConfig, opts: { logger?: false } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: opts.logger === false ? false : ['error', 'warn', 'log'],
    bufferLogs: false,
  });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '256kb' });
  app.use(helmet());
  app.use(cookieParser());
  const http = new Logger('Request');
  app.use((req: Request & { id?: string }, res: Response, next: NextFunction) => {
    req.id = (req.header('x-request-id') ?? '').slice(0, 64) || randomUUID();
    res.setHeader('x-request-id', req.id);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (opts.logger === false || req.path.endsWith('/health')) return;
      http.log(
        JSON.stringify({
          id: req.id,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Number((process.hrtime.bigint() - start) / 1_000_000n),
          app: req.header(APP_HEADER) ?? null,
        }),
      );
    });
    next();
  });
  if (config.corsOrigins.length) {
    app.enableCors({ origin: config.corsOrigins, credentials: true, allowedHeaders: ['content-type', APP_HEADER, 'x-request-id'] });
  }
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  if (config.nodeEnv !== 'production' || process.env.EXPOSE_API_DOCS === 'true') {
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, () => buildOpenApi(app), { jsonDocumentUrl: `${API_PREFIX}/openapi.json` });
  }
  return app;
}
