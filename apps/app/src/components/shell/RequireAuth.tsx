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
    return <Navigate to={`/auth/sign-in?next=${encodeURIComponent(loc.pathname)}`} replace />;
  }
  if (platform && !me.user.isPlatformAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}
