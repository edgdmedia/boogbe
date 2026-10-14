/**
 * Where to go after sign-in: only an in-app path. Anything that could leave the app (`//host`, `/\host`, a scheme)
 * or loop back into the auth pages falls back to `/`.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  if (/[\\\s]/.test(next)) return '/';
  if (next === '/auth' || next.startsWith('/auth/')) return '/';
  return next;
}
