import { existsSync } from 'node:fs';
import { z } from 'zod';

// `.env.example` ships keys with empty values; treat `KEY=` as not set.
const blankIsUnset = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === '' ? undefined : v), t);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3060),
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    APP_ORIGIN: z.string().url(),
    COOKIE_DOMAIN: z
      .string()
      .optional()
      .transform((v) => v || undefined),
    PLATFORM_ADMIN_EMAILS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    RESEND_API_KEY: z
      .string()
      .optional()
      .transform((v) => v || undefined),
    MAIL_FROM: z.string().default('Boogbe <bookings@mail.boogbe.com>'),
    SENTRY_DSN: z
      .string()
      .optional()
      .transform((v) => v || undefined),
    BOOGBE_ROLE: z.enum(['api', 'worker']).default('api'),
    R2_ENDPOINT: blankIsUnset(z.string().url().optional()),
    R2_BUCKET: blankIsUnset(z.string().optional()),
    R2_ACCESS_KEY_ID: blankIsUnset(z.string().optional()),
    R2_SECRET_ACCESS_KEY: blankIsUnset(z.string().optional()),
  })
  .superRefine((env, ctx) => {
    // A copied .env.example would sign production sessions with a public secret.
    // Without R2, production would silently keep uploads in process memory.
    if (
      env.NODE_ENV === 'production' &&
      !(env.R2_ENDPOINT && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY)
    ) {
      ctx.addIssue({ code: 'custom', path: ['R2_ENDPOINT'], message: 'R2_* required in production' });
    }
    if (env.NODE_ENV === 'production' && /change-me/i.test(env.BETTER_AUTH_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['BETTER_AUTH_SECRET'], message: 'placeholder secret' });
    }
  });
export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = schema.safeParse(source);
  if (!r.success) {
    const keys = r.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment: ${keys}`);
  }
  return r.data;
}

/**
 * Loads the repo-root .env into process.env (PM2 and `nest start` don't). Keys already set win,
 * so PM2's env_production (NODE_ENV, PORT, BOOGBE_ROLE) is never overridden. Missing file = no-op.
 */
export function loadDotEnv(path: string): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
