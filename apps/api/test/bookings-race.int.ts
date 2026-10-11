import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { seedGuest, seedProperty, seedUnit } from './helpers/inventory';

describe('double-booking race [BKG-02]', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await truncateAll();
  });
  afterAll(async () => {
    await t.close();
  });

  it('20 concurrent overlapping creates → exactly one succeeds', async () => {
    const orgId = (await seedOrg()).id;
    const m = await migratorClient();
    await m.query(
      `insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'R','R','R',now())`,
      [orgId],
    );
    await m.end();
    const unitId = await seedUnit(orgId, await seedProperty(orgId));
    const guestId = await seedGuest(orgId);
    const { agent } = await signInAs(t, 'frontdesk', orgId);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        agent
          .post('/v1/bookings')
          .send({
            unitId,
            guestId,
            checkIn: '2026-11-01',
            checkOut: `2026-11-0${2 + (i % 5)}`,
            guestCount: 1,
            source: 'phone',
          }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(19);
  });
});
