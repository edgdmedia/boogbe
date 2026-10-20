import { describe, expect, it } from 'vitest';
import {
  ListingInput,
  ListingPhotoAttach,
  ListingUnitsInput,
  ListingUpdate,
  PHOTO_CATEGORIES,
  SitePayload,
  publishBlockers,
  slugify,
} from './listings';

describe('listing contracts', () => {
  it('slugify lowercases, strips accents and apostrophes, collapses junk to dashes, caps at 60', () => {
    expect(slugify('Josephine’s Apartment (Ologolo)')).toBe('josephines-apartment-ologolo');
    expect(slugify('Château à Lekki!')).toBe('chateau-a-lekki');
    expect(slugify('  --Alaska   Homes--  ')).toBe('alaska-homes');
    expect(slugify('a'.repeat(70))).toBe('a'.repeat(60));
    // A cut at 60 must not leave a trailing dash.
    expect(slugify(`${'alaska'.repeat(12)} homes`)).toMatch(/^[a-z0-9-]+$/);
    expect(slugify('')).toBe('');
  });

  it('publishBlockers on an empty draft returns all seven messages, in order', () => {
    const blockers = publishBlockers({
      name: '',
      intro: null,
      description: null,
      coverPhotoId: null,
      units: [],
      photos: [],
    });
    expect(blockers).toEqual([
      'Add a name',
      'Add an intro',
      'Add a description',
      'Add at least 3 photos',
      'Every photo needs a description',
      'Choose a cover photo',
      'Link at least one unit',
    ]);
  });

  it('publishBlockers counts only ready photos and their alt text', () => {
    const unit = { id: 'u1', name: 'Destiny 1', label: '1 bedroom', nightlyRateKobo: 17_500_000, maxGuests: 2, bookable: true };
    const photo = (id: string, ready: boolean, alt: string) => ({
      id,
      alt,
      category: 'Bedrooms' as const,
      width: ready ? 1600 : null,
      height: ready ? 1000 : null,
      sortOrder: 0,
      ready,
      failed: false,
      previewUrl: ready ? `https://media.boogbe.com/org/o/listing/${id}-480.webp` : null,
    });
    const complete = {
      name: 'Destiny',
      intro: 'A calm two-bedroom.',
      description: 'Long description.',
      coverPhotoId: 'p1',
      units: [unit],
    };
    // The plan's Review case: 2 ready (described) + 1 still processing → the photos blocker only.
    expect(
      publishBlockers({
        ...complete,
        photos: [photo('p1', true, 'Bed'), photo('p2', true, 'Living'), photo('p3', false, '')],
      }),
    ).toEqual(['Add at least 3 photos']);
    // 3 ready but one blank alt → the alt blocker appears, and no others.
    expect(
      publishBlockers({
        ...complete,
        photos: [photo('p1', true, 'Bed'), photo('p2', true, 'Living'), photo('p3', true, '')],
      }),
    ).toEqual(['Every photo needs a description']);
    expect(
      publishBlockers({
        ...complete,
        photos: [photo('p1', true, 'Bed'), photo('p2', true, 'Living'), photo('p3', true, 'Kitchen')],
      }),
    ).toEqual([]);
  });

  it('ListingUnitsInput takes at most 10 entries, labels up to 40 chars', () => {
    const one = [{ unitId: 'u1', label: '1 bedroom' }];
    expect(ListingUnitsInput.safeParse(one).success).toBe(true);
    expect(ListingUnitsInput.safeParse([{ unitId: 'u1', label: null }]).success).toBe(true);
    expect(ListingUnitsInput.safeParse(Array.from({ length: 11 }, (_, i) => ({ unitId: `u${i}`, label: null }))).success).toBe(false);
    expect(ListingUnitsInput.safeParse([{ unitId: 'u1', label: 'x'.repeat(41) }]).success).toBe(false);
  });

  it('ListingInput bounds the text fields; ListingUpdate needs expectedUpdatedAt', () => {
    const base = { name: 'Destiny', intro: 'i', description: 'd' };
    expect(ListingInput.safeParse(base).success).toBe(true);
    expect(ListingInput.safeParse({ ...base, slug: 'Destiny' }).success).toBe(false); // uppercase is not a slug
    expect(ListingInput.safeParse({ ...base, description: 'd'.repeat(4001) }).success).toBe(false);
    expect(ListingInput.safeParse({ ...base, seoTitle: 'd'.repeat(71) }).success).toBe(false);
    expect(ListingInput.safeParse({ ...base, seoDescription: 'd'.repeat(161) }).success).toBe(false);
    expect(ListingInput.safeParse({ ...base, amenities: Array.from({ length: 41 }, () => 'a') }).success).toBe(false);
    expect(ListingUpdate.safeParse(base).success).toBe(false);
    expect(ListingUpdate.safeParse({ expectedUpdatedAt: '2026-10-20T10:00:00.000Z' }).success).toBe(true);
  });

  it('ListingPhotoAttach defaults alt and category', () => {
    expect(ListingPhotoAttach.safeParse({ fileId: 'f1' }).data).toEqual({ fileId: 'f1', alt: '', category: 'Living spaces' });
    expect(ListingPhotoAttach.safeParse({ fileId: 'f1', category: 'Garden' }).success).toBe(false);
  });

  it('PHOTO_CATEGORIES is the fixed list in order', () => {
    expect([...PHOTO_CATEGORIES]).toEqual([
      'Living spaces',
      'Bedrooms',
      'Kitchen & dining',
      'Bathrooms',
      'Outdoor spaces',
      'Building & shared spaces',
      'Cinema & leisure',
      'Design details',
    ]);
  });

  it('SitePayload validates the spec §5.6 shape', () => {
    const baseUnit = {
      id: 'u1',
      label: '1 bedroom',
      bedrooms: 1,
      maxGuests: 2,
      nightlyRateKobo: 17_500_000,
      depositKobo: 10_000_000,
      bookable: true,
    };
    const basePhoto = {
      id: 'ph1',
      alt: 'Bed',
      category: 'Bedrooms',
      width: 4032,
      height: 3024,
      src: 'https://media.boogbe.com/org/o1/listing/ph1',
      widths: [480, 800, 1600, 2400],
    };
    const baseListing = {
      id: 'l1',
      slug: 'destiny',
      oldSlugs: ['destiny-ikate'],
      name: 'Destiny',
      area: 'Ikate, Lekki',
      highlight: 'Sea breeze',
      intro: 'A calm two-bedroom.',
      description: '…',
      amenities: ['24/7 power'],
      houseRules: ['No smoking'],
      bathroomsLabel: '2 bathrooms · 3 toilets',
      layoutLabel: null,
      seo: { title: null, description: null },
      units: [baseUnit],
      photos: [basePhoto],
      coverPhotoId: 'ph1',
      updatedAt: '2026-10-20T10:00:00.000Z',
    };
    const payload = { version: 42, org: { name: 'Tanuhomes', slug: 'tanuhomes' }, listings: [baseListing] };
    expect(SitePayload.safeParse(payload).success).toBe(true);
    expect(
      SitePayload.safeParse({ ...payload, listings: [{ ...baseListing, photos: [{ ...basePhoto, category: 'Garden' }] }] }).success,
    ).toBe(false);
    // Money on the wire is kobo integers, never floats.
    expect(
      SitePayload.safeParse({ ...payload, listings: [{ ...baseListing, units: [{ ...baseUnit, nightlyRateKobo: 1.5 }] }] }).success,
    ).toBe(false);
  });
});
