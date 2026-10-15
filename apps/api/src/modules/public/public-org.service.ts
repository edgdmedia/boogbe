import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/db/prisma.service';
import type { OrgTx } from '../../common/db/org-db.service';
import { AppError } from '../../common/http/app-error';
import { cacheGet, cacheSet, clearPublicOrgCache } from './public-org-cache';

export interface PublicOrg {
  orgId: string;
  timezone: string;
  origins: string[];
  holdMinutes: number;
}

/** Unknown, suspended, switched-off orgs and unlisted units all look the same, so slugs can't be probed. */
export const unavailable = () => new AppError('UNAVAILABLE', 404, 'Online booking is not available');

/** Same rule operators are created with (contracts/platform.ts `Slug`): anything else can't exist, so no lookup. */
const SLUG = /^[a-z0-9-]{3,40}$/;

/** Resolves `/v1/public/:slug` to an org. The only cross-org read public routes make (SECURITY DEFINER lookup, 0008). */
@Injectable()
export class PublicOrgService {
  constructor(private readonly prisma: PrismaService) {}

  async find(rawSlug: string): Promise<PublicOrg | null> {
    const slug = rawSlug.toLowerCase(); // slugs are stored lowercase; the lookup is an exact match
    if (!SLUG.test(slug)) return null;
    const hit = cacheGet<PublicOrg | null>(slug);
    if (hit) return hit.value;
    const [row] = await this.prisma.$queryRaw<
      { org_id: string; timezone: string; public_origins: string[]; public_hold_minutes: number }[]
    >`SELECT * FROM public_org_lookup(${slug})`;
    const org = row
      ? { orgId: row.org_id, timezone: row.timezone, origins: row.public_origins, holdMinutes: row.public_hold_minutes }
      : null;
    cacheSet(slug, org);
    return org;
  }

  async resolve(slug: string): Promise<PublicOrg> {
    const org = await this.find(slug);
    if (!org) throw unavailable();
    return org;
  }

  /** Tests: settings changed in the database must be seen at once. */
  clearCache() {
    clearPublicOrgCache();
  }

  async listedUnit(tx: OrgTx, unitId: string) {
    const unit = await tx.unit.findFirst({
      where: { id: unitId, active: true, publicListed: true, property: { active: true } },
      include: { property: true },
    });
    if (!unit) throw unavailable();
    return unit;
  }
}
