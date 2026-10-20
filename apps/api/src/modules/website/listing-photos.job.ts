import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrgDb } from '../../common/db/org-db.service';
import { PrismaService } from '../../common/db/prisma.service';
import { JobRunner } from '../../common/jobs/job-runner';
import { MEDIA_STORAGE, STORAGE, type Storage } from '../../common/files/storage';
import { makeVariants } from './image-variants';
import { bumpSiteVersion } from './site-version';

const BATCH = 10; // per tick, like claim_outbound's lease (plan Task 5)

/**
 * Turns uploaded originals into WebP variants on the public media bucket (spec §5.3).
 * claim_listing_photos (0010) leases up to BATCH unprocessed photos across orgs with SKIP LOCKED
 * and has already counted the attempt; each photo is then read and updated under its own org's
 * RLS context. Three failed attempts leave the row alone — the app shows "failed" from
 * attempts >= 3 && !variants_ready, and last_error records why.
 */
@Injectable()
export class ListingPhotosJob {
  private readonly log = new Logger('ListingPhotosJob');

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgDb: OrgDb,
    @Inject(STORAGE) private readonly storage: Storage,
    @Inject(MEDIA_STORAGE) private readonly media: Storage,
    private readonly runner: JobRunner,
  ) {}

  @Cron('* * * * *')
  async tick() {
    await this.runner.once('website.photos', () => this.run());
  }

  async run() {
    const claimed = await this.prisma.$queryRaw<{ id: string; org_id: string }[]>`SELECT * FROM claim_listing_photos(${BATCH}::int)`;
    for (const c of claimed) {
      try {
        await this.orgDb.run(c.org_id, async (tx) => {
          const photo = await tx.listingPhoto.findFirst({ where: { id: c.id } });
          if (!photo) return; // deleted between claim and processing
          const file = await tx.file.findFirst({ where: { id: photo.fileId } });
          if (!file) throw new Error('original file row missing');
          const original = await this.storage.get(file.key);
          if (!original) throw new Error('original not in storage');
          const made = await makeVariants(original);
          for (const v of made.variants) {
            // Photo ids never get reused, so variants are immutable forever (Global Constraints).
            await this.media.put(`org/${c.org_id}/listing/${photo.id}-${v.w}.webp`, v.body, 'image/webp', {
              cacheControl: 'public, max-age=31536000, immutable',
            });
          }
          await tx.listingPhoto.updateMany({
            where: { id: photo.id },
            data: {
              width: made.width,
              height: made.height,
              variants: made.variants.map((x) => x.w),
              variantsReady: true,
            },
          });
          await bumpSiteVersion(tx);
        });
      } catch (e) {
        // attempts was already +1'd by the claim; record the reason and let the next tick retry.
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        this.log.warn(`photo ${c.id}: ${msg}`);
        await this.orgDb
          .run(c.org_id, (tx) => tx.listingPhoto.updateMany({ where: { id: c.id }, data: { lastError: msg } }))
          .catch(() => undefined);
      }
    }
  }
}
