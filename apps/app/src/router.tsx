import type { ReactNode } from 'react';
import { CalendarDays, Settings, ShieldCheck, Users } from 'lucide-react';
import { createBrowserRouter, Outlet } from 'react-router-dom';
import { EmptyState } from '@boogbe/ui';
import { AppShell, type NavItem } from './components/shell/AppShell';
import { RequireAuth } from './components/shell/RequireAuth';
import { RoleLanding } from './components/shell/RoleLanding';
import { SignIn } from './routes/auth/SignIn';
import { AcceptInvite } from './routes/auth/AcceptInvite';
import { ForgotPassword } from './routes/auth/ForgotPassword';
import { ResetPassword } from './routes/auth/ResetPassword';
import { Home } from './routes/Home';
import { NotFound } from './routes/NotFound';
import { OperatorsList } from './routes/platform/OperatorsList';
import { CreateOperator } from './routes/platform/CreateOperator';
import { OperatorDetail } from './routes/platform/OperatorDetail';
import { Team } from './routes/settings/Team';
import { Sessions } from './routes/settings/Sessions';
import { OrgProfile } from './routes/settings/OrgProfile';
import { ChooseOperator } from './routes/ChooseOperator';

/** Later milestones append to these arrays; keep one source of truth for nav. */
export const OPERATOR_NAV: NavItem[] = [
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, permission: 'calendar.read' },
  { to: '/settings/team', label: 'Team', icon: Users, permission: 'members.write' },
  { to: '/settings', label: 'Settings', icon: Settings, permission: 'org.settings.read' },
];
const PLATFORM_NAV: NavItem[] = [{ to: '/platform', label: 'Operators', icon: ShieldCheck }];

const operator = (children: ReactNode) => <AppShell nav={OPERATOR_NAV}>{children}</AppShell>;

export const router = createBrowserRouter([
  { path: '/auth/sign-in', element: <SignIn /> },
  { path: '/auth/accept-invite/:id', element: <AcceptInvite /> },
  { path: '/auth/forgot', element: <ForgotPassword /> },
  { path: '/auth/reset', element: <ResetPassword /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <RoleLanding /> },
      { path: '/choose-operator', element: <ChooseOperator /> },
      {
        path: '/no-access',
        element: (
          <main className="p-8">
            <EmptyState title="No operator yet" body="Ask your operator to invite you." />
          </main>
        ),
      },
      { path: '/calendar', element: operator(<Home />) },
      { path: '/settings', element: operator(<OrgProfile />) },
      { path: '/settings/team', element: operator(<Team />) },
      { path: '/settings/sessions', element: operator(<Sessions />) },
      {
        path: '/hk',
        element: (
          <main className="p-4">
            <EmptyState title="Your tasks will appear here" />
          </main>
        ),
      },
      {
        path: '/owner',
        element: (
          <main className="p-4">
            <EmptyState title="Your statements will appear here" />
          </main>
        ),
      },
    ],
  },
  {
    element: <RequireAuth platform />,
    children: [
      {
        element: (
          <AppShell nav={PLATFORM_NAV}>
            <Outlet />
          </AppShell>
        ),
        children: [
          { path: '/platform', element: <OperatorsList /> },
          { path: '/platform/new', element: <CreateOperator /> },
          { path: '/platform/operators/:id', element: <OperatorDetail /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
]);
