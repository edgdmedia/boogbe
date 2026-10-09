import type { NestExpressApplication } from '@nestjs/platform-express';
import supertest from 'supertest';
import { buildApp } from '../../src/build-app';

export interface TestApp {
  app: NestExpressApplication;
  http: ReturnType<typeof supertest>;
  agent: () => ReturnType<typeof supertest.agent>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.BETTER_AUTH_URL ??= 'http://localhost:5173';
  process.env.APP_ORIGIN ??= 'http://localhost:5173';
  process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret-1234';
  const app = await buildApp();
  await app.init();
  const server = app.getHttpServer();
  return {
    app,
    http: supertest(server),
    agent: () => supertest.agent(server).set('Origin', process.env.APP_ORIGIN!),
    close: () => app.close(),
  };
}
