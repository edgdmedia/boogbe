import { migratorClient } from './db';
import { newId } from '../../src/common/db/ids';
import { seedGuest, seedOwner, seedProperty, seedUnit } from './inventory';
import type { INestApplication } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { ACCESS_KEY, type AccessRule } from '../../src/common/auth/decorators';

export function listRoutes(app: INestApplication) {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const out: { method: string; path: string; access: AccessRule }[] = [];
  const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  for (const c of discovery.getControllers()) {
    const base = Reflect.getMetadata('path', c.metatype) as string;
    const proto = Object.getPrototypeOf(c.instance);
    for (const name of scanner.getAllMethodNames(proto)) {
      const h = proto[name];
      const sub = Reflect.getMetadata('path', h) as string | undefined;
      if (sub === undefined) continue;
      const method = METHODS[Reflect.getMetadata('method', h) as number]!;
      const access = reflector.getAllAndOverride<AccessRule>(ACCESS_KEY, [h, c.metatype]);
      out.push({
        method,
        path: `/v1/${[base, sub].filter((s) => s && s !== '/').join('/')}`.replace(/\/+/g, '/'),
        access,
      });
    }
  }
  return out;
}

/** Later milestones add an entry per resource: given an org id, create a resource in that org and return its id. */
export const ISOLATION_FIXTURES: Record<string, (orgId: string) => Promise<string>> = {};
/** Maps a route param name to the fixture that produces a valid id for it. */
export const PARAM_FIXTURE: Record<string, string> = {};
/** Path-specific fixtures, checked before PARAM_FIXTURE, for generic params like `:id`. */
export const ROUTE_FIXTURE: { match: RegExp; fixture: string }[] = [];

ISOLATION_FIXTURES.owner = (orgId) => seedOwner(orgId);
ISOLATION_FIXTURES.property = (orgId) => seedProperty(orgId);
ISOLATION_FIXTURES.unit = async (orgId) => seedUnit(orgId, await seedProperty(orgId));
ISOLATION_FIXTURES.file = async (orgId) => {
  const m = await migratorClient();
  const id = newId();
  await m.query(
    `insert into file(id, org_id, key, kind, content_type, size_bytes, confirmed) values ($1,$2,$3,'logo','image/png',10,true)`,
    [id, orgId, `org/${orgId}/logo/${id}.png`],
  );
  await m.end();
  return id;
};
ROUTE_FIXTURE.push(
  { match: /^\/v1\/owners\//, fixture: 'owner' },
  { match: /^\/v1\/properties\//, fixture: 'property' },
  { match: /^\/v1\/units\//, fixture: 'unit' },
  { match: /^\/v1\/files\//, fixture: 'file' },
  { match: /^\/v1\/fees\//, fixture: 'fee' },
  { match: /^\/v1\/blocks\//, fixture: 'block' },
  { match: /^\/v1\/guests\//, fixture: 'guest' },
);
ISOLATION_FIXTURES.guest = (orgId) => seedGuest(orgId);
ISOLATION_FIXTURES.fee = async (orgId) => {
  const unitId = await seedUnit(orgId, await seedProperty(orgId));
  const m = await migratorClient();
  const id = newId();
  await m.query(
    `insert into unit_fee(id, org_id, unit_id, kind, label, amount_kobo, basis, updated_at) values ($1,$2,$3,'cleaning','Cleaning',100,'per_stay',now())`,
    [id, orgId, unitId],
  );
  await m.end();
  return id;
};
ISOLATION_FIXTURES.block = async (orgId) => {
  const unitId = await seedUnit(orgId, await seedProperty(orgId));
  const m = await migratorClient();
  const id = newId();
  await m.query(
    `insert into block(id, org_id, unit_id, start, "end", source, reason, updated_at) values ($1,$2,$3,'2030-01-01','2030-01-02','manual','maintenance',now())`,
    [id, orgId, unitId],
  );
  await m.end();
  return id;
};
