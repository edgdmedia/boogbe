import { MeResponse } from '@boogbe/shared';
import { useApi } from './api';

export function useMe() {
  const { data, isLoading, mutate, error } = useApi('/v1/me', MeResponse);
  return { me: data, isLoading, mutate, error };
}
