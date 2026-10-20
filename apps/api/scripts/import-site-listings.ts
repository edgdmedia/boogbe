/**
 * Usage: pnpm --filter @boogbe/api exec tsx scripts/import-site-listings.ts <org id|slug> <path to tanuhomes repo> [--dry-run]
 *
 * Imports today's website content (src/content/properties/*.json) into Boogbe website listings
 * (plan Task 9). One listing per file, unpublished for review; photos in gallery order from the
 * repo's 1600 px WebPs (the best copy we hold), originals stored confirmed so the resize job
 * builds the variants; unit links and labels from `boogbe.units`. Idempotent: photos carry
 * source_ref '<slug>/<file>', and the property note block is appended once. --dry-run reads and
 * reports without writing. Publishing stays a human action in the app (T-WL-12).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { loadDotEnv, loadEnv } from '../src/env';
import { AppModule } from '../src/app.module';
import { OrgDb } from '../src/common/db/org-db.service';
import { PrismaService } from '../src/common/db/prisma.service';
import { newId } from '../src/common/db/ids';
import { STORAGE, type Storage } from '../src/common/files/storage';
import type { OrgCtx } from '../src/common/auth/request-ctx';
import { ListingsService } from '../src/modules/website/listings.service';
import { ListingPhotosService } from '../src/modules/website/listing-photos.service';
import { bumpSiteVersion } from '../src/modules/website/site-version';

interface SiteGalleryImage {
  id: number;
  file: string;
  category: string;
  alt: string;
  width?: number;
  height?: number;
}

interface SiteProperty {
  name: string;
  slug: string;
  status: string;
  service?: string;
  area?: string | null;
  feature?: string | null;
  intro?: string | null;
  description?: string | null;
  amenities?: string[];
  notes?: string[];
  bathrooms?: number | string | null;
  config?: string | null;
  hero: number;
  gallery: SiteGalleryImage[];
  rates?: { label: string; amount: number | null }[];
  seo?: { title?: string; description?: string };
  boogbe?: { units: { label: string; unitId: string }[] };
}

export interface ImportDeps {
  orgId: string;
  repoPath: string;
  dryRun: boolean;
  listings: ListingsService;
  photos: ListingPhotosService;
  storage: Storage;
  orgDb: OrgDb;
}

export interface ImportResult {
  lines: string[];
  errors: string[];
}

const NOTES_MARKER = '[website import]';

/** The site derives '1 bedroom' / '2 bedrooms' / '1 or 2 bedrooms' from the units (plan deviation 2). */
function derivedLayout(bedrooms: number[]): string {
  const min = Math.min(...bedrooms);
  const max = Math.max(...bedrooms);
  if (min === max) return min === 1 ? '1 bedroom' : `${min} bedrooms`;
  return `${min} or ${max} bedrooms`;
}

