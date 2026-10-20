import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module';
import { loadEnv } from './env';
import { jsonOnly } from './common/http/json-only.middleware';
import { requestId } from './common/http/request-id.middleware';
import { AUTH } from './common/auth/auth.tokens';
import type { Auth } from './common/auth/auth';
import { publicCors } from './modules/public/public-cors';
import { PublicOrgService } from './modules/public/public-org.service';
import { MEDIA_STORAGE, STORAGE, type Storage } from './common/files/storage';

/** `overrides` swap providers (tests only), e.g. a fake iCal fetcher. */
export async function buildApp(
  opts: { overrides?: Array<[string | symbol, unknown]> } = {},
): Promise<NestExpressApplication> {
  const env = loadEnv();
  const options = { bodyParser: false, logger: env.NODE_ENV === 'test' ? (['error'] as const) : undefined };
  let app: NestExpressApplication;
  if (opts.overrides?.length) {
    let builder = Test.createTestingModule({ imports: [AppModule] });
    for (const [token, value] of opts.overrides) builder = builder.overrideProvider(token).useValue(value);
    app = (await builder.compile()).createNestApplication<NestExpressApplication>({
      ...options,
      logger: ['error'],
    });
  } else {
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      ...options,
      logger: options.logger && [...options.logger],
    });
  }
  const http = app.getHttpAdapter().getInstance() as express.Express;
  http.set('trust proxy', 1);
  http.use(requestId);
  // nginx (with the Cloudflare real-IP module) sets a single trusted X-Forwarded-For;
  // express must trust it so throttling and the auth rate limiter key off the client IP.
  http.set('trust proxy', 'loopback');
  http.use(helmet());
  // Public booking routes answer only their operator's own website origins, never with credentials (WB);
  // the app-wide CORS below then skips them.
  http.use('/v1/public', publicCors(app.get(PublicOrgService)));
  const appCors = cors({ origin: [env.APP_ORIGIN], credentials: true });
  http.use((req, res, next) => ((req as { publicRoute?: boolean }).publicRoute ? next() : appCors(req, res, next)));
  if (process.env.E2E === '1') {
    // E2E with in-memory storage: presign points the browser's PUT here, and GET serves the
    // media bucket's variants so the app's <img> previews resolve. Test process only, never deployed.
    const storage = app.get(STORAGE) as Storage;
    const media = app.get(MEDIA_STORAGE) as Storage;
    http.put('/v1/__test/blob/*', (req, res, next) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const key = decodeURIComponent(req.path.slice('/v1/__test/blob/'.length));
        storage
          .put(key, Buffer.concat(chunks), String(req.headers['content-type'] ?? 'application/octet-stream'))
          .then(() => res.status(200).end())
          .catch(next);
      });
    });
    http.get('/v1/__media/*', async (req, res, next) => {
      try {
        const buf = await media.get(decodeURIComponent(req.path.slice('/v1/__media/'.length)));
        if (!buf) return res.status(404).end();
        res.setHeader('content-type', 'image/webp');
        res.send(buf);
      } catch (e) {
        next(e);
      }
    });
  }
  // Better Auth reads its own body, so it must be mounted before the JSON parser.
  const auth = app.get<Auth>(AUTH);
  http.all('/v1/auth/*', toNodeHandler(auth));
  http.use(jsonOnly);
  http.use(express.json({ limit: '1mb' }));
  app.setGlobalPrefix('v1');
  return app;
}
