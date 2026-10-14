import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';

describe('iCal schema [ICS-01..05]', () => {
  let app: Client;
  beforeAll(async () => {
    app = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await app.connect();
  });
  afterAll(async () => {
    await app.end();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it('ical_export_lookup resolves a token without org context and only for active orgs', async () => {
    const org = await seedOrg();
    const unit = await seedUnit(org.id, await seedProperty(org.id));
    const m = await migratorClient();
    await m.query(
      `insert into ical_export(id, org_id, unit_id, channel, token) values ($1,$2,$3,'airbnb','tok123')`,
      [newId(), org.id, unit],
    );
    const r = await app.query(`select * from ical_export_lookup('tok123')`);
    expect(r.rows[0]).toMatchObject({ org_id: org.id, unit_id: unit, channel: 'airbnb' });
    expect((await app.query(`select * from ical_export_lookup('nope')`)).rows).toEqual([]);
    expect((await app.query(`select count(*)::int n from ical_export`)).rows[0].n).toBe(0); // RLS still hides the table
    await m.query(`update organization set status='suspended' where id=$1`, [org.id]);
    expect((await app.query(`select * from ical_export_lookup('tok123')`)).rows).toEqual([]);
    await m.end();
  });

  it('feeds, exports and conflicts are isolated per org', async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const ua = await seedUnit(a.id, await seedProperty(a.id));
    const m = await migratorClient();
    await m.query(
      `insert into ical_feed(id, org_id, unit_id, label, channel, url, updated_at) values ($1,$2,$3,'Airbnb','airbnb','https://x.test/a.ics',now())`,
      [newId(), a.id, ua],
    );
    await m.end();
    await app.query('begin');
    try {
      await app.query(`select set_config('app.org_id',$1,true)`, [b.id]);
      for (const t of ['ical_feed', 'ical_export', 'sync_conflict'])
        expect((await app.query(`select count(*)::int n from ${t}`)).rows[0].n).toBe(0);
      await app.query(`select set_config('app.org_id',$1,true)`, [a.id]);
      expect((await app.query(`select count(*)::int n from ical_feed`)).rows[0].n).toBe(1);
    } finally {
      await app.query('rollback');
    }
  });

  it('one open conflict per booking/block pair; deleting a feed removes its blocks and unlinks conflicts', async () => {
    const org = await seedOrg();
    const unit = await seedUnit(org.id, await seedProperty(org.id));
    const booking = await seedBooking(org.id, unit, await seedGuest(org.id), {
      checkIn: '2026-11-01',
      checkOut: '2026-11-03',
    });
    const feed = newId();
    const block = newId();
    const m = await migratorClient();
    await m.query(
      `insert into ical_feed(id, org_id, unit_id, label, channel, url, updated_at) values ($1,$2,$3,'Airbnb','airbnb','https://x.test/a.ics',now())`,
      [feed, org.id, unit],
    );
    await m.query(
      `insert into block(id, org_id, unit_id, start, "end", source, reason, feed_id, external_uid, updated_at)
       values ($1,$2,$3,'2026-11-02','2026-11-04','ical','external',$4,'uid-1',now())`,
      [block, org.id, unit, feed],
    );
    const conflict = (status: string) =>
      m.query(
        `insert into sync_conflict(id, org_id, unit_id, booking_id, block_id, block_start, block_end, block_summary, status)
         values ($1,$2,$3,$4,$5,'2026-11-02','2026-11-04','Reserved',$6)`,
        [newId(), org.id, unit, booking, block, status],
      );
    await conflict('open');
    await expect(conflict('open')).rejects.toThrow(/sync_conflict_open_pair/);
    await conflict('resolved');
    await m.query(`delete from ical_feed where id = $1`, [feed]);
    expect((await m.query(`select count(*)::int n from block where id = $1`, [block])).rows[0].n).toBe(0);
    const { rows } = await m.query(`select block_id, block_summary from sync_conflict order by status`);
    expect(rows).toEqual([
      { block_id: null, block_summary: 'Reserved' },
      { block_id: null, block_summary: 'Reserved' },
    ]);
    await m.end();
  });
});
