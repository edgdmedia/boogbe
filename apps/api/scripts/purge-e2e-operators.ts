/**
 * Removes the throwaway operators a production E2E run created (slug `e2e-<run>-…`, see e2e/fixtures.ts).
 * Usage (on the server, in /home/boogbe/app):
 *   pnpm --filter @boogbe/api exec tsx scripts/purge-e2e-operators.ts e2e-<run>-         # dry run: lists what would go
 *   pnpm --filter @boogbe/api exec tsx scripts/purge-e2e-operators.ts e2e-<run>- --yes   # deletes
 * Runs as boogbe_migrator (payments and audit rows are append-only for the app role). Deleting the organization
 * cascades to every tenant table. Users who were only members of those operators are deleted too, never a platform
 * admin. Refuses any prefix that does not start with `e2e-`.
 */
import { Client } from 'pg';
import { resolve } from 'node:path';
import { loadDotEnv, loadEnv } from '../src/env';

export interface PurgeResult {
  orgs: { id: string; slug: string; name: string }[];
  users: { id: string; email: string }[];
  deleted: boolean;
}

export async function purgeE2eOperators(
  db: Client,
  prefix: string,
  opts: { apply: boolean; protectEmails: string[] },
): Promise<PurgeResult> {
  if (!/^e2e-[a-z0-9]+-[a-z0-9-]*$/.test(prefix)) throw new Error(`refusing prefix "${prefix}": must start with e2e-<run>-`);
  await db.query('BEGIN');
  try {
    const orgs = (
      await db.query<{ id: string; slug: string; name: string }>(
        `SELECT id, slug, name FROM organization WHERE slug LIKE $1 ORDER BY slug FOR UPDATE`,
        [`${prefix.replace(/[\\%_]/g, '\\$&')}%`],
      )
    ).rows;
    const ids = orgs.map((o) => o.id);
    // Members of these operators who belong nowhere else, and are not platform admins.
    const users = (
      await db.query<{ id: string; email: string }>(
        `SELECT u.id, u.email FROM "user" u
         WHERE u.id IN (SELECT "userId" FROM member WHERE "organizationId" = ANY($1))
           AND NOT EXISTS (SELECT 1 FROM member m WHERE m."userId" = u.id AND NOT (m."organizationId" = ANY($1)))
           AND coalesce(u.role, '') <> 'admin'
           AND lower(u.email) <> ALL($2)
         ORDER BY u.email`,
        [ids, opts.protectEmails.map((e) => e.toLowerCase())],
      )
    ).rows;
    if (opts.apply && ids.length) {
      await db.query(`DELETE FROM organization WHERE id = ANY($1)`, [ids]);
      if (users.length) await db.query(`DELETE FROM "user" WHERE id = ANY($1)`, [users.map((u) => u.id)]);
      await db.query('COMMIT');
    } else {
      await db.query('ROLLBACK');
    }
    return { orgs, users, deleted: opts.apply && ids.length > 0 };
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  const [prefix, flag] = process.argv.slice(2);
  if (!prefix) throw new Error('usage: purge-e2e-operators <e2e-run-prefix> [--yes]');
  loadDotEnv(resolve(__dirname, '../../../.env'));
  const env = loadEnv();
  const url = process.env.DATABASE_MIGRATE_URL;
  if (!url) throw new Error('DATABASE_MIGRATE_URL missing');
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const r = await purgeE2eOperators(db, prefix, { apply: flag === '--yes', protectEmails: env.PLATFORM_ADMIN_EMAILS });
    for (const o of r.orgs) console.log(`operator ${o.slug} (${o.name})`);
    for (const u of r.users) console.log(`user     ${u.email}`);
    console.log(r.deleted ? `deleted ${r.orgs.length} operator(s), ${r.users.length} user(s)` : `dry run: ${r.orgs.length} operator(s), ${r.users.length} user(s) would be deleted — add --yes`);
  } finally {
    await db.end();
  }
}

if (require.main === module) void main().catch((e) => { console.error(e.message); process.exit(1); });
