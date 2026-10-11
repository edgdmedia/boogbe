import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';
import { OrgDb } from '../src/common/db/org-db.service';
import { newId } from '../src/common/db/ids';
import { Client } from 'pg';

describe('booking exclusion constraint', () => {
  let t: TestApp;
  let db: OrgDb;
  let orgId: string;
  let unitId: string;
  let guestId: string;
  beforeAll(async () => {
    t = await createTestApp();
    db = t.app.get(OrgDb);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
    orgId = (await seedOrg()).id;
    unitId = await seedUnit(orgId, await seedProperty(orgId));
    guestId = await db.run(
      orgId,
      async (tx) =>
        (
          await tx.guest.create({
            data: { id: newId(), fullName: 'Ada', phoneE164: '+2348000000000' } as never,
          })
        ).id,
    );
  });
  const mk = (ci: string, co: string, status = 'confirmed') =>
    db.run(orgId, (tx) =>
      tx.booking.create({
        data: {
          id: newId(),
          ref: newId(),
          unitId,
          guestId,
          checkIn: new Date(ci),
          checkOut: new Date(co),
          guestCount: 2,
          source: 'whatsapp',
          status,
          computedTotalKobo: 1n,
          finalTotalKobo: 1n,
        } as never,
      }),
    );

  it('refuses overlapping active bookings, allows back-to-back and cancelled overlaps', async () => {
    await mk('2026-11-01', '2026-11-04');
    await mk('2026-11-04', '2026-11-06');
    await mk('2026-11-02', '2026-11-03', 'cancelled');
    await expect(mk('2026-11-03', '2026-11-05')).rejects.toThrow(/booking_no_overlap|23P01|exclusion/);
  });

  it('status history is append-only for the app role', async () => {
    const b = await mk('2026-12-01', '2026-12-02');
    const m = await migratorClient();
    const id = newId();
    await m.query(
      `insert into booking_status_event(id, org_id, booking_id, to_status) values ($1,$2,$3,'confirmed')`,
      [id, orgId, b.id],
    );
    await m.end();
    const app = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await app.connect();
    try {
      await app.query('BEGIN');
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      await expect(app.query(`update booking_status_event set reason='x' where id=$1`, [id])).rejects.toThrow(
        /permission denied/,
      );
      await app.query('ROLLBACK');
    } finally {
      await app.end();
    }
  });
});
