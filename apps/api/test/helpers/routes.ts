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
