import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { OrgDb } from '../src/common/db/org-db.service';
import { OutboxService } from '../src/modules/messaging/outbox.service';
import { MessageDispatchJob } from '../src/modules/messaging/message-dispatch.job';
import { MAILER } from '../src/common/mail/mail.module';
import { MemoryMailer } from '../src/common/mail/mailer';
import { WorkerModule } from '../src/worker.module';
import { SAMPLE_VARS } from '@boogbe/shared';

/** Stands in for a real provider: the dispatcher only marks mail `sent` when the mailer actually delivers. */
class DeliveringMailer extends MemoryMailer {
  override readonly delivers = true;
}

async function worker(mailer?: MemoryMailer) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const b = Test.createTestingModule({ imports: [WorkerModule] });
  if (mailer) b.overrideProvider(MAILER).useValue(mailer);
  const mod = await b.compile();
  await mod.init();
  return { job: mod.get(MessageDispatchJob), mailer: mod.get<MemoryMailer>(MAILER), close: () => mod.close() };
}

async function outboxRows() {
  const m = await migratorClient();
  const { rows } = await m.query(`select status, attempts, error, provider_id, sent_at from outbound_message`);
  await m.end();
  return rows;
}

describe('outbox [MSG-03 MSG-05 MSG-06]', () => {
  let t: TestApp;
  let orgId: string;
  let unitId: string;
  let bookingId: string;
  let w: Awaited<ReturnType<typeof worker>>;
  beforeAll(async () => {
    t = await createTestApp();
    w = await worker(new DeliveringMailer());
  });
  afterAll(async () => {
    await w.close();
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
    w.mailer.sent.length = 0;
    orgId = (await seedOrg('Tanuhomes')).id;
    const m = await migratorClient();
    await m.query(
      `insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'T','T','T',now())`,
      [orgId],
    );
    await m.query(`update organization set "contactEmail"='hello@tanuhomes.com' where id=$1`, [orgId]);
    await m.end();
    unitId = await seedUnit(orgId, await seedProperty(orgId));
    bookingId = await seedBooking(orgId, unitId, await seedGuest(orgId), { checkIn: '2026-11-01', checkOut: '2026-11-03' });
  });
  const queue = (extra: { dedupeKey?: string; paymentId?: string; bookingId?: string } = {}) =>
    t.app.get(OrgDb).run(orgId, (tx) =>
      t.app.get(OutboxService).queueEmail(tx, {
        bookingId,
        templateKey: 'booking_confirmation',
        to: 'ada@example.ng',
        subject: 'Hi',
        bodyMarkdown: 'Hello **Ada**',
        ...extra,
      }),
    );

  it('sends queued mail with operator name and reply-to, and records the provider id', async () => {
    await queue();
    await w.job.run();
    expect(w.mailer.sent).toHaveLength(1);
    expect(w.mailer.sent[0]).toMatchObject({
      to: 'ada@example.ng',
      subject: 'Hi',
      html: '<p>Hello <strong>Ada</strong></p>',
      text: 'Hello Ada',
      fromName: 'Tanuhomes',
      replyTo: 'hello@tanuhomes.com',
    });
    const [row] = await outboxRows();
    expect(row).toMatchObject({ status: 'sent', attempts: 1, error: null, provider_id: 'mem-1' });
    expect(row.sent_at).not.toBeNull();
  });

  it('template values stay plain text in the email — they never add formatting or links', async () => {
    await t.app.get(OrgDb).run(orgId, (tx) =>
      t.app.get(OutboxService).queueEmail(tx, {
        to: 'ada@example.ng',
        subject: 'Hi',
        bodyMarkdown: 'Hello **{{guest.firstName}}**, see [the map](https://maps.example.com)',
        vars: { ...SAMPLE_VARS, 'guest.firstName': '**Boss** [win](https://evil.example.com)' },
      }),
    );
    await w.job.run();
    const m = w.mailer.sent[0]!;
    expect(m.html).toBe(
      '<p>Hello <strong>**Boss** [win](https://evil.example.com)</strong>, see <a href="https://maps.example.com">the map</a></p>',
    );
    expect(m.text).toBe('Hello **Boss** [win](https://evil.example.com), see the map (https://maps.example.com)');
  });

  it('dedupe key prevents a second queue', async () => {
    expect(await queue({ dedupeKey: 'k1' })).not.toBeNull();
    expect(await queue({ dedupeKey: 'k1' })).toBeNull();
    expect(await outboxRows()).toHaveLength(1);
  });

  it('retries with backoff, then fails and alerts', async () => {
    const admin = await signInAs(t, 'admin', orgId);
    await queue();
    w.mailer.failNext(3);
    const m = await migratorClient();
    await w.job.run();
    const { rows: afterFirst } = await m.query(
      `select status, extract(epoch from next_attempt_at - now()) as wait_s from outbound_message`,
    );
    expect(afterFirst[0].status).toBe('queued');
    expect(Number(afterFirst[0].wait_s)).toBeGreaterThan(30); // 1-minute backoff, not the 10-minute lease
    expect(Number(afterFirst[0].wait_s)).toBeLessThanOrEqual(60);
    for (let i = 0; i < 2; i++) {
      await m.query(`update outbound_message set next_attempt_at = now() - interval '1 second'`);
      await w.job.run();
    }
    await m.end();
    expect((await outboxRows())[0]).toMatchObject({ status: 'failed', attempts: 3, error: 'simulated outage' });
    const items = (await admin.agent.get('/v1/notifications').expect(200)).body.items as { kind: string; link: string }[];
    expect(items.find((n) => n.kind === 'message_failed')).toMatchObject({ link: `/bookings/${bookingId}` });
  });

  it('skip locked prevents double send', async () => {
    await queue();
    await Promise.all([w.job.run(), w.job.run(), w.job.run()]);
    expect(w.mailer.sent).toHaveLength(1);
  });

  it('attaches the receipt PDF when the message is about a payment', async () => {
    const fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    const guestId = await seedGuest(orgId, { fullName: 'Bola Ade', phoneE164: '+2348030000002' });
    const id = (
      await fd
        .post('/v1/bookings')
        .send({ unitId, guestId, checkIn: '2026-12-01', checkOut: '2026-12-03', guestCount: 1, source: 'whatsapp' })
        .expect(201)
    ).body.id;
    const paid = (
      await fd
        .post(`/v1/bookings/${id}/payments`)
        .send({ kind: 'payment', amountKobo: 5_000_000, method: 'bank_transfer', receivedOn: '2026-10-10' })
        .expect(201)
    ).body;
    await queue({ bookingId: id, paymentId: paid.entries[0].id });
    await w.job.run();
    const att = w.mailer.sent[0]!.attachments!;
    expect(att).toHaveLength(1);
    expect(att[0]!.filename).toMatch(/T-R-000001.*\.pdf$/);
    expect(att[0]!.content.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('outbox without a real mailer [MSG-03]', () => {
  let t: TestApp;
  let w: Awaited<ReturnType<typeof worker>>;
  beforeAll(async () => {
    t = await createTestApp();
    w = await worker();
  });
  afterAll(async () => {
    await w.close();
    await t.close();
  });

  it('marks the message skipped_no_mailer, never sent', async () => {
    await truncateAll();
    const orgId = (await seedOrg('Tanuhomes')).id;
    await t.app
      .get(OrgDb)
      .run(orgId, (tx) =>
        t.app.get(OutboxService).queueEmail(tx, { to: 'ada@example.ng', subject: 'Hi', bodyMarkdown: 'Hello' }),
      );
    await w.job.run();
    expect((await outboxRows())[0]).toMatchObject({ status: 'skipped_no_mailer', provider_id: null, sent_at: null });
  });
});
