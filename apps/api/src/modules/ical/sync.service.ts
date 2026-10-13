import { Inject, Injectable } from '@nestjs/common';
import { todayIn, type SyncResult } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { OrgInfo } from '../../common/db/org-info';
import { newId } from '../../common/db/ids';
import { NotificationsService } from '../notifications/notifications.service';
import { FetchError, type IcalFetcher } from './fetcher';
import { parseFeed, type ParsedEvent } from './parse';
import { ICAL_FETCHER } from './tokens';

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const FAILING_AFTER = 3;

@Injectable()
export class IcalSyncService {
  /** Set by ConflictsService (T-M4-05) to recompute conflicts after each successful sync. */
  afterSync: (tx: OrgTx, orgId: string, unitId: string) => Promise<void> = async () => {};

  constructor(
    private readonly orgDb: OrgDb,
    private readonly orgInfo: OrgInfo,
    private readonly notifications: NotificationsService,
    @Inject(ICAL_FETCHER) private readonly fetcher: Pick<IcalFetcher, 'fetch'>,
  ) {}

  /**
   * Imports one feed into `block(source='ical')` (ICS-02/03). Idempotent: blocks are matched by UID and only
   * future blocks whose UID vanished are deleted. The fetch happens outside any transaction.
   */
  async syncFeed(orgId: string, feedId: string, now = new Date()): Promise<SyncResult> {
    const { feed, timezone } = await this.orgDb.run(orgId, async (tx) => {
      const f = await tx.icalFeed.findFirst({ where: { id: feedId } });
      if (f) await tx.icalFeed.updateMany({ where: { id: feedId }, data: { lastAttemptAt: now } });
      return { feed: f, timezone: (await this.orgInfo.get(orgId, tx)).timezone };
    });
    if (!feed) return { status: 'error', added: 0, updated: 0, removed: 0, error: 'Feed not found' };
    const today = todayIn(timezone, now);

    let fetched: Awaited<ReturnType<IcalFetcher['fetch']>>;
    let events: ParsedEvent[] = [];
    try {
      fetched = await this.fetcher.fetch(feed.url, { etag: feed.etag, lastModified: feed.lastModified });
      if (fetched.status === 'ok') events = parseFeed(fetched.body, timezone, today);
    } catch (e) {
      const message =
        e instanceof FetchError || (e as Error).name === 'FetchError'
          ? (e as Error).message
          : 'Could not read the calendar';
      return this.orgDb.run(orgId, async (tx) => {
        const failures = feed.consecutiveFailures + 1;
        await tx.icalFeed.updateMany({
          where: { id: feedId },
          data: { lastStatus: 'error', lastError: message, consecutiveFailures: failures },
        });
        if (failures >= FAILING_AFTER) {
          // Once per feed per day (dedupeKey), with an email copy (NTF-02).
          await this.notifications.notifyRoles(
            tx,
            orgId,
            ['admin'],
            {
              kind: 'ical_feed_failing',
              title: `Calendar sync failing: ${feed.label}`,
              body: `${message}. Bookings from this channel may be missing. Check the link in the channel and paste it again.`,
              link: `/settings/properties?unit=${feed.unitId}#calendar-sync`,
              dedupeKey: `feed-failing-${feedId}-${today}`,
            },
            { email: true },
          );
        }
        return { status: 'error' as const, added: 0, updated: 0, removed: 0, error: message };
      });
    }

    return this.orgDb.run(orgId, async (tx) => {
      const healthy = { lastStatus: 'ok', lastError: null, consecutiveFailures: 0, lastSyncedAt: now };
      if (fetched.status === 'not_modified') {
        await tx.icalFeed.updateMany({ where: { id: feedId }, data: healthy });
        return { status: 'not_modified' as const, added: 0, updated: 0, removed: 0, error: null };
      }
      const existing = await tx.block.findMany({ where: { feedId, source: 'ical' } });
      const byUid = new Map(existing.map((b) => [b.externalUid!, b]));
      const seen = new Set<string>();
      let added = 0;
      let updated = 0;
      for (const ev of events) {
        seen.add(ev.uid);
        const prev = byUid.get(ev.uid);
        if (!prev) {
          await tx.block.create({
            data: {
              id: newId(),
              unitId: feed.unitId,
              start: day(ev.start),
              end: day(ev.end),
              source: 'ical',
              reason: 'external',
              feedId,
              externalUid: ev.uid,
              externalSummary: ev.summary,
            } as never,
          });
          added++;
        } else if (
          iso(prev.start) !== ev.start ||
          iso(prev.end) !== ev.end ||
          prev.externalSummary !== ev.summary
        ) {
          await tx.block.updateMany({
            where: { id: prev.id },
            data: { start: day(ev.start), end: day(ev.end), externalSummary: ev.summary },
          });
          updated++;
        }
      }
      // Past blocks stay as history even when the channel stops sending them.
      const vanished = existing
        .filter((b) => !seen.has(b.externalUid!) && iso(b.end) > today)
        .map((b) => b.id);
      if (vanished.length) await tx.block.deleteMany({ where: { id: { in: vanished } } });
      await tx.icalFeed.updateMany({
        where: { id: feedId },
        data: { ...healthy, etag: fetched.etag, lastModified: fetched.lastModified },
      });
      await this.afterSync(tx, orgId, feed.unitId);
      return { status: 'ok' as const, added, updated, removed: vanished.length, error: null };
    });
  }
}
