import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module';
import { loadEnv } from './env';
import { requestId } from './common/http/request-id.middleware';
import { AUTH } from './common/auth/auth.tokens';
import type { Auth } from './common/auth/auth';

export async function buildApp(): Promise<NestExpressApplication> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: env.NODE_ENV === 'test' ? ['error'] : undefined,
  });
  const http = app.getHttpAdapter().getInstance() as express.Express;
  http.set('trust proxy', 1);
  http.use(requestId);
  // nginx (with the Cloudflare real-IP module) sets a single trusted X-Forwarded-For;
  // express must trust it so throttling and the auth rate limiter key off the client IP.
  http.set('trust proxy', 'loopback');
  http.use(helmet());
  http.use(cors({ origin: [env.APP_ORIGIN], credentials: true }));
  // Better Auth reads its own body, so it must be mounted before the JSON parser.
  const auth = app.get<Auth>(AUTH);
  http.all('/v1/auth/*', toNodeHandler(auth));
  http.use(express.json({ limit: '1mb' }));
  app.setGlobalPrefix('v1');
  return app;
}
