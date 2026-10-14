import { Client } from 'pg';

export async function migratorClient(): Promise<Client> {
  const c = new Client({ connectionString: process.env.TEST_DATABASE_MIGRATE_URL });
  await c.connect();
  return c;
}

/** Empties every table except Prisma's bookkeeping. Runs as the migrator (table owner) so RLS doesn't hide rows. */
export async function truncateAll(): Promise<void> {
  const c = await migratorClient();
  try {
    const { rows } = await c.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length) {
      await c.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await c.end();
  }
}
