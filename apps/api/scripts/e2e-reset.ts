/** Resets the local dev database for Playwright and seeds the E2E platform admin. Never run against shared DBs. */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createAuth } from '../src/common/auth/auth';
import { MemoryMailer } from '../src/common/mail/mailer';
import { loadDotEnv, loadEnv } from '../src/env';

async function main() {
  loadDotEnv(resolve(__dirname, '../../../.env'));
  const migrateUrl = process.env.DATABASE_MIGRATE_URL;
  if (!migrateUrl || !/localhost|127\.0\.0\.1/.test(migrateUrl)) {
    throw new Error('e2e-reset only runs against a local database (DATABASE_MIGRATE_URL must be localhost)');
  }
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate --schema ../../prisma/schema.prisma', {
    cwd: resolve(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: migrateUrl },
  });
  const env = loadEnv({ ...process.env, PLATFORM_ADMIN_EMAILS: 'platform@e2e.boogbe' });
  const prisma = new PrismaClient();
  const auth = createAuth({ prisma, mailer: new MemoryMailer(), env });
  const r = await auth.api.signUpEmail({
    body: { email: 'platform@e2e.boogbe', name: 'Platform', password: 'e2e-platform-password' },
  });
  await prisma.user.update({ where: { id: r.user.id }, data: { role: 'admin', emailVerified: true } });
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
