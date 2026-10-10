import { Navigate } from 'react-router-dom';
import type { MeResponse } from '@boogbe/shared';
import { Spinner } from '@boogbe/ui';
import { useMe } from '../../lib/use-me';

// A platform admin who is also a member lands in their org; /platform stays reachable from the nav.
export function landingPath(me: MeResponse): string {
  if (me.activeOrg) {
    return { admin: '/calendar', frontdesk: '/calendar', housekeeper: '/hk', landlord: '/owner' }[me.activeOrg.role];
  }
  if (me.memberships.length) return '/choose-operator';
  if (me.user.isPlatformAdmin) return '/platform';
  return '/no-access';
}

export function RoleLanding() {
  const { me } = useMe();
  if (!me) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }
  return <Navigate to={landingPath(me)} replace />;
}
