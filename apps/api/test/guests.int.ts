import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';

describe('guests [GST-01..04]', () => {
  let t: TestApp;
  let fd: Agent;
  let orgId: string;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
    orgId = (await seedOrg()).id;
    fd = (await signInAs(t, 'frontdesk', orgId)).agent;
  });

  const names = (body: { items: { fullName: string }[] }) => body.items.map((g) => g.fullName);

  it('creates and searches by name, phone and email', async () => {
    await fd
      .post('/v1/guests')
      .send({ fullName: 'Adaeze Okafor', phoneE164: '+2348031234567', email: 'ada@example.ng' })
      .expect(201);
    await fd.post('/v1/guests').send({ fullName: 'Tunde Bakare', phoneE164: '+2348099999999' }).expect(201);
    expect(names((await fd.get('/v1/guests?q=adae').expect(200)).body)).toEqual(['Adaeze Okafor']);
    expect(names((await fd.get('/v1/guests?q=0809999').expect(200)).body)).toEqual(['Tunde Bakare']);
    expect((await fd.get('/v1/guests?q=ada@').expect(200)).body.items).toHaveLength(1);
  });

  it('rejects non-E.164 phones', async () => {
    await fd.post('/v1/guests').send({ fullName: 'X Y', phoneE164: '08031234567' }).expect(400);
  });

  it('match finds duplicates by phone or email [GST-03]', async () => {
    await fd
      .post('/v1/guests')
      .send({ fullName: 'Adaeze Okafor', phoneE164: '+2348031234567', email: 'Ada@Example.ng' })
      .expect(201);
    expect((await fd.get('/v1/guests/match?phone=%2B2348031234567').expect(200)).body.items).toHaveLength(1);
    expect((await fd.get('/v1/guests/match?email=ada@example.ng').expect(200)).body.items).toHaveLength(1);
    expect((await fd.get('/v1/guests/match?email=other@example.ng').expect(200)).body.items).toHaveLength(0);
  });

  it('paginates with a cursor', async () => {
    for (let i = 0; i < 5; i++) {
      await fd
        .post('/v1/guests')
        .send({ fullName: `Guest ${i}`, phoneE164: `+23480300000${i}0` })
        .expect(201);
    }
    const p1 = (await fd.get('/v1/guests?limit=2').expect(200)).body;
    const p2 = (await fd.get(`/v1/guests?limit=2&cursor=${p1.nextCursor}`).expect(200)).body;
    expect(names(p1)).toEqual(['Guest 0', 'Guest 1']);
    expect(names(p2)).toEqual(['Guest 2', 'Guest 3']);
  });

  it('guest detail includes a bookings list [GST-04]', async () => {
    const g = (
      await fd.post('/v1/guests').send({ fullName: 'Ada Guest', phoneE164: '+2348031234567' }).expect(201)
    ).body;
    const d = (await fd.get(`/v1/guests/${g.id}`).expect(200)).body;
    expect(d).toMatchObject({
      id: g.id,
      fullName: 'Ada Guest',
      bookingCount: 0,
      lifetimeValueKobo: 0,
      bookings: [],
    });
  });

  it('housekeeper and landlord cannot read guests', async () => {
    await (await signInAs(t, 'housekeeper', orgId)).agent.get('/v1/guests').expect(403);
    await (await signInAs(t, 'landlord', orgId)).agent.get('/v1/guests').expect(403);
  });
});
