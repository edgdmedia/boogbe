import { Inject, Injectable } from '@nestjs/common';
import { todayIn, type IcalExport, type IcalFeed, type IcalFeedInput } from '@boogbe/shared';
import type { IcalFeed as Row } from '@prisma/client';
import { OrgDb } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { FetchError, type IcalFetcher } from './fetcher';
import { parseFeed } from './parse';
import { IcalSyncService } from './sync.service';
import { ICAL_FETCHER } from './tokens';

const toFeed = (r: Row, blockCount: number): IcalFeed => ({
  id: r.id,
  unitId: r.unitId,
  label: r.label,
  channel: r.channel as IcalFeed['channel'],
  urlHost: new URL(r.url).host,
  lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
  lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
  lastStatus: r.lastStatus as IcalFeed['lastStatus'],
  lastError: r.lastError,
  consecutiveFailures: r.consecutiveFailures,
  active: r.active,
  blockCount,
});

const isFetchError = (e: unknown) =>
  e instanceof FetchError || ['FetchError', 'UnsafeUrlError'].includes((e as Error).name);

@Injectable()
export class FeedsService {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
    private readonly sync: IcalSyncService,
    @Inject(ICAL_FETCHER) private readonly fetcher: Pick<IcalFetcher, 'fetch'>,
  ) {}

  // Export links arrive with T-M4-06 (ExportsService.listIn); until then the list is empty.
  forUnit(ctx: OrgCtx, unitId: string): Promise<{ feeds: IcalFeed[]; exports: IcalExport[] }> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      if (!(await tx.unit.findFirst({ where: { id: unitId } }))) throw notFound('Unit');
      const feeds = await tx.icalFeed.findMany({ where: { unitId }, orderBy: { createdAt: 'asc' } });
      const counts = await tx.block.groupBy({
        by: ['feedId'],
        where: { unitId, source: 'ical' },
        _count: true,
      });
      const c = new Map(counts.map((x) => [x.feedId, x._count]));
      return { feeds: feeds.map((f) => toFeed(f, c.get(f.id) ?? 0)), exports: [] };
    });
  }

  /** Fetches and parses the link once before saving, so a bad link is refused with the reason (ICS-01). */
  async create(ctx: OrgCtx, input: IcalFeedInput): Promise<IcalFeed> {
    try {
      const r = await this.fetcher.fetch(input.url, { etag: null, lastModified: null });
      if (r.status === 'ok') parseFeed(r.body, ctx.timezone, todayIn(ctx.timezone));
    } catch (e) {
      if (isFetchError(e)) throw new AppError('VALIDATION_FAILED', 400, (e as Error).message);
      throw e;
    }
    const id = newId();
    await this.orgDb.run(ctx.orgId, async (tx) => {
      if (!(await tx.unit.findFirst({ where: { id: input.unitId, active: true } })))
        throw new AppError('VALIDATION_FAILED', 400, 'Unit not found');
      await tx.icalFeed.create({
        data: {
          id,
          unitId: input.unitId,
          label: input.label,
          channel: input.channel,
          url: input.url,
        } as never,
      });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'ical_feed.create',
        entity: 'ical_feed',
        entityId: id,
        // The link carries the channel's secret, so only its host is audited.
        after: { label: input.label, channel: input.channel, host: new URL(input.url).host },
      });
    });
    await this.sync.syncFeed(ctx.orgId, id);
    return (await this.forUnit(ctx, input.unitId)).feeds.find((f) => f.id === id)!;
  }

  update(ctx: OrgCtx, id: string, input: { label?: string; active?: boolean }) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.icalFeed.updateMany({ where: { id }, data: input });
      if (!r.count) throw notFound('Feed');
      await this.audit.record(tx, {
        actor: ctx,
        action: 'ical_feed.update',
        entity: 'ical_feed',
        entityId: id,
        after: input,
      });
      return { ok: true };
    });
  }

  remove(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const f = await tx.icalFeed.findFirst({ where: { id } });
      if (!f) throw notFound('Feed');
      await tx.icalFeed.deleteMany({ where: { id } }); // its blocks go with it (block_feed_fk cascade)
      await this.audit.record(tx, {
        actor: ctx,
        action: 'ical_feed.delete',
        entity: 'ical_feed',
        entityId: id,
        before: { label: f.label },
      });
      return { ok: true };
    });
  }

  async syncNow(ctx: OrgCtx, id: string) {
    const f = await this.orgDb.run(ctx.orgId, (tx) => tx.icalFeed.findFirst({ where: { id } }));
    if (!f) throw notFound('Feed');
    if (f.lastAttemptAt && Date.now() - f.lastAttemptAt.getTime() < 60_000)
      throw new AppError('RATE_LIMITED', 429, 'Synced less than a minute ago — try again shortly');
    return this.sync.syncFeed(ctx.orgId, id);
  }
}
