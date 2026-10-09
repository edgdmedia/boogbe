import { describe, expect, it } from 'vitest';
import { Client } from 'pg';

describe('runtime role grants [NFR-01]', () => {
  it('boogbe_app cannot read or change Prisma migration history', async () => {
    const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await c.connect();
    try {
      const { rows } = await c.query(
        `SELECT bool_or(has_table_privilege('_prisma_migrations', p)) AS any
           FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p`,
      );
      expect(rows[0].any).toBe(false);
    } finally {
      await c.end();
    }
  });
});
