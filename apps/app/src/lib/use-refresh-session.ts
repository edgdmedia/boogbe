import { useSWRConfig } from 'swr';
import { MeResponse } from '@boogbe/shared';
import { api } from './api';

/**
 * After signing in, everything cached so far was fetched signed out — including a 401 for /v1/me that would make
 * RequireAuth bounce straight back to sign-in (T-M2-13). Drops it all and loads the session; throws if that fails.
 */
export function useRefreshSession() {
  const { mutate } = useSWRConfig();
  return async (): Promise<MeResponse | undefined> => {
    await mutate((key) => key !== '/v1/me', undefined, { revalidate: false });
    return mutate('/v1/me', api('/v1/me', { schema: MeResponse }), { revalidate: false });
  };
}
