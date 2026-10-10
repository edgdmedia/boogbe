import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { ISOLATION_FIXTURES, listRoutes, PARAM_FIXTURE } from './helpers/routes';

describe('cross-tenant isolation [NFR-01]', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await truncateAll();
  });
  afterAll(async () => {
    await t.close();
  });

  it('an admin of org A gets 404 for every org-B resource on every permission route', async () => {
    const a = await seedOrg('A');
    const b = await seedOrg('B');
    const { agent } = await signInAs(t, 'admin', a.id);
    const routes = listRoutes(t.app).filter((r) => r.access?.kind === 'permission' && /:\w+/.test(r.path));
    const leaks: string[] = [];
    const unmapped: string[] = [];
    for (const r of routes) {
      let path = r.path;
      for (const [, param] of r.path.matchAll(/:(\w+)/g)) {
        const fixture = PARAM_FIXTURE[param!];
        if (!fixture) {
          unmapped.push(`${r.method} ${r.path} (:${param})`);
          continue;
        }
        path = path.replace(`:${param}`, await ISOLATION_FIXTURES[fixture]!(b.id));
      }
      if (/:\w+/.test(path)) continue;
      const res = await agent[r.method.toLowerCase() as 'get'](path).send({});
      if (![400, 404].includes(res.status)) leaks.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(unmapped, 'Register a fixture in test/helpers/routes.ts for these params').toEqual([]);
    expect(leaks).toEqual([]);
  });
});
