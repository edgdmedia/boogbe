import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { purgeE2eOperators } from '../scripts/purge-e2e-operators';

const count = async (m: Client, sql: string, args: unknown[] = []) => (await m.query(sql, args)).rows[0].n as number;

describe('purge-e2e-operators (production E2E clean-up)', () => {
  let t: TestApp;
  let m: Client;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  const operatorWithData = async (name: string) => {
    const org = await seedOrg(name);
    const c = await migratorClient();
    await c.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'T','T','T',now())`, [org.id]);
    await c.end();
    const { agent, userId, email } = await signInAs(t, 'admin', org.id);
    const b = await seedBooking(org.id, await seedUnit(org.id, await seedProperty(org.id)), await seedGuest(org.id), { checkIn: '2026-11-01', checkOut: '2026-11-03' });
    await agent.post(`/v1/bookings/${b}/payments`).send({ kind: 'payment', amountKobo: 1_000_000, method: 'cash', receivedOn: '2026-10-14' }).expect(201);
    return { org, user: { id: userId, email } };
  };

  it('deletes the run’s operators with all their data and their own users; leaves everything else', async () => {
    const e2e = await operatorWithData('e2e-abc123-tanu-pay');
    const real = await operatorWithData('Tanuhomes');
    m = await migratorClient();
    try {
      const dry = await purgeE2eOperators(m, 'e2e-abc123-', { apply: false, protectEmails: [] });
      expect(dry).toMatchObject({ deleted: false, orgs: [{ slug: 'e2e-abc123-tanu-pay' }], users: [{ email: e2e.user.email }] });
      expect(await count(m, `select count(*)::int n from organization where id=$1`, [e2e.org.id])).toBe(1); // dry run deleted nothing

      const r = await purgeE2eOperators(m, 'e2e-abc123-', { apply: true, protectEmails: [] });
      expect(r.deleted).toBe(true);
      for (const table of ['organization', 'booking', 'payment', 'audit_log', 'member']) {
        const col = table === 'organization' ? 'id' : table === 'member' ? '"organizationId"' : 'org_id';
        expect(await count(m, `select count(*)::int n from ${table} where ${col}=$1`, [e2e.org.id]), table).toBe(0);
        expect(await count(m, `select count(*)::int n from ${table} where ${col}=$1`, [real.org.id]), `${table} (real)`).toBeGreaterThan(0);
      }
      expect(await count(m, `select count(*)::int n from "user" where id=$1`, [e2e.user.id])).toBe(0);
      expect(await count(m, `select count(*)::int n from "user" where id=$1`, [real.user.id])).toBe(1);
    } finally {
      await m.end();
    }
  });

  it('keeps a user who also belongs to a real operator, and any platform admin', async () => {
    const e2e = await operatorWithData('e2e-run2-x');
    const real = await seedOrg('Real');
    m = await migratorClient();
    try {
      await m.query(`insert into member(id, "organizationId", "userId", role, "createdAt") values (gen_random_uuid()::text, $1, $2, 'frontdesk', now())`, [real.id, e2e.user.id]);
      const r = await purgeE2eOperators(m, 'e2e-run2-', { apply: true, protectEmails: [] });
      expect(r.users).toEqual([]);
      expect(await count(m, `select count(*)::int n from "user" where id=$1`, [e2e.user.id])).toBe(1);

      const e3 = await operatorWithData('e2e-run3-y');
      const r3 = await purgeE2eOperators(m, 'e2e-run3-', { apply: true, protectEmails: [e3.user.email.toUpperCase()] });
      expect(r3.users).toEqual([]);

      const e4 = await operatorWithData('e2e-run4-z');
      await m.query(`update "user" set role='admin' where id=$1`, [e4.user.id]);
      const r4 = await purgeE2eOperators(m, 'e2e-run4-', { apply: true, protectEmails: [] });
      expect(r4.users).toEqual([]);
      expect(await count(m, `select count(*)::int n from "user" where id=$1`, [e4.user.id])).toBe(1);
    } finally {
      await m.end();
    }
  });

  it('refuses anything that is not an e2e- prefix', async () => {
    m = await migratorClient();
    try {
      for (const bad of ['', 'tanuhomes', '%', 'e2e', 'e2e-', 'e2e%', 'e2e-25', 'E2E-x-', 'x-e2e-1-'])
        await expect(purgeE2eOperators(m, bad, { apply: true, protectEmails: [] })).rejects.toThrow(/refusing prefix/);
      await expect(purgeE2eOperators(m, 'e2e-25-', { apply: false, protectEmails: [] })).resolves.toMatchObject({ deleted: false });
    } finally {
      await m.end();
    }
  });
});
