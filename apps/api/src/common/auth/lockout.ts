export const LOCK_WINDOW_MS = 15 * 60_000;
export const LOCK_MAX_FAILURES = 5;

/** attempts: any order. Failures since the most recent success, within the window. */
export function isLocked(attempts: { success: boolean; createdAt: Date }[], now = new Date()): boolean {
  const recent = attempts
    .filter((a) => now.getTime() - a.createdAt.getTime() <= LOCK_WINDOW_MS)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  let failures = 0;
  for (const a of recent) {
    if (a.success) break;
    failures++;
  }
  return failures >= LOCK_MAX_FAILURES;
}
