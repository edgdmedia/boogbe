import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadEnv } from './env';
import { requestId } from './common/http/request-id.middleware';

export async function buildApp(): Promise<NestExpressApplication> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: env.NODE_ENV === 'test' ? ['error'] : undefined,
  });
  const http = app.getHttpAdapter().getInstance() as express.Express;
  http.set('trust proxy', 1);
  http.use(requestId);
  http.use(helmet());
  http.use(cors({ origin: [env.APP_ORIGIN], credentials: true }));
  // Task 5 mounts Better Auth here, BEFORE the JSON body parser.
  http.use(express.json({ limit: '1mb' }));
  app.setGlobalPrefix('v1');
  return app;
}
