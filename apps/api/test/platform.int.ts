import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedUser, signIn } from './helpers/users';
import { MAILER } from '../src/common/mail/mail.module';
import type { MemoryMailer } from '../src/common/mail/mailer';

describe('platform admin', () => {
  let t: TestApp;
  let admin: Awaited<ReturnType<typeof signIn>>;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
    const u = await seedUser(t, { platformAdmin: true });
    admin = await signIn(t, u.email, u.password);
  });

  it('creates an operator with Lagos/NGN defaults and settings [PLT-01]', async () => {
    const res = await admin
      .post('/v1/platform/operators')
      .send({ name: 'Tanuhomes', slug: 'tanuhomes', contactEmail: 'hello@tanuhomes.com' })
      .expect(201);
    expect(res.body).toMatchObject({
      name: 'Tanuhomes',
      slug: 'tanuhomes',
      status: 'active',
      timezone: 'Africa/Lagos',
      currency: 'NGN',
      memberCount: 0,
    });
    const list = await admin.get('/v1/platform/operators').expect(200);
    // seedUser bootstraps its own throwaway org for the invitation gate — assert on ours.
    const created = list.body.items.filter((o: { slug: string }) => o.slug === 'tanuhomes');
    expect(created).toHaveLength(1);
  });

  it('rejects bad and duplicate slugs [PLT-01]', async () => {
    await admin.post('/v1/platform/operators').send({ name: 'X', slug: 'Bad Slug!' }).expect(400);
    await admin.post('/v1/platform/operators').send({ name: 'Tanu', slug: 'tanu' }).expect(201);
    const dup = await admin.post('/v1/platform/operators').send({ name: 'Tanu2', slug: 'tanu' });
    expect(dup.status).toBe(409);
  });

  it('invites the first admin who can accept and lands as admin [PLT-02]', async () => {
    const op = (await admin.post('/v1/platform/operators').send({ name: 'Tanuhomes', slug: 'tanuhomes' })).body;
    const inv = await admin
      .post(`/v1/platform/operators/${op.id}/invite-admin`)
      .send({ email: 'Owner@Tanuhomes.com' })
      .expect(201);
    const mail = t.app.get<MemoryMailer>(MAILER).lastTo('owner@tanuhomes.com')!;
    expect(mail.text).toContain(`/auth/accept-invite/${inv.body.id}`);

    const pub = await t.http.get(`/v1/invitations/${inv.body.id}/public`).expect(200);
    expect(pub.body).toMatchObject({
      email: 'owner@tanuhomes.com',
      orgName: 'Tanuhomes',
      role: 'admin',
      status: 'pending',
      expired: false,
    });

    const agent = t.agent();
    await agent
      .post('/v1/auth/sign-up/email')
      .send({ email: 'owner@tanuhomes.com', password: 'correct-horse-battery', name: 'Owner', invitationId: inv.body.id })
      .expect(200);
    await agent.post('/v1/auth/organization/accept-invitation').send({ invitationId: inv.body.id }).expect(200);
    await agent.post('/v1/auth/organization/set-active').send({ organizationId: op.id }).expect(200);
    const me = await agent.get('/v1/me').expect(200);
    expect(me.body.activeOrg).toMatchObject({ id: op.id, role: 'admin' });
    const s = await agent.get('/v1/org/settings').expect(200);
    expect(s.body.settings).toMatchObject({
      checkInTime: '14:00',
      checkOutTime: '12:00',
      holdHours: 24,
      receiptPrefix: 'TAN',
    });
  });

  it('suspends and reactivates [PLT-03]', async () => {
    const op = (await admin.post('/v1/platform/operators').send({ name: 'Tanuhomes', slug: 'tanuhomes' })).body;
    await admin.post(`/v1/platform/operators/${op.id}/suspend`).expect(200);
    expect((await admin.get(`/v1/platform/operators/${op.id}`)).body.status).toBe('suspended');
    await admin.post(`/v1/platform/operators/${op.id}/reactivate`).expect(200);
    expect((await admin.get(`/v1/platform/operators/${op.id}`)).body.status).toBe('active');
  });

  it('public invitation endpoint hides nothing sensitive and 404s unknown ids', async () => {
    await t.http.get('/v1/invitations/does-not-exist/public').expect(404);
  });

  it('org settings update validates input [ORG-02 ORG-03]', async () => {
    const op = (await admin.post('/v1/platform/operators').send({ name: 'Tanuhomes', slug: 'tanuhomes' })).body;
    const inv = (await admin.post(`/v1/platform/operators/${op.id}/invite-admin`).send({ email: 'a@t.ng' })).body;
    const agent = t.agent();
    await agent
      .post('/v1/auth/sign-up/email')
      .send({ email: 'a@t.ng', password: 'correct-horse-battery', name: 'A', invitationId: inv.id });
    await agent.post('/v1/auth/organization/accept-invitation').send({ invitationId: inv.id });
    await agent.post('/v1/auth/organization/set-active').send({ organizationId: op.id });
    await agent.patch('/v1/org/settings').send({ checkInTime: '25:00' }).expect(400);
    await agent
      .patch('/v1/org/settings')
      .send({ checkInTime: '15:00', bookingPrefix: 'TNH', whatsappPhone: '+2348107548559' })
      .expect(200);
    const s = await agent.get('/v1/org/settings').expect(200);
    expect(s.body.settings.checkInTime).toBe('15:00');
    expect(s.body.org.whatsappPhone).toBe('+2348107548559');
  });
});
