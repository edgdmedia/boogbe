import type { Listing, ListingPhoto, ListingUnit, PhotoCategory } from '@boogbe/shared';
import type { Listing as ListingRow, ListingPhoto as PhotoRow, Unit as UnitRow } from '@prisma/client';
import { kobo } from '../inventory/mappers';

type UnitWithProperty = UnitRow & { property: { active: boolean } };

export function toListingPhoto(r: PhotoRow): ListingPhoto {
  return {
    id: r.id,
    alt: r.alt,
    category: r.category as PhotoCategory,
    width: r.width,
    height: r.height,
    sortOrder: r.sortOrder,
    ready: r.variantsReady,
    // failed = the resize job gave up (T-WL-05 semantics).
    failed: !r.variantsReady && r.attempts >= 3,
    // Filled from MEDIA_PUBLIC_BASE once the photo pipeline lands (T-WL-05).
    previewUrl: null,
  };
}

/**
 * `bookable = active && publicListed && property active` (T-WL-04 Step 3) — a listing whose units
 * are all archived still maps fine; the site falls back to the rate card when none are bookable.
 */
export function toListing(row: ListingRow, units: UnitWithProperty[], photos: PhotoRow[]): Listing {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    area: row.area,
    highlight: row.highlight,
    intro: row.intro,
    description: row.description,
    amenities: row.amenities,
    houseRules: row.houseRules,
    bathroomsLabel: row.bathroomsLabel,
    layoutLabel: row.layoutLabel,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    published: row.published,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    coverPhotoId: row.coverPhotoId,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
    units: units.map<ListingUnit>((u) => ({
      id: u.id,
      name: u.name,
      label: u.listingLabel,
      nightlyRateKobo: kobo(u.nightlyRateKobo),
      maxGuests: u.maxGuests,
      bookable: u.active && u.publicListed && u.property.active,
    })),
    photos: photos.map(toListingPhoto),
  };
}
