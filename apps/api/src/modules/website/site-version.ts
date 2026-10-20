import type { OrgTx } from '../../common/db/org-db.service';

/**
 * Bump the org's `site_version` — the number the public website cache keys on (spec §4).
 * Every write that changes what `/site` outputs calls this **inside the same transaction**
 * (Global Constraints); nothing else may bump it. Raw SQL: org_settings is RLS-guarded, and
 * `app_current_org()` keeps the update tenant-scoped under the transaction's org context.
 */
export async function bumpSiteVersion(tx: OrgTx): Promise<void> {
  await tx.$executeRaw`UPDATE org_settings SET site_version = site_version + 1 WHERE org_id = app_current_org()`;
}

/** Inventory writes only concern the website when the unit is linked to a listing. */
export function siteRelevant(unit: { listingId: string | null }): boolean {
  return unit.listingId !== null;
}
