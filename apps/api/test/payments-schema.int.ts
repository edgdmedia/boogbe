import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';

describe('payment ledger is append-only [PAY-04]', () => {
  let c: Client;
  let orgId: string;
  let bookingId: string;
  beforeAll(async () => {
    c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await c.connect();
  });
  afterAll(async () => {
    await c.end();
  });
  beforeEach(async () => {
    await truncateAll();
    orgId = (await seedOrg()).id;
    bookingId = await seedBooking(
      orgId,
      await seedUnit(orgId, await seedProperty(orgId)),
      await seedGuest(orgId),
      {
        checkIn: '2026-11-01',
        checkOut: '2026-11-03',
      },
    );
  });
  const inOrg = async <T>(fn: () => Promise<T>) => {
    await c.query('begin');
    await c.query(`select set_config('app.org_id',$1,true)`, [orgId]);
    try {
      return await fn();
    } finally {
      await c.query('rollback');
    }
  };

  it('app role can insert and select but not update or delete', async () => {
    await inOrg(async () => {
      const id = newId();
      await c.query(
        `insert into payment(id, org_id, booking_id, kind, amount_kobo, method, received_on) values ($1,$2,$3,'payment',100,'cash','2026-10-10')`,
        [id, orgId, bookingId],
      );
      await expect(c.query(`update payment set amount_kobo = 1 where id = $1`, [id])).rejects.toThrow(
        /permission denied/,
      );
    });
    await inOrg(async () => {
      await expect(c.query(`delete from payment`)).rejects.toThrow(/permission denied/);
    });
  });

  it('booking_money respects RLS and voids', async () => {
    await inOrg(async () => {
      const p1 = newId();
      const p2 = newId();
      await c.query(
        `insert into payment(id, org_id, booking_id, kind, amount_kobo, method, received_on)
         values ($1,$2,$3,'payment',4000000,'cash','2026-10-10'),($4,$2,$3,'payment',1000000,'cash','2026-10-10')`,
        [p1, orgId, bookingId, p2],
      );
      await c.query(
        `insert into payment(id, org_id, booking_id, kind, amount_kobo, method, received_on, voids_payment_id)
         values ($1,$2,$3,'void',1000000,'cash','2026-10-10',$4)`,
        [newId(), orgId, bookingId, p2],
      );
      const { rows } = await c.query(
        `select paid_kobo, balance_kobo from booking_money where booking_id = $1`,
        [bookingId],
      );
      expect(rows[0]).toEqual({ paid_kobo: '4000000', balance_kobo: '6000000' });
    });
    const { rows } = await c.query(`select count(*)::int n from booking_money`);
    expect(rows[0].n).toBe(0); // no org set
  });

  it('a void must name the entry it voids', async () => {
    await inOrg(async () => {
      await expect(
        c.query(
          `insert into payment(id, org_id, booking_id, kind, amount_kobo, method, received_on) values ($1,$2,$3,'void',1,'cash','2026-10-10')`,
          [newId(), orgId, bookingId],
        ),
      ).rejects.toThrow(/payment_void_target_chk/);
    });
  });
});
