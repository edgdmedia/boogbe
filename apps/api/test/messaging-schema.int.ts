import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';
import { newId } from '../src/common/db/ids';

const msg = (orgId: string, o: Partial<{ id: string; status: string; channel: string; next: string | null; dedupe: string | null; at: string }> = {}) => [
  o.id ?? newId(),
  orgId,
  o.channel ?? 'email',
  o.status ?? 'queued',
  o.next ?? null,
  o.dedupe ?? null,
  o.at ?? '2026-10-14T09:00:00Z',
];
const INSERT = `insert into outbound_message(id, org_id, channel, recipient, body_text, status, next_attempt_at, dedupe_key, created_at)
  values ($1,$2,$3,'guest@example.com','Hello',$4,$5,$6,$7)`;

describe('messaging schema [MSG-01 MSG-05]', () => {
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

  it('templates and outbox are isolated per org', async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const m = await migratorClient();
    await m.query(
      `insert into message_template(id, org_id, key, email_subject, email_body, whatsapp_body, auto_email, updated_at)
       values ($1,$2,'booking_confirmation','S','B','W',true,now())`,
      [newId(), a.id],
    );
    await m.query(INSERT, msg(a.id));
    await m.end();
    await app.query('begin');
    try {
      await app.query(`select set_config('app.org_id',$1,true)`, [b.id]);
      for (const t of ['message_template', 'outbound_message'])
        expect((await app.query(`select count(*)::int n from ${t}`)).rows[0].n).toBe(0);
      await app.query(`select set_config('app.org_id',$1,true)`, [a.id]);
      for (const t of ['message_template', 'outbound_message'])
        expect((await app.query(`select count(*)::int n from ${t}`)).rows[0].n).toBe(1);
    } finally {
      await app.query('rollback');
    }
  });

  it("knows 'skipped_no_mailer' and refuses unknown statuses and channels", async () => {
    const org = await seedOrg();
    const m = await migratorClient();
    try {
      for (const status of ['queued', 'sent', 'failed', 'whatsapp_opened', 'skipped_no_mailer'])
        await m.query(INSERT, msg(org.id, { status, channel: status === 'whatsapp_opened' ? 'whatsapp' : 'email' }));
      await expect(m.query(INSERT, msg(org.id, { status: 'delivered' }))).rejects.toThrow(/outbound_message_status_chk/);
      await expect(m.query(INSERT, msg(org.id, { channel: 'sms' }))).rejects.toThrow(/outbound_message_channel_chk/);
    } finally {
      await m.end();
    }
  });

  it('one message per dedupe key per org', async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const m = await migratorClient();
    try {
      await m.query(INSERT, msg(a.id, { dedupe: 'auto-booking_confirmation-b1' }));
      await m.query(INSERT, msg(b.id, { dedupe: 'auto-booking_confirmation-b1' })); // other org: fine
      await expect(m.query(INSERT, msg(a.id, { dedupe: 'auto-booking_confirmation-b1' }))).rejects.toThrow(/unique/i);
      await m.query(INSERT, msg(a.id)); // no key: no limit
      await m.query(INSERT, msg(a.id));
    } finally {
      await m.end();
    }
  });

  it('claim_outbound leases due queued messages of active orgs only, oldest first', async () => {
    const live = await seedOrg();
    const suspended = await seedOrg();
    const m = await migratorClient();
    const due = [newId(), newId()];
    try {
      // Everything that must NOT be claimed is older than the due messages, so a missing condition shows up first.
      await m.query(INSERT, msg(live.id, { next: '2999-01-01T00:00:00Z', at: '2026-10-14T07:00:00Z' })); // retry not due yet
      for (const status of ['sent', 'failed', 'skipped_no_mailer'])
        await m.query(INSERT, msg(live.id, { status, at: '2026-10-14T07:00:00Z' }));
      await m.query(INSERT, msg(suspended.id, { at: '2026-10-14T07:00:00Z' }));
      await m.query(`update organization set status='suspended' where id=$1`, [suspended.id]);
      await m.query(INSERT, msg(live.id, { id: due[1]!, at: '2026-10-14T09:05:00Z' }));
      await m.query(INSERT, msg(live.id, { id: due[0]!, at: '2026-10-14T09:00:00Z', next: '2000-01-01T00:00:00Z' }));

      // RETURNING order is not guaranteed, so "oldest first" is checked through the limit: one at a time.
      const first = (await app.query(`select * from claim_outbound(1)`)).rows;
      expect(first).toEqual([{ id: due[0], org_id: live.id }]);
      const rest = (await app.query(`select * from claim_outbound(10)`)).rows;
      expect(rest).toEqual([{ id: due[1], org_id: live.id }]);
      const rows = (await m.query(`select attempts, next_attempt_at > now() as leased from outbound_message where id = any($1)`, [due])).rows;
      expect(rows).toEqual([
        { attempts: 1, leased: true },
        { attempts: 1, leased: true },
      ]);
      expect((await app.query(`select * from claim_outbound(10)`)).rows).toEqual([]); // leased
    } finally {
      await m.end();
    }
  });

  it('two workers claiming at once never get the same message', async () => {
    const org = await seedOrg();
    const m = await migratorClient();
    const second = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await second.connect();
    try {
      for (let i = 0; i < 6; i++) await m.query(INSERT, msg(org.id, { at: `2026-10-14T09:0${i}:00Z` }));
      await app.query('begin');
      const first = (await app.query(`select id from claim_outbound(3)`)).rows.map((r) => r.id);
      const other = (await second.query(`select id from claim_outbound(10)`)).rows.map((r) => r.id); // skips the locked rows
      await app.query('commit');
      expect(first).toHaveLength(3);
      expect(other).toHaveLength(3);
      expect(first.filter((id) => other.includes(id))).toEqual([]);
    } finally {
      await second.end();
      await m.end();
    }
  });

  it('the app role can run claim_outbound but cannot read the outbox without an org', async () => {
    const org = await seedOrg();
    const m = await migratorClient();
    await m.query(INSERT, msg(org.id));
    await m.end();
    expect((await app.query(`select count(*)::int n from outbound_message`)).rows[0].n).toBe(0);
    expect((await app.query(`select * from claim_outbound(5)`)).rows).toHaveLength(1);
  });
});