export async function importSiteListings(d: ImportDeps): Promise<ImportResult> {
  const lines: string[] = [];
  const errors: string[] = [];
  const ctx = {
    orgId: d.orgId,
    role: 'admin',
    memberId: null,
    timezone: 'Africa/Lagos',
    userId: 'website-import',
  } as unknown as OrgCtx;

  const dir = join(d.repoPath, 'src/content/properties');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  for (const file of files) {
    const p = JSON.parse(readFileSync(join(dir, file), 'utf8')) as SiteProperty;
    if (p.status === 'draft' || p.status === 'archived') continue;
    try {
      // Validate every linked unit BEFORE any write: a bad unit id must leave the listing untouched.
      const links = p.boogbe?.units ?? [];
      const units = await d.orgDb.run(d.orgId, (tx) =>
        tx.unit.findMany({ where: { id: { in: links.map((l) => l.unitId) } } }),
      );
      const byId = new Map(units.map((u) => [u.id, u]));
      const bad = links.find((l) => !byId.get(l.unitId)?.active);
      if (bad) throw new Error(`unknown or inactive unit ${bad.unitId} — link it in Boogbe first`);

      const existing = await d.orgDb.run(d.orgId, (tx) => tx.listing.findFirst({ where: { slug: p.slug } }));
      const haveRefs = new Set<string>(
        (
          await d.orgDb.run(d.orgId, (tx) =>
            existing
              ? tx.listingPhoto.findMany({ where: { listingId: existing.id, sourceRef: { not: null } }, select: { sourceRef: true } })
              : Promise.resolve([] as { sourceRef: string | null }[]),
          )
        )
          .map((r) => r.sourceRef)
          .filter((r): r is string => !!r),
      );
      const onlyOneRate = (p.rates?.length ?? 0) <= 1;
      const toAdd = p.gallery.filter((g) => !haveRefs.has(`${p.slug}/${g.file}`));

      if (d.dryRun) {
        lines.push(
          `[dry run] ${p.slug}: ${existing ? 'update' : 'create'} listing, ${links.length} unit(s), ${toAdd.length} new photo(s), ${p.gallery.length - toAdd.length} kept`,
        );
        continue;
      }

      const fields = {
        name: p.name,
        slug: p.slug,
        area: p.area ?? null,
        highlight: p.feature ?? null,
        intro: p.intro ?? null,
        description: p.description ?? null,
        amenities: p.amenities ?? [],
        bathroomsLabel: p.bathrooms == null ? null : String(p.bathrooms),
        layoutLabel: links.length && p.config && p.config !== derivedLayout([...byId.values()].map((u) => u.bedrooms)) ? p.config : null,
        seoTitle: p.seo?.title ?? null,
        seoDescription: p.seo?.description ?? null,
      };
      // houseRules is never touched: it is not in today's files and may hold operator edits.
      const listing = existing
        ? await d.listings.patch(ctx, existing.id, { ...fields, expectedUpdatedAt: existing.updatedAt.toISOString() })
        : await d.listings.create(ctx, { ...fields, houseRules: [] });
      if (links.length)
        await d.listings.setUnits(ctx, listing.id, links.map((l) => ({ unitId: l.unitId, label: onlyOneRate ? null : l.label })));

      let added = 0;
      let coverId: string | null = null;
      for (const g of p.gallery) {
        const ref = `${p.slug}/${g.file}`;
        if (haveRefs.has(ref)) {
          if (g.id === p.hero) {
            const existingCover = await d.orgDb.run(d.orgId, (tx) =>
              tx.listingPhoto.findFirst({ where: { listingId: listing.id, sourceRef: ref }, select: { id: true } }),
            );
            coverId = existingCover?.id ?? null;
          }
          continue;
        }
        const buf = readFileSync(join(d.repoPath, 'public/assets/images', `${g.file}-1600.webp`));
        const fileId = newId();
        const key = `org/${d.orgId}/listing_photo/${fileId}.webp`;
        await d.storage.put(key, buf, 'image/webp');
        await d.orgDb.run(d.orgId, (tx) =>
          tx.file.create({
            // orgId is injected by the org-scope extension (same as every service create).
            data: { id: fileId, key, kind: 'listing_photo', contentType: 'image/webp', sizeBytes: buf.length, confirmed: true } as never,
          }),
        );
        const photo = await d.photos.attach(ctx, listing.id, { fileId, alt: g.alt, category: g.category as never });
        // The attach contract carries no provenance; the import stamps its own (idempotence key).
        await d.orgDb.run(d.orgId, (tx) => tx.listingPhoto.updateMany({ where: { id: photo.id }, data: { sourceRef: ref } }));
        added++;
        if (g.id === p.hero) coverId = photo.id;
      }
      if (coverId && listing.coverPhotoId !== coverId) {
        // Not via the cover route: that refuses unprocessed photos, and the import's originals are
        // queued, not yet resized. Publishing still waits for the variants.
        await d.orgDb.run(d.orgId, async (tx) => {
          await tx.listing.updateMany({ where: { id: listing.id }, data: { coverPhotoId: coverId } });
          await bumpSiteVersion(tx);
        });
      }

      // Internal notes go to the units' properties, once per property.
      for (const propertyId of new Set([...byId.values()].map((u) => u.propertyId))) {
        const prop = await d.orgDb.run(d.orgId, (tx) => tx.property.findFirst({ where: { id: propertyId } }));
        if (!prop || prop.notes?.includes(NOTES_MARKER) || !p.notes?.length) continue;
        const block = `${NOTES_MARKER} ${p.notes.join(' ')}`;
        await d.orgDb.run(d.orgId, (tx) =>
          tx.property.updateMany({ where: { id: propertyId }, data: { notes: prop.notes ? `${prop.notes}\n\n${block}` : block } }),
        );
      }

      lines.push(`${p.slug}: ${existing ? 'updated' : 'created'}, ${links.length} unit(s) linked, ${added} photo(s) added, ${p.gallery.length - added} kept`);
    } catch (e) {
      errors.push(`${p.slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { lines, errors };
}

async function main() {
  const [target, repoPath, ...flags] = process.argv.slice(2);
  if (!target?.startsWith('--') && repoPath) {
    const dryRun = flags.includes('--dry-run');
    loadDotEnv(resolve(__dirname, '../../../.env'));
    loadEnv();
    const app = await NestFactory.create(AppModule, { logger: false });
    try {
      const prisma = app.get(PrismaService);
      const org = await prisma.organization.findFirst({ where: { OR: [{ id: target }, { slug: target }] } });
      if (!org) throw new Error(`no operator with id or slug "${target}"`);
      const r = await importSiteListings({
        orgId: org.id,
        repoPath: resolve(repoPath),
        dryRun,
        listings: app.get(ListingsService),
        photos: app.get(ListingPhotosService),
        storage: app.get(STORAGE),
        orgDb: app.get(OrgDb),
      });
      for (const l of r.lines) console.log(l);
      for (const e of r.errors) console.error(e);
      if (dryRun) console.log('[dry run] nothing saved');
      if (r.errors.length) process.exitCode = 1;
    } finally {
      await app.close();
    }
  } else {
    console.error('usage: tsx scripts/import-site-listings.ts <org id|slug> <path to tanuhomes repo> [--dry-run]');
    process.exit(1);
  }
}

// Only when run directly (imported by the int test otherwise).
if (process.argv[1]?.includes('import-site-listings')) void main();
