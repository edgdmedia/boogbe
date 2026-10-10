import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = resolve(__dirname, '../../../prisma/migrations');

/** Points a migrator URL at another database on the same server. */
function withDb(url: string, db: string) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

describe('migrations', () => {
  // `prisma migrate dev` replays every migration into an empty shadow database, where
  // Prisma's own `_prisma_migrations` table does not exist.
  it('apply in order to an empty database without Prisma bookkeeping (shadow DB)', async () => {
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_MIGRATE_URL });
    await admin.connect();
    const db = `boogbe_shadow_check_${process.pid}`;
    await admin.query(`DROP DATABASE IF EXISTS ${db}`);
    await admin.query(`CREATE DATABASE ${db}`);
    const shadow = new Client({ connectionString: withDb(process.env.TEST_DATABASE_MIGRATE_URL!, db) });
    await shadow.connect();
    const failures: string[] = [];
    try {
      const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
      for (const dir of dirs) {
        try {
          await shadow.query(readFileSync(resolve(MIGRATIONS, dir, 'migration.sql'), 'utf8'));
        } catch (e) {
          failures.push(`${dir}: ${(e as Error).message}`);
          break;
        }
      }
    } finally {
      await shadow.end();
      await admin.query(`DROP DATABASE IF EXISTS ${db}`);
      await admin.end();
    }
    expect(failures).toEqual([]);
  });

  // Hand-written SQL that schema.prisma doesn't describe would be dropped by the next generated migration.
  it('schema.prisma matches the migrations (no drift)', async () => {
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_MIGRATE_URL });
    await admin.connect();
    const db = `boogbe_drift_check_${process.pid}`;
    await admin.query(`DROP DATABASE IF EXISTS ${db}`);
    await admin.query(`CREATE DATABASE ${db}`);
    let diff = '';
    try {
      diff = execFileSync(
        'npx',
        [
          'prisma',
          'migrate',
          'diff',
          '--from-migrations',
          resolve(MIGRATIONS),
          '--to-schema-datamodel',
          resolve(MIGRATIONS, '../schema.prisma'),
          '--shadow-database-url',
          withDb(process.env.TEST_DATABASE_MIGRATE_URL!, db),
          '--script',
        ],
        { cwd: resolve(__dirname, '..'), encoding: 'utf8' },
      );
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin.end();
    }
    expect(diff.replace(/^--.*$/gm, '').trim()).toBe('');
  });
});
