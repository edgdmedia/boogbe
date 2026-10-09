import { describe, expect, it } from 'vitest';
import { can, PERMISSIONS, ROLE_PERMISSIONS } from './permissions';
import { ORG_ROLES } from './enums';

describe('permissions', () => {
  it('admin has every permission', () => {
    for (const p of PERMISSIONS) expect(can('admin', p)).toBe(true);
  });
  it('frontdesk can take bookings and payments but not settings, owners or voids', () => {
    expect(can('frontdesk', 'bookings.write')).toBe(true);
    expect(can('frontdesk', 'payments.write')).toBe(true);
    expect(can('frontdesk', 'bookings.override')).toBe(true);
    expect(can('frontdesk', 'org.settings.write')).toBe(false);
    expect(can('frontdesk', 'owners.read')).toBe(false);
    expect(can('frontdesk', 'payments.void')).toBe(false);
    expect(can('frontdesk', 'members.write')).toBe(false);
  });
  it('housekeeper only touches own tasks', () => {
    expect(ROLE_PERMISSIONS.housekeeper).toEqual(['tasks.read_own', 'tasks.write_own', 'notifications.read']);
  });
  it('landlord only reads the portal', () => {
    expect(ROLE_PERMISSIONS.landlord).toEqual(['portal.read', 'notifications.read']);
  });
  it('every role maps only to known permissions', () => {
    for (const r of ORG_ROLES) for (const p of ROLE_PERMISSIONS[r]) expect(PERMISSIONS).toContain(p);
  });
});
