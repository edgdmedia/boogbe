import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, seedOrgSettings, signInAs } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';

describe('online booking settings [WB]', () => {
  let t: TestApp;
  let orgId: string;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await truncateAll();
    orgId = (await seedOrg()).id;
    await seedOrgSettings(orgId);
  });

  it('defaults are off', async () => {
    const { agent } = await signInAs(t, 'admin', orgId);
    const r = await agent.get('/v1/org/settings').expect(200);
    expect(r.body.settings).toMatchObject({
      publicEnabled: false,
      publicHoldMinutes: 120,
      publicOrigins: [],
      publicSiteUrl: null,
      notifyEmails: [],
    });
  });

  it('admin reads and updates public settings; origins are normalised and deduplicated', async () => {
    const { agent } = await signInAs(t, 'admin', orgId);
    const r = await agent.patch('/v1/org/settings').send({
      publicEnabled: true,
      publicHoldMinutes: 90,
      publicOrigins: [
        'https://tanuhomes.com/',
        'https://tanuhomes.com/short-lets',
        'https://www.tanuhomes.com',
      ],
      publicSiteUrl: 'https://tanuhomes.com',
      notifyEmails: ['desk@tanuhomes.com'],
    });
    expect(r.status).toBe(200);
    expect(r.body.settings).toMatchObject({
      publicEnabled: true,
      publicHoldMinutes: 90,
      publicOrigins: ['https://tanuhomes.com', 'https://www.tanuhomes.com'],
      publicSiteUrl: 'https://tanuhomes.com',
      notifyEmails: ['desk@tanuhomes.com'],
    });
    expect((await agent.get('/v1/org/settings').expect(200)).body.settings.publicOrigins).toEqual([
      'https://tanuhomes.com',
      'https://www.tanuhomes.com',
    ]);
  });

  it('rejects out-of-range hold minutes and a non-https site', async () => {
    const { agent } = await signInAs(t, 'admin', orgId);
    expect((await agent.patch('/v1/org/settings').send({ publicHoldMinutes: 5 })).status).toBe(400);
    expect(
      (await agent.patch('/v1/org/settings').send({ publicSiteUrl: 'http://tanuhomes.com' })).status,
    ).toBe(400);
  });

  it('front desk cannot change public settings', async () => {
    const { agent } = await signInAs(t, 'frontdesk', orgId);
    expect((await agent.patch('/v1/org/settings').send({ publicEnabled: true })).status).toBe(403);
  });

  it('unit publicListed toggles and shows on the unit', async () => {
    const unitId = await seedUnit(orgId, await seedProperty(orgId));
    const { agent } = await signInAs(t, 'admin', orgId);
    expect((await agent.get(`/v1/units/${unitId}`).expect(200)).body.publicListed).toBe(false);
    const r = await agent.patch(`/v1/units/${unitId}`).send({ publicListed: true });
    expect(r.status).toBe(200);
    expect(r.body.publicListed).toBe(true);
  });
});
