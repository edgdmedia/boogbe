import { Injectable } from '@nestjs/common';
import {
  publishBlockers,
  slugify,
  type Listing,
  type ListingInput,
  type ListingUnitsInput,
  type ListingUpdate,
} from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import { OrgDb } from '../../common/db/org-db.service';
import { loadEnv } from '../../env';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { bumpSiteVersion } from './site-version';
import { toListing } from './listings.mappers';

// Website listings (WL): one page per apartment on the operator's site. Every write that can
// change /site bumps site_version in the same transaction (Global Constraints).
@Injectable()
export class ListingsService {
  /** MEDIA_PUBLIC_BASE for photo previews; null until the media bucket is configured. */
  private readonly mediaBase: string | null = loadEnv().MEDIA_PUBLIC_BASE ?? null;

  constructor(
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
  ) {}

  list(ctx: OrgCtx): Promise<Listing[]> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const rows = await tx.listing.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
      const parts = await this.attachments(tx, rows.map((r) => r.id));
      return rows.map((r) => toListing(r, parts.units.get(r.id) ?? [], parts.photos.get(r.id) ?? [], this.mediaBase));
    });
  }

  async get(ctx: OrgCtx, id: string): Promise<Listing> {
    return this.orgDb.run(ctx.orgId, (tx) => this.load(tx, id));
  }

  /** Row + its units and photos, mapped. RLS hides other orgs' rows, so a miss is a 404. */
  private async load(tx: OrgTx, id: string): Promise<Listing> {
    const row = await tx.listing.findFirst({ where: { id } });
    if (!row) throw notFound('Listing');
    const parts = await this.attachments(tx, [id]);
    return toListing(row, parts.units.get(id) ?? [], parts.photos.get(id) ?? [], this.mediaBase);
  }

  private async attachments(tx: OrgTx, listingIds: string[]) {
    const units = await tx.unit.findMany({
      where: { listingId: { in: listingIds } },
      include: { property: { select: { active: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const photos = await tx.listingPhoto.findMany({
      where: { listingId: { in: listingIds } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const byListing = <T extends { listingId: string | null }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const r of rows) if (r.listingId) map.set(r.listingId, [...(map.get(r.listingId) ?? []), r]);
      return map;
    };
    return { units: byListing(units), photos: byListing(photos) };
  }

  /** A slug is taken when another listing holds it now or held it ever (301s must keep working). */
  private async slugTaken(tx: OrgTx, slug: string, exceptListingId: string): Promise<boolean> {
    if (
      await tx.listing.findFirst({ where: { slug, NOT: { id: exceptListingId } }, select: { id: true } })
    )
      return true;
    return !!(await tx.listingSlugHistory.findFirst({ where: { slug, NOT: { listingId: exceptListingId } } }));
  }

  create(ctx: OrgCtx, input: ListingInput): Promise<Listing> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const id = newId();
      let slug = input.slug ?? slugify(input.name);
      if (input.slug && (await this.slugTaken(tx, slug, id)))
        throw new AppError('SLUG_TAKEN', 409, 'That address is already used by another listing');
      const base = slug.slice(0, 57).replace(/-+$/, '');
      for (let n = 2; await this.slugTaken(tx, slug, id); n++) {
        if (n > 20) throw new AppError('VALIDATION_FAILED', 400, 'Too many listings share this name — give it a different slug');
        slug = `${base}-${n}`;
      }
      // Explicit column list: slug handled above, everything else straight from the contract.
      await tx.listing.create({
        data: {
          id,
          name: input.name,
          slug,
          area: input.area ?? null,
          highlight: input.highlight ?? null,
          intro: input.intro ?? null,
          description: input.description ?? null,
          amenities: input.amenities,
          houseRules: input.houseRules,
          bathroomsLabel: input.bathroomsLabel ?? null,
          layoutLabel: input.layoutLabel ?? null,
          seoTitle: input.seoTitle ?? null,
          seoDescription: input.seoDescription ?? null,
        } as never,
      });
      await this.audit.record(tx, { actor: ctx, action: 'listing.created', entity: 'listing', entityId: id, after: input });
      await bumpSiteVersion(tx);
      return this.load(tx, id);
    });
  }

  patch(ctx: OrgCtx, id: string, input: ListingUpdate): Promise<Listing> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const row = await tx.listing.findFirst({ where: { id } });
      if (!row) throw notFound('Listing');
      if (row.updatedAt.getTime() !== Date.parse(input.expectedUpdatedAt)) {
        const last = await tx.auditLog.findFirst({
          where: { entity: 'listing', entityId: id, action: { in: ['listing.updated', 'listing.created'] } },
          orderBy: { at: 'desc' },
        });
        const actor = last ? await tx.user.findFirst({ where: { id: last.actorUserId }, select: { name: true } }) : null;
        throw new AppError('STALE', 409, 'Someone else updated this listing first', {
          updatedAt: row.updatedAt.toISOString(),
          updatedBy: actor?.name ?? null,
        });
      }
      // expectedUpdatedAt is the lock, never a column.
      const fields = Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'expectedUpdatedAt'));
      const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      if ('slug' in data && data.slug !== row.slug) {
        const target = data.slug as string;
        if (await this.slugTaken(tx, target, id))
          throw new AppError('SLUG_TAKEN', 409, 'That address is already used by another listing');
        await tx.listingSlugHistory.create({ data: { id: newId(), listingId: id, slug: row.slug } as never });
        // Returning to one of this listing's own old slugs frees it from history (plan Review Focus 3).
        await tx.listingSlugHistory.deleteMany({ where: { listingId: id, slug: target } });
      }
      await tx.listing.updateMany({ where: { id }, data: data as never });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'listing.updated',
        entity: 'listing',
        entityId: id,
        before: row,
        after: fields,
      });
      await bumpSiteVersion(tx);
      return this.load(tx, id);
    });
  }

  /** Sets exactly this listing's units: links/relables the listed ones, clears the rest. */
  setUnits(ctx: OrgCtx, id: string, input: ListingUnitsInput): Promise<Listing> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const row = await tx.listing.findFirst({ where: { id } });
      if (!row) throw notFound('Listing');
      const ids = input.map((e) => e.unitId);
      const units = await tx.unit.findMany({ where: { id: { in: ids } } });
      const byId = new Map(units.map((u) => [u.id, u]));
      for (const e of input) {
        const u = byId.get(e.unitId);
        if (!u || !u.active)
          throw new AppError('VALIDATION_FAILED', 400, 'Only your own active units can go on the website');
        if (u.listingId && u.listingId !== id)
          throw new AppError('UNIT_LINKED', 409, 'That unit is already on another listing', {
            unitId: e.unitId,
            listingId: u.listingId,
          });
      }
      for (const e of input)
        await tx.unit.updateMany({ where: { id: e.unitId }, data: { listingId: id, listingLabel: e.label } });
      await tx.unit.updateMany({
        where: { listingId: id, id: { notIn: ids } },
        data: { listingId: null, listingLabel: null },
      });
      await this.audit.record(tx, { actor: ctx, action: 'listing.units_set', entity: 'listing', entityId: id, after: input });
      await bumpSiteVersion(tx);
      return this.load(tx, id);
    });
  }

  reorder(ctx: OrgCtx, ids: string[]) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      for (const [i, id] of ids.entries()) {
        const r = await tx.listing.updateMany({ where: { id }, data: { sortOrder: i } });
        if (!r.count) throw notFound('Listing'); // whole transaction rolls back
      }
      await this.audit.record(tx, { actor: ctx, action: 'listing.reordered', entity: 'listing', entityId: ctx.orgId, after: ids });
      await bumpSiteVersion(tx);
      return { ok: true };
    });
  }

  /** Publish refuses with the shared blocker list; unpublish is the reverse. */
  setPublished(ctx: OrgCtx, id: string, publish: boolean): Promise<Listing> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const l = await this.load(tx, id);
      if (publish) {
        const blockers = publishBlockers(l);
        if (blockers.length)
          throw new AppError('PUBLISH_BLOCKED', 422, 'This listing is not ready to publish', { blockers });
        await tx.listing.updateMany({ where: { id }, data: { published: true, publishedAt: new Date() } as never });
        await this.audit.record(tx, { actor: ctx, action: 'listing.published', entity: 'listing', entityId: id });
      } else {
        await tx.listing.updateMany({ where: { id }, data: { published: false } });
        await this.audit.record(tx, { actor: ctx, action: 'listing.unpublished', entity: 'listing', entityId: id });
      }
      await bumpSiteVersion(tx);
      return this.load(tx, id);
    });
  }

  /**
   * Deleting is only for never-published, never-renamed listings — otherwise the old addresses
   * and the published page's history would silently vanish (409 PUBLISHED_BEFORE: unpublish instead).
   * Photos cascade, unit links are cleared by the FK. Their media-bucket variants stay for the
   * bucket's lifecycle rule (plan Task 4).
   */
  async remove(ctx: OrgCtx, id: string) {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const row = await tx.listing.findFirst({ where: { id } });
      if (!row) throw notFound('Listing');
      const history = await tx.listingSlugHistory.count({ where: { listingId: id } });
      if (row.published || history)
        throw new AppError('PUBLISHED_BEFORE', 409, 'This listing was on the website or renamed — unpublish it instead');
      await tx.listing.deleteMany({ where: { id } });
      await this.audit.record(tx, { actor: ctx, action: 'listing.deleted', entity: 'listing', entityId: id, before: row });
      await bumpSiteVersion(tx);
    });
    return { ok: true };
  }
}
