import type { ReactNode } from 'react';
import { createBrowserRouter, Outlet } from 'react-router-dom';
import { FileText, KeyRound, Sparkles } from 'lucide-react';
import { EmptyState } from '@boogbe/ui';
import { AppShell } from './components/shell/AppShell';
import { SettingsLayout } from './components/shell/SettingsLayout';
import { OPERATOR_NAV, PLATFORM_NAV } from './nav';
import { RequireAuth } from './components/shell/RequireAuth';
import { RoleLanding } from './components/shell/RoleLanding';
import { SignIn } from './routes/auth/SignIn';
import { AcceptInvite } from './routes/auth/AcceptInvite';
import { ForgotPassword } from './routes/auth/ForgotPassword';
import { ResetPassword } from './routes/auth/ResetPassword';
import { PropertiesPage } from './features/inventory/PropertiesPage';
import { PropertyDetail } from './features/inventory/PropertyDetail';
import { OwnersPage } from './features/inventory/OwnersPage';
import { BookingsPage } from './features/bookings/BookingsPage';
import { BookingDetail } from './features/bookings/BookingDetail';
import { NewBookingPage } from './features/bookings/NewBookingPage';
import { GuestsPage } from './features/guests/GuestsPage';
import { ConflictsPage } from './features/ical/ConflictsPage';
import { GuestDetail } from './features/guests/GuestDetail';
import { NotFound } from './routes/NotFound';
import { CalendarPage } from './features/calendar/CalendarPage';
import { OperatorsList } from './routes/platform/OperatorsList';
import { CreateOperator } from './routes/platform/CreateOperator';
import { OperatorDetail } from './routes/platform/OperatorDetail';
import { Team } from './routes/settings/Team';
import { Sessions } from './routes/settings/Sessions';
import { AuditLog } from './routes/settings/AuditLog';
import { OrgProfile } from './routes/settings/OrgProfile';
import { OnlineBooking } from './routes/settings/OnlineBooking';
import { MoneyPage } from './features/payments/MoneyPage';
import { ChooseOperator } from './routes/ChooseOperator';

const operator = (children: ReactNode) => <AppShell nav={OPERATOR_NAV}>{children}</AppShell>;
const settings = (children: ReactNode) => operator(<SettingsLayout nav={OPERATOR_NAV}>{children}</SettingsLayout>);

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
          <main className="grid min-h-dvh place-items-center bg-surface-2 p-6">
            <EmptyState icon={<KeyRound />} title="No operator yet" body="Ask your operator to invite you." />
          </main>
        ),
      },
      { path: '/calendar', element: operator(<CalendarPage />) },
      { path: '/settings', element: settings(<OrgProfile />) },
      { path: '/settings/team', element: settings(<Team />) },
      { path: '/settings/online-booking', element: settings(<OnlineBooking />) },
      { path: '/settings/sessions', element: settings(<Sessions />) },
      { path: '/settings/audit', element: settings(<AuditLog />) },
      { path: '/settings/properties', element: settings(<PropertiesPage />) },
      { path: '/settings/properties/:id', element: settings(<PropertyDetail />) },
      { path: '/settings/owners', element: settings(<OwnersPage />) },
      { path: '/money', element: operator(<MoneyPage />) },
      { path: '/bookings', element: operator(<BookingsPage />) },
      { path: '/bookings/new', element: operator(<NewBookingPage />) },
      { path: '/bookings/:id', element: operator(<BookingDetail />) },
      { path: '/guests', element: operator(<GuestsPage />) },
      { path: '/conflicts', element: operator(<ConflictsPage />) },
      { path: '/guests/:id', element: operator(<GuestDetail />) },
      {
        path: '/hk',
        element: (
          <main className="grid min-h-dvh place-items-center bg-surface-2 p-6">
            <EmptyState icon={<Sparkles />} title="Your tasks will appear here" />
          </main>
        ),
      },
      {
        path: '/owner',
        element: (
          <main className="grid min-h-dvh place-items-center bg-surface-2 p-6">
            <EmptyState icon={<FileText />} title="Your statements will appear here" />
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
