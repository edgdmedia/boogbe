import { Client } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';

async function appClient() {
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  return c;
}

describe('row level security [NFR-01]', () => {
  let a: { id: string }, b: { id: string };
  beforeEach(async () => {
    await truncateAll();
    a = await seedOrg('A');
    b = await seedOrg('B');
    const m = await migratorClient();
    await m.query(
      `insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'A','A','A',now()),($2,'B','B','B',now())`,
      [a.id, b.id],
    );
    await m.end();
  });

  it('no org set → zero rows', async () => {
    const c = await appClient();
    const { rows } = await c.query('select count(*)::int n from org_settings');
    await c.end();
    expect(rows[0]!.n).toBe(0);
  });

  it('org set → only that org', async () => {
    const c = await appClient();
    await c.query('begin');
    await c.query(`select set_config('app.org_id', $1, true)`, [a.id]);
    const { rows } = await c.query('select org_id from org_settings');
    await c.query('commit');
    await c.end();
    expect(rows).toEqual([{ org_id: a.id }]);
  });

  it('rls returns zero rows after a previous transaction set org (pooled connection)', async () => {
    const c = await appClient();
    await c.query('begin');
    await c.query(`select set_config('app.org_id', $1, true)`, [a.id]);
    await c.query('commit');
    const { rows } = await c.query('select count(*)::int n from org_settings');
    await c.end();
    expect(rows[0]!.n).toBe(0);
  });

  it('cannot insert a row for another org', async () => {
    const c = await appClient();
    await c.query('begin');
    await c.query(`select set_config('app.org_id', $1, true)`, [a.id]);
    await expect(c.query(`insert into org_counter(org_id, name, value) values ($1, 'x', 0)`, [b.id])).rejects.toThrow(
      /row-level security/,
    );
    await c.query('rollback');
    await c.end();
  });

  it('app role cannot update or delete audit_log', async () => {
    const c = await appClient();
    await expect(c.query(`update audit_log set action='x'`)).rejects.toThrow(/permission denied/);
    await expect(c.query(`delete from audit_log`)).rejects.toThrow(/permission denied/);
    await c.end();
  });

  it('every table with org_id has RLS enabled, forced and a policy', async () => {
    const m = await migratorClient();
    const { rows } = await m.query(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity,
             exists(select 1 from pg_policies p where p.tablename = c.relname) as has_policy
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists(select 1 from information_schema.columns col where col.table_name = c.relname and col.column_name = 'org_id')
        and c.relname <> 'job_run'`);
    await m.end();
    const bad = rows.filter((r: { relrowsecurity: boolean; relforcerowsecurity: boolean; has_policy: boolean; relname: string }) =>
      !r.relrowsecurity || !r.relforcerowsecurity || !r.has_policy,
    ).map((r: { relname: string }) => r.relname);
    expect(rows.length).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
});
