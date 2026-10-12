import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';
import { ICAL_FETCHER } from '../src/modules/ical/tokens';
import { IcalSyncService } from '../src/modules/ical/sync.service';
import { Test } from '@nestjs/testing';
import { IcalImportJob } from '../src/modules/ical/ical-import.job';
import { WorkerModule } from '../src/worker.module';
import { MAILER } from '../src/common/mail/mail.module';
import type { MemoryMailer } from '../src/common/mail/mailer';

const fx = (n: string) => readFileSync(resolve(__dirname, 'fixtures/ical', n), 'utf8');
// Fixture events are in Nov–Dec 2026; pin "today" so the suite doesn't start failing once those dates pass.
const NOW = new Date('2026-10-10T12:00:00Z');

class FakeFetcher {
  responses = new Map<string, () => Promise<unknown>>();
  calls: string[] = [];
  set(url: string, fn: () => Promise<unknown>) {
    this.responses.set(url, fn);
  }
  async fetch(url: string) {
    this.calls.push(url);
    const r = this.responses.get(url);
    if (!r) throw new Error('no fake');
    return r();
  }
}

describe('iCal import [ICS-01..03 ICS-06 NTF-02]', () => {
  let t: TestApp;
  let admin: Agent;
  let orgId: string;
  let unitId: string;
  let fake: FakeFetcher;
  beforeAll(async () => {
    t = await createTestApp({ overrides: [[ICAL_FETCHER, new FakeFetcher()]] });
    fake = t.app.get(ICAL_FETCHER);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    await truncateAll();
    fake.responses.clear();
    fake.calls = [];
    t.app.get<MemoryMailer>(MAILER).sent.length = 0;
    orgId = (await seedOrg()).id;
    unitId = await seedUnit(orgId, await seedProperty(orgId));
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const URL_A = 'https://www.airbnb.com/calendar/ical/123.ics?s=abc';
  const addFeed = async () =>
    (
      await admin
        .post('/v1/ical/feeds')
        .send({ unitId, label: 'Airbnb', channel: 'airbnb', url: URL_A })
        .expect(201)
    ).body;

  it('adding a feed validates it and imports events as blocks', async () => {
    fake.set(URL_A, async () => ({ status: 'ok', body: fx('airbnb.ics'), etag: '"v1"', lastModified: null }));
    const f = await addFeed();
    expect(f).toMatchObject({ lastStatus: 'ok', urlHost: 'www.airbnb.com', blockCount: 2 });
    const cal = (await admin.get('/v1/calendar?from=2026-11-01&to=2026-12-31').expect(200)).body;
    expect(
      cal.items.filter((i: { kind: string; source: string }) => i.kind === 'block' && i.source === 'ical'),
    ).toHaveLength(2);
  });

  it('rejects a link that is not a calendar', async () => {
    fake.set(URL_A, async () => ({
      status: 'ok',
      body: fx('malformed.ics'),
      etag: null,
      lastModified: null,
    }));
    const r = await admin
      .post('/v1/ical/feeds')
      .send({ unitId, label: 'Airbnb', channel: 'airbnb', url: URL_A });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe('Not a calendar file');
  });

  it('a second sync with the same events changes nothing (idempotent)', async () => {
    fake.set(URL_A, async () => ({ status: 'ok', body: fx('airbnb.ics'), etag: null, lastModified: null }));
    const f = await addFeed();
    const r = await t.app.get(IcalSyncService).syncFeed(orgId, f.id, new Date('2026-10-10T12:30:00Z'));
    expect(r).toMatchObject({ status: 'ok', added: 0, updated: 0, removed: 0 });
  });

  it('vanished future events are removed, past kept; 304 keeps blocks', async () => {
    fake.set(URL_A, async () => ({ status: 'ok', body: fx('airbnb.ics'), etag: null, lastModified: null }));
    const f = await addFeed();
    const m = await migratorClient();
    await m.query(
      `insert into block(id, org_id, unit_id, start, "end", source, reason, feed_id, external_uid, updated_at)
       values ('past1',$1,$2,'2026-09-01','2026-09-03','ical','external',$3,'gone-past',now())`,
      [orgId, unitId, f.id],
    );
    fake.set(URL_A, async () => ({
      status: 'ok',
      body: fx('booking_com.ics'),
      etag: null,
      lastModified: null,
    })); // airbnb events vanish
    const svc = t.app.get(IcalSyncService);
    const r = await svc.syncFeed(orgId, f.id, new Date('2026-10-10T12:00:00Z'));
    expect(r).toMatchObject({ status: 'ok', added: 1, removed: 2 });
    const { rows } = await m.query(`select external_uid from block where feed_id=$1 order by start`, [f.id]);
    expect(rows.map((x) => x.external_uid)).toEqual(['gone-past', 'bdc-77812@booking.com']);
    fake.set(URL_A, async () => ({ status: 'not_modified' }));
    expect((await svc.syncFeed(orgId, f.id, new Date('2026-10-10T12:30:00Z'))).status).toBe('not_modified');
    expect((await m.query(`select count(*)::int n from block where feed_id=$1`, [f.id])).rows[0].n).toBe(2);
    await m.end();
  });

  it('three failures mark the feed failing, alert admins once and email them', async () => {
    fake.set(URL_A, async () => ({ status: 'ok', body: fx('airbnb.ics'), etag: null, lastModified: null }));
    const f = await addFeed();
    fake.set(URL_A, async () => {
      throw Object.assign(new Error('Calendar link not found (404)'), { name: 'FetchError' });
    });
    const svc = t.app.get(IcalSyncService);
    for (let i = 0; i < 4; i++) await svc.syncFeed(orgId, f.id, new Date(Date.UTC(2026, 9, 10, 12, i * 20)));
    const feed = (await admin.get(`/v1/units/${unitId}/ical`).expect(200)).body.feeds[0];
    expect(feed).toMatchObject({
      lastStatus: 'error',
      consecutiveFailures: 4,
      lastError: 'Calendar link not found (404)',
    });
    const n = (await admin.get('/v1/notifications').expect(200)).body;
    expect(n.items.filter((x: { kind: string }) => x.kind === 'ical_feed_failing')).toHaveLength(1);
    expect(
      t.app.get<MemoryMailer>(MAILER).sent.filter((mm) => mm.subject.includes('Calendar sync')),
    ).toHaveLength(1);
  });

  it('sync now is rate limited to once a minute', async () => {
    fake.set(URL_A, async () => ({ status: 'ok', body: fx('airbnb.ics'), etag: null, lastModified: null }));
    const f = await addFeed();
    const r = await admin.post(`/v1/ical/feeds/${f.id}/sync`);
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('RATE_LIMITED');
  });

  it('the import job syncs only due, active feeds', async () => {
    fake.set(URL_A, async () => ({ status: 'ok', body: fx('airbnb.ics'), etag: null, lastModified: null }));
    const f = await addFeed();
    fake.calls = [];
    // Crons live only in the worker (D-019); it gets the same fake fetcher.
    const mod = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ICAL_FETCHER)
      .useValue(fake)
      .compile();
    await mod.init();
    try {
      const job = mod.get(IcalImportJob);
      await job.run(new Date(NOW.getTime() + 60_000)); // attempted a minute ago → not due
      expect(fake.calls).toHaveLength(0);
      await job.run(new Date(NOW.getTime() + 21 * 60_000)); // past 15 min + max jitter − tick → due
      expect(fake.calls).toHaveLength(1);
      await admin.patch(`/v1/ical/feeds/${f.id}`).send({ active: false }).expect(200);
      await job.run(new Date(NOW.getTime() + 60 * 60_000));
      expect(fake.calls).toHaveLength(1);
    } finally {
      await mod.close();
    }
  });

  it('deleting a feed removes its blocks', async () => {
    fake.set(URL_A, async () => ({ status: 'ok', body: fx('airbnb.ics'), etag: null, lastModified: null }));
    const f = await addFeed();
    await admin.delete(`/v1/ical/feeds/${f.id}`).expect(200);
    const m = await migratorClient();
    expect((await m.query(`select count(*)::int n from block where org_id=$1`, [orgId])).rows[0].n).toBe(0);
    await m.end();
  });

  it('frontdesk can view feeds but not add them', async () => {
    const fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    await fd.get(`/v1/units/${unitId}/ical`).expect(200);
    await fd
      .post('/v1/ical/feeds')
      .send({ unitId, label: 'Airbnb', channel: 'airbnb', url: URL_A })
      .expect(403);
  });
});
