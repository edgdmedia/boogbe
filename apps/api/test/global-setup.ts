import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import { resolve } from 'node:path';

export default function setup() {
  config({ path: resolve(__dirname, '../../../.env') });
  const migrate = process.env.TEST_DATABASE_MIGRATE_URL;
  if (!migrate || !process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL and TEST_DATABASE_MIGRATE_URL must be set');
  }
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate --schema ../../prisma/schema.prisma', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: migrate },
    stdio: 'inherit',
  });
}
