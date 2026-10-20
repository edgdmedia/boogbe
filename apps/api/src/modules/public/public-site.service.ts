import { Injectable } from '@nestjs/common';
import type { PhotoCategory, SitePayload } from '@boogbe/shared';
import { SitePayload as SitePayloadSchema } from '@boogbe/shared';
import { OrgDb } from '../../common/db/org-db.service';
import { loadEnv } from '../../env';
import type { PublicSite } from './public-org.service';

/**
 * Builds the whole versioned site payload (spec §5.6): published listings in sort order, ready
 * photos only, unit rates/deposits, historical slugs. Money in kobo. Nothing member-, guest- or
 * note-shaped is ever read into it. Runs entirely under the org's RLS context.
 */
@Injectable()
export class PublicSiteService {
  private readonly mediaBase: string = loadEnv().MEDIA_PUBLIC_BASE ?? '';

  constructor(private readonly orgDb: OrgDb) {}

  /** The org's current site_version; bigint on the DB, a plain number on the wire. */
  version(orgId: string): Promise<number> {
    return this.orgDb.run(orgId, async (tx) => {
      const s = await tx.orgSettings.findFirstOrThrow();
      return Number(s.siteVersion);
    });
  }

  async payload(org: PublicSite, slug: string): Promise<SitePayload> {
    return this.orgDb.run(org.orgId, async (tx) => {
      const [settings, orgRow] = await Promise.all([
        tx.orgSettings.findFirstOrThrow(),
        tx.organization.findFirst({ where: { id: org.orgId }, select: { name: true } }),
      ]);
      const listings = await tx.listing.findMany({
        where: { published: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      const listingIds = listings.map((l) => l.id);
      const units = await tx.unit.findMany({
        where: { listingId: { in: listingIds } },
        include: { property: { select: { active: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      // The same source the quote uses: the unit's active caution-deposit fees.
      const deposits = await tx.unitFee.findMany({
        where: { unitId: { in: units.map((u) => u.id) }, kind: 'caution_deposit', active: true },
      });
      const photos = await tx.listingPhoto.findMany({
        where: { listingId: { in: listingIds }, variantsReady: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      const history = await tx.listingSlugHistory.findMany({ where: { listingId: { in: listingIds } } });

      return SitePayloadSchema.parse({
        version: Number(settings.siteVersion),
        org: { name: orgRow?.name ?? '', slug },
        listings: listings.map((l) => ({
          id: l.id,
          slug: l.slug,
          // Redirect sources: this listing's old slugs, never its current one.
          oldSlugs: history.filter((h) => h.listingId === l.id && h.slug !== l.slug).map((h) => h.slug),
          name: l.name,
          area: l.area,
          highlight: l.highlight,
          intro: l.intro,
          description: l.description,
          amenities: l.amenities,
          houseRules: l.houseRules,
          bathroomsLabel: l.bathroomsLabel,
          layoutLabel: l.layoutLabel,
          seo: { title: l.seoTitle, description: l.seoDescription },
          units: units
            .filter((u) => u.listingId === l.id)
            .map((u) => ({
              id: u.id,
              label: u.listingLabel,
              bedrooms: u.bedrooms,
              maxGuests: u.maxGuests,
              nightlyRateKobo: Number(u.nightlyRateKobo),
              depositKobo: Number(
                deposits.filter((d) => d.unitId === u.id).reduce((sum, d) => sum + d.amountKobo, 0n),
              ),
              // Booking off keeps the page up with bookable=false (review focus 5); archived units
              // stay listed so the page still shows a rate (review focus 2).
              bookable: org.publicEnabled && u.active && u.publicListed && u.property.active,
            })),
          photos: photos
            .filter((p) => p.listingId === l.id)
            .map((p) => ({
              id: p.id,
              alt: p.alt,
              category: p.category as PhotoCategory,
              width: p.width,
              height: p.height,
              src: `${this.mediaBase}/org/${org.orgId}/listing/${p.id}`,
              widths: p.variants,
            })),
          coverPhotoId: l.coverPhotoId,
          updatedAt: l.updatedAt.toISOString(),
        })),
      });
    });
  }
}
