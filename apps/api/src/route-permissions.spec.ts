import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ACCESS_KEY } from './common/auth/decorators';

describe('route permissions [AUTH-09]', () => {
  it('every route handler declares exactly one access rule', async () => {
    process.env.DATABASE_URL ??= 'postgresql://x:y@localhost:1/none';
    process.env.BETTER_AUTH_SECRET ??= 'x'.repeat(40);
    process.env.BETTER_AUTH_URL ??= 'http://localhost:5173';
    process.env.APP_ORIGIN ??= 'http://localhost:5173';
    const mod = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] }).compile();
    const discovery = mod.get(DiscoveryService);
    const scanner = mod.get(MetadataScanner);
    const reflector = mod.get(Reflector);
    const missing: string[] = [];
    for (const c of discovery.getControllers()) {
      const proto = Object.getPrototypeOf(c.instance);
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = proto[name];
        if (!Reflect.getMetadata('path', handler) && Reflect.getMetadata('path', handler) !== '') continue;
        const rule = reflector.getAllAndOverride(ACCESS_KEY, [handler, c.metatype as never]);
        if (!rule) missing.push(`${c.name}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
