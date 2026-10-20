import { z } from 'zod';
import { Kobo } from './common';

// Website listings (WL). The app's "Website → Listings" editor speaks these; the public
// /site payload reuses the same money rules (kobo integers on the wire).

// The fixed gallery categories, in the order the website groups them (plan deviation 1).
export const PHOTO_CATEGORIES = [
  'Living spaces',
  'Bedrooms',
  'Kitchen & dining',
  'Bathrooms',
  'Outdoor spaces',
  'Building & shared spaces',
  'Cinema & leisure',
  'Design details',
] as const;
export const PhotoCategory = z.enum(PHOTO_CATEGORIES);
export type PhotoCategory = z.infer<typeof PhotoCategory>;

const opt = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();

export const ListingSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single dashes')
  .max(60);

/** Turn a listing name into a URL slug: no accents or apostrophes, one dash between words, ≤ 60 chars. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

const Amenities = z.array(z.string().trim().min(1).max(60)).max(40);
const HouseRules = z.array(z.string().trim().min(1).max(200)).max(30);

export const ListingInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: opt(ListingSlug), // filled from the name on create when left empty
  area: opt(z.string().trim().max(80)),
  highlight: opt(z.string().trim().max(120)),
  intro: opt(z.string().trim().max(300)),
  description: opt(z.string().trim().max(4000)),
  amenities: Amenities.default([]),
  houseRules: HouseRules.default([]),
  bathroomsLabel: opt(z.string().trim().max(60)), // free text, e.g. "2 bathrooms · 3 toilets" (deviation 2)
  layoutLabel: opt(z.string().trim().max(60)), // empty lets the site derive it from the units
  seoTitle: opt(z.string().trim().max(70)),
  seoDescription: opt(z.string().trim().max(160)),
});
export type ListingInput = z.infer<typeof ListingInput>;

// The update must NOT re-apply the create-time defaults: a present `amenities: []` key would read
// as "clear the amenities" to the service. `.partial()` keeps defaults, so these two go optional-only.
export const ListingUpdate = ListingInput.omit({ amenities: true, houseRules: true })
  .partial()
  .extend({
    amenities: Amenities.optional(),
    houseRules: HouseRules.optional(),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  });
export type ListingUpdate = z.infer<typeof ListingUpdate>;

export const ListingUnitsInput = z
  .array(z.object({ unitId: z.string(), label: z.string().trim().max(40).nullable() }))
  .max(10);
export type ListingUnitsInput = z.infer<typeof ListingUnitsInput>;

export const ListingPhotoAttach = z.object({
  fileId: z.string(),
  alt: z.string().trim().max(200).default(''), // blank while editing; the publish blocker catches it
  category: PhotoCategory.default('Living spaces'),
});
export type ListingPhotoAttach = z.infer<typeof ListingPhotoAttach>;

export const ListingPhotoUpdate = z.object({ alt: z.string().trim().max(200).optional(), category: PhotoCategory.optional() });
export type ListingPhotoUpdate = z.infer<typeof ListingPhotoUpdate>;

/** A unit as the app editor shows it. Rates are kobo; `bookable` is active && publicListed && property active. */
export const ListingUnit = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string().nullable(),
  nightlyRateKobo: Kobo,
  maxGuests: z.number().int(),
  bookable: z.boolean(),
});
export type ListingUnit = z.infer<typeof ListingUnit>;

/** A photo as the app editor shows it. `failed` means the resize job gave up (attempts ≥ 3, not ready). */
export const ListingPhoto = z.object({
  id: z.string(),
  alt: z.string(),
  category: PhotoCategory,
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  sortOrder: z.number().int(),
  ready: z.boolean(),
  failed: z.boolean(),
  previewUrl: z.string().nullable(),
});
export type ListingPhoto = z.infer<typeof ListingPhoto>;

export const Listing = ListingInput.extend({
  id: z.string(),
  slug: ListingSlug,
  published: z.boolean(),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
  coverPhotoId: z.string().nullable(),
  sortOrder: z.number().int(),
  updatedAt: z.string().datetime({ offset: true }),
  units: z.array(ListingUnit),
  photos: z.array(ListingPhoto),
});
export type Listing = z.infer<typeof Listing>;

/**
 * Why publishing is refused, in this exact order (Global Constraints). Only ready photos count;
 * the alt blocker also fires while there are no ready photos at all — an empty gallery is
 * undescribed.
 */
export function publishBlockers(l: Pick<Listing, 'name' | 'intro' | 'description' | 'coverPhotoId' | 'units' | 'photos'>): string[] {
  const ready = l.photos.filter((p) => p.ready);
  const blockers: string[] = [];
  if (!l.name?.trim()) blockers.push('Add a name');
  if (!l.intro?.trim()) blockers.push('Add an intro');
  if (!l.description?.trim()) blockers.push('Add a description');
  if (ready.length < 3) blockers.push('Add at least 3 photos');
  if (!ready.length || ready.some((p) => !p.alt.trim())) blockers.push('Every photo needs a description');
  if (!l.coverPhotoId) blockers.push('Choose a cover photo');
  if (!l.units.length) blockers.push('Link at least one unit');
  return blockers;
}

// ───────────── Public /site payload (spec §5.6) ─────────────

/** `src` is the base URL without the `-<width>.webp` suffix; `widths` are the ready variant widths. */
export const SitePhoto = z.object({
  id: z.string(),
  alt: z.string(),
  category: PhotoCategory,
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  src: z.string(),
  widths: z.array(z.number().int()).min(1),
});
export type SitePhoto = z.infer<typeof SitePhoto>;

export const SiteUnit = z.object({
  id: z.string(),
  label: z.string().nullable(),
  bedrooms: z.number().int(),
  maxGuests: z.number().int(),
  nightlyRateKobo: Kobo,
  depositKobo: Kobo, // 0 when the unit has no deposit fee
  bookable: z.boolean(), // false everywhere when online booking is switched off
});
export type SiteUnit = z.infer<typeof SiteUnit>;

export const SiteListing = z.object({
  id: z.string(),
  slug: ListingSlug,
  oldSlugs: z.array(z.string()), // historical slugs of this listing — 301 sources; never the current one
  name: z.string(),
  area: z.string().nullable(),
  // The estate's full street address, from the first linked unit's property (T-WL-06b). The
  // apartment page shows it under 'Around your stay'; area alone broke the reference pixel parity.
  address: z.string().nullable(),
  highlight: z.string().nullable(),
  intro: z.string().nullable(),
  description: z.string().nullable(),
  amenities: z.array(z.string()),
  houseRules: z.array(z.string()),
  bathroomsLabel: z.string().nullable(),
  layoutLabel: z.string().nullable(),
  seo: z.object({ title: z.string().nullable(), description: z.string().nullable() }),
  units: z.array(SiteUnit),
  photos: z.array(SitePhoto),
  coverPhotoId: z.string().nullable(),
  updatedAt: z.string().datetime({ offset: true }),
});
export type SiteListing = z.infer<typeof SiteListing>;

export const SitePayload = z.object({
  version: z.number().int(),
  org: z.object({ name: z.string(), slug: z.string() }),
  listings: z.array(SiteListing),
});
export type SitePayload = z.infer<typeof SitePayload>;
