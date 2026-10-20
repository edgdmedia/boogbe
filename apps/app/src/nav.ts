import {
  BookOpen,
  Building2,
  CalendarDays,
  Contact,
  Globe,
  MonitorSmartphone,
  ScrollText,
  Settings,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import type { NavItem } from './components/shell/AppShell';

/**
 * One source of truth for nav; later milestones append here.
 * `tab` = the phone bottom bar; `section: 'settings'` = the settings side nav (one "Settings" entry in the sidebar).
 */
export const OPERATOR_NAV: NavItem[] = [
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, permission: 'calendar.read', tab: true },
  { to: '/bookings', label: 'Bookings', icon: BookOpen, permission: 'bookings.read', tab: true },
  { to: '/guests', label: 'Guests', icon: Contact, permission: 'guests.read', tab: true },
  { to: '/money', label: 'Money', icon: Wallet, permission: 'payments.read', tab: true },
  { to: '/conflicts', label: 'Conflicts', icon: TriangleAlert, permission: 'bookings.read' },
  { to: '/website/listings', label: 'Website', icon: Globe, permission: 'inventory.read', section: 'setup' },
  { to: '/settings', label: 'Business', icon: Settings, permission: 'org.settings.read', section: 'settings', end: true },
  { to: '/settings/properties', label: 'Properties', icon: Building2, permission: 'inventory.read', section: 'settings' },
  { to: '/settings/owners', label: 'Owners', icon: UserRound, permission: 'owners.read', section: 'settings' },
  { to: '/settings/team', label: 'Team', icon: Users, permission: 'members.write', section: 'settings' },
  { to: '/settings/online-booking', label: 'Online booking', icon: Globe, permission: 'org.settings.write', section: 'settings' },
  { to: '/settings/audit', label: 'Audit log', icon: ScrollText, permission: 'audit.read', section: 'settings' },
  { to: '/settings/sessions', label: 'Signed-in devices', icon: MonitorSmartphone, section: 'settings' },
];

export const PLATFORM_NAV: NavItem[] = [{ to: '/platform', label: 'Operators', icon: ShieldCheck, tab: true }];
