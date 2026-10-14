import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@boogbe/ui';
import { useMe } from '../../lib/use-me';

export function RequireAuth({ platform = false }: { platform?: boolean }) {
  const { me, isLoading, error } = useMe();
  const loc = useLocation();
  if (isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }
  if (error?.status === 401 || !me) {
    // keep the query in `next` so deep links like /bookings/new?unitId=… survive the round-trip
    return <Navigate to={`/auth/sign-in?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  if (platform && !me.user.isPlatformAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}
