import { MeResponse } from '@boogbe/shared';
import { useApi } from './api';

export function useMe() {
  const { data, isLoading, mutate, error } = useApi('/v1/me', MeResponse);
  // "Loading" means we have no answer yet. SWR also reports loading while it re-checks a cached 401 (window
  // focus, retries); treating that as loading swapped the sign-in form for a spinner and wiped what was typed.
  return { me: data, isLoading: isLoading && !error, mutate, error };
}
