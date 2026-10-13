import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { config } from './config';

export async function createApp(opts: { logger?: boolean } = {}) {
  const c = config();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: opts.logger === false ? false : ['log', 'warn', 'error'],
    bodyParser: true,
  });
  app.set('trust proxy', 1);
  app.useBodyParser('json', { limit: '1mb' });
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      referrerPolicy: { policy: 'same-origin' },
    }),
  );
  app.use(cookieParser());
  app.use((req: Request & { traceId?: string }, res: Response, next: NextFunction) => {
    req.traceId = randomUUID();
    res.setHeader('X-Trace-Id', req.traceId);
    // Respons API memuat data pribadi: jangan pernah di-cache browser/proxy.
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableCors({ origin: c.WEB_ORIGIN, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  return app;
}
