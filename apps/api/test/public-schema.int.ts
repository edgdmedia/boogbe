import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';
import { seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';

describe('0008 public booking schema', () => {
  let m: Client;
  let app: Client;
  beforeAll(async () => {
    m = await migratorClient();
    app = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await app.connect();
  });
  afterAll(async () => {
    await m.end();
    await app.end();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  const orgWithSettings = async () => {
    const org = await seedOrg();
    await m.query(
      `insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'T','T','T',now())`,
      [org.id],
    );
    return org;
  };

  it('defaults are off and safe', async () => {
    const org = await orgWithSettings();
    const unitId = await seedUnit(org.id, await seedProperty(org.id));
    const u = await m.query('select public_listed from unit where id=$1', [unitId]);
    expect(u.rows[0].public_listed).toBe(false);
    const s = await m.query(
      'select public_enabled, public_hold_minutes, public_origins, notify_emails, public_site_url from org_settings where org_id=$1',
      [org.id],
    );
    expect(s.rows[0]).toEqual({ public_enabled: false, public_hold_minutes: 120, public_origins: [], notify_emails: [], public_site_url: null });
  });

  it('rejects hold minutes outside 15–1440', async () => {
    const org = await orgWithSettings();
    await expect(m.query('update org_settings set public_hold_minutes=5 where org_id=$1', [org.id])).rejects.toThrow(/org_settings_public_hold_chk/);
    await expect(m.query('update org_settings set public_hold_minutes=1441 where org_id=$1', [org.id])).rejects.toThrow(/org_settings_public_hold_chk/);
    await m.query('update org_settings set public_hold_minutes=15 where org_id=$1', [org.id]);
    await m.query('update org_settings set public_hold_minutes=1440 where org_id=$1', [org.id]);
  });

  it('accepts website as a booking source and still rejects unknown sources', async () => {
    const org = await orgWithSettings();
    const unitId = await seedUnit(org.id, await seedProperty(org.id));
    const guestId = await seedGuest(org.id);
    const insert = (ref: string, source: string, checkIn: string, checkOut: string) =>
      m.query(
        `insert into booking(id, org_id, ref, unit_id, guest_id, check_in, check_out, guest_count, source, status, computed_total_kobo, final_total_kobo, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,2,$8,'tentative',1,1,now())`,
        [newId(), org.id, ref, unitId, guestId, checkIn, checkOut, source],
      );
    await insert('W-1', 'website', '2027-01-01', '2027-01-03');
    await expect(insert('W-2', 'tiktok', '2027-02-01', '2027-02-03')).rejects.toThrow(/booking_source_chk/);
  });

  it('public_org_lookup only returns active, enabled orgs', async () => {
    const org = await orgWithSettings();
    expect((await app.query('select * from public_org_lookup($1)', [org.slug])).rows).toEqual([]);
    await m.query(`update org_settings set public_enabled=true, public_origins='{https://tanuhomes.com}' where org_id=$1`, [org.id]);
    // The app role has no org context on public routes; the lookup must still see the row.
    expect((await app.query('select * from public_org_lookup($1)', [org.slug])).rows).toEqual([
      { org_id: org.id, timezone: 'Africa/Lagos', public_origins: ['https://tanuhomes.com'], public_hold_minutes: 120 },
    ]);
    expect((await app.query('select * from public_org_lookup($1)', ['no-such-org'])).rows).toEqual([]);
    await m.query(`update organization set status='suspended' where id=$1`, [org.id]);
    expect((await app.query('select * from public_org_lookup($1)', [org.slug])).rows).toEqual([]);
  });
});
