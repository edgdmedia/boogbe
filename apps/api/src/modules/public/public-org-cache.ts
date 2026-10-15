/**
 * Per-process cache of slug → public org lookups (hits and misses). A plain module store, not a provider, so the
 * org settings service can drop an entry when an admin changes online-booking settings without a module cycle.
 */
const TTL_MS = 30_000;
const MAX_ENTRIES = 500;
const entries = new Map<string, { at: number; value: unknown }>();

export function cacheGet<T>(slug: string): { value: T } | undefined {
  const e = entries.get(slug);
  if (!e) return undefined;
  if (Date.now() - e.at >= TTL_MS) {
    entries.delete(slug);
    return undefined;
  }
  return { value: e.value as T };
}

export function cacheSet(slug: string, value: unknown) {
  entries.delete(slug);
  // Maps keep insertion order: drop the oldest entry, so a burst of junk slugs can't flush real operators.
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  entries.set(slug, { at: Date.now(), value });
}

/** Settings changed: the next public request for this slug reads the database again. */
export function forgetPublicOrg(slug: string) {
  entries.delete(slug.toLowerCase());
}

export function clearPublicOrgCache() {
  entries.clear();
}
