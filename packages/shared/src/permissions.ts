import type { OrgRole } from './enums';

export const PERMISSIONS = [
  'org.settings.read',
  'org.settings.write',
  'members.read',
  'members.write',
  'inventory.read',
  'inventory.write',
  'calendar.read',
  'bookings.read',
  'bookings.write',
  'bookings.override',
  'guests.read',
  'guests.write',
  'payments.read',
  'payments.write',
  'payments.void',
  'ical.read',
  'ical.write',
  'messages.read',
  'messages.send',
  'templates.read',
  'templates.write',
  'tasks.read',
  'tasks.write',
  'tasks.read_own',
  'tasks.write_own',
  'owners.read',
  'owners.write',
  'expenses.read',
  'expenses.write',
  'statements.read',
  'statements.write',
  'portal.read',
  'audit.read',
  'notifications.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  admin: PERMISSIONS,
  frontdesk: [
    'org.settings.read',
    'inventory.read',
    'calendar.read',
    'bookings.read',
    'bookings.write',
    'bookings.override',
    'guests.read',
    'guests.write',
    'payments.read',
    'payments.write',
    'ical.read',
    'messages.read',
    'messages.send',
    'templates.read',
    'tasks.read',
    'tasks.write',
    'notifications.read',
  ],
  housekeeper: ['tasks.read_own', 'tasks.write_own', 'notifications.read'],
  landlord: ['portal.read', 'notifications.read'],
};

export function can(role: OrgRole, p: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(p);
}
