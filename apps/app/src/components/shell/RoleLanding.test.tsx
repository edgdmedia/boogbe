import { describe, expect, it } from 'vitest';
import type { MeResponse } from '@boogbe/shared';
import { landingPath } from './RoleLanding';

const base: MeResponse = {
  user: { id: 'u', name: 'U', email: 'u@x', isPlatformAdmin: false },
  activeOrg: null,
  memberships: [],
};
const org = (role: MeResponse['memberships'][number]['role']) => ({
  ...base,
  activeOrg: { id: 'o', name: 'T', slug: 't', role, timezone: 'Africa/Lagos', currency: 'NGN' },
  memberships: [{ orgId: 'o', orgName: 'T', role }],
});

describe('landingPath', () => {
  it('routes each role to its area', () => {
    expect(landingPath(org('admin'))).toBe('/calendar');
    expect(landingPath(org('frontdesk'))).toBe('/calendar');
    expect(landingPath(org('housekeeper'))).toBe('/hk');
    expect(landingPath(org('landlord'))).toBe('/owner');
  });
  it('platform admin without an org goes to /platform', () => {
    expect(landingPath({ ...base, user: { ...base.user, isPlatformAdmin: true } })).toBe('/platform');
  });
  it('member without active org picks one; nobody else gets /no-access', () => {
    expect(landingPath({ ...base, memberships: [{ orgId: 'o', orgName: 'T', role: 'admin' }] })).toBe(
      '/choose-operator',
    );
    expect(landingPath(base)).toBe('/no-access');
  });
});
