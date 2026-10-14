import useSWR from 'swr';
import type { ZodType } from 'zod';
import type { ErrorCode } from '@boogbe/shared';

const ORIGIN = import.meta.env.VITE_API_ORIGIN ?? '';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; schema?: ZodType<T> } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ORIGIN}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError('INTERNAL', 'Network problem — check your connection and try again.', 0);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(e?.code ?? 'INTERNAL', e?.message ?? 'Something went wrong', res.status, e?.details);
  }
  return init.schema ? init.schema.parse(json) : (json as T);
}

export function useApi<T>(path: string | null, schema?: ZodType<T>) {
  return useSWR<T, ApiError>(path, (p: string) => api<T>(p, { schema }));
}
