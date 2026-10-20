import { Injectable } from '@nestjs/common';
import type { ListingPhoto, ListingPhotoAttach, ListingPhotoUpdate } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { FilesService } from '../../common/files/files.service';
import { loadEnv } from '../../env';
import { bumpSiteVersion } from './site-version';
import { toListingPhoto } from './listings.mappers';

const MAX_PHOTOS = 60; // Global Constraints

// Listing photos (T-WL-05): attach confirmed originals, describe them, order them, pick the cover.
// The resize job that makes the variants lives in listing-photos.job.ts (worker only, D-019).
@Injectable()
export class ListingPhotosService {
  private readonly mediaBase: string | null = loadEnv().MEDIA_PUBLIC_BASE ?? null;

  constructor(
    private readonly orgDb: OrgDb,
    private readonly files: FilesService,
  ) {}

  private async photoInListing(tx: OrgTx, listingId: string, photoId: string) {
    const photo = await tx.listingPhoto.findFirst({ where: { id: photoId, listingId } });
    if (!photo) throw notFound('Photo');
    return photo;
  }

  async attach(ctx: OrgCtx, listingId: string, input: ListingPhotoAttach): Promise<ListingPhoto> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const listing = await tx.listing.findFirst({ where: { id: listingId } });
      if (!listing) throw notFound('Listing');
      await this.files.assertConfirmed(tx, input.fileId, 'listing_photo');
      const count = await tx.listingPhoto.count({ where: { listingId } });
      if (count >= MAX_PHOTOS) throw new AppError('TOO_MANY_PHOTOS', 422, `A listing can have at most ${MAX_PHOTOS} photos`);
      const row = await tx.listingPhoto.create({
        data: { id: newId(), listingId, fileId: input.fileId, alt: input.alt, category: input.category, sortOrder: count } as never,
      });
      // First photo becomes the cover when none is set (plan Task 5).
      if (!listing.coverPhotoId) await tx.listing.updateMany({ where: { id: listingId }, data: { coverPhotoId: row.id } });
      await bumpSiteVersion(tx);
      return toListingPhoto(row, this.mediaBase);
    });
  }

  async patch(ctx: OrgCtx, listingId: string, photoId: string, input: ListingPhotoUpdate): Promise<ListingPhoto> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      await this.photoInListing(tx, listingId, photoId);
      const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      await tx.listingPhoto.updateMany({ where: { id: photoId, listingId }, data: data as never });
      await bumpSiteVersion(tx);
      return toListingPhoto(await this.photoInListing(tx, listingId, photoId), this.mediaBase);
    });
  }

  async reorder(ctx: OrgCtx, listingId: string, ids: string[]) {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const found = await tx.listingPhoto.count({ where: { listingId, id: { in: ids } } });
      if (found !== ids.length) throw new AppError('VALIDATION_FAILED', 400, 'Every photo of this listing must be listed once');
      for (const [i, id] of ids.entries()) await tx.listingPhoto.updateMany({ where: { id, listingId }, data: { sortOrder: i } });
      await bumpSiteVersion(tx);
    });
    return { ok: true };
  }

  async setCover(ctx: OrgCtx, listingId: string, photoId: string) {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const listing = await tx.listing.findFirst({ where: { id: listingId } });
      if (!listing) throw notFound('Listing');
      const photo = await this.photoInListing(tx, listingId, photoId);
      if (!photo.variantsReady) throw new AppError('VALIDATION_FAILED', 400, 'That photo is still processing');
      await tx.listing.updateMany({ where: { id: listingId }, data: { coverPhotoId: photoId } });
      await bumpSiteVersion(tx);
    });
    return { ok: true };
  }

  async remove(ctx: OrgCtx, listingId: string, photoId: string) {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const listing = await tx.listing.findFirst({ where: { id: listingId } });
      if (!listing) throw notFound('Listing');
      await this.photoInListing(tx, listingId, photoId);
      // Clear the pointer first — the photo is what it points at.
      if (listing.coverPhotoId === photoId) await tx.listing.updateMany({ where: { id: listingId }, data: { coverPhotoId: null } });
      await tx.listingPhoto.deleteMany({ where: { id: photoId, listingId } });
      await bumpSiteVersion(tx);
    });
    return { ok: true };
  }
}
