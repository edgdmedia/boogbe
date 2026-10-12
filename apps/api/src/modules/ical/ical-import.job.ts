import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import { OrgDb } from '../../common/db/org-db.service';
import { JobRunner } from '../../common/jobs/job-runner';
import { IcalSyncService } from './sync.service';

const TICK_MS = 5 * 60_000;
const EVERY_MS = 15 * 60_000;
/** Spreads feeds over a 5-minute window so every unit isn't fetched at the same moment. */
const jitterMs = (id: string) =>
  (parseInt(createHash('sha1').update(id).digest('hex').slice(0, 8), 16) % 300) * 1000;

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<unknown>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

@Injectable()
export class IcalImportJob {
  constructor(
    private readonly runner: JobRunner,
    private readonly orgDb: OrgDb,
    private readonly sync: IcalSyncService,
  ) {}

  @Cron('*/5 * * * *')
  async tick() {
    await this.run();
  }

  /** A feed is due 15 min + jitter after its last attempt, less one tick, so it syncs every 15–20 min (ICS-02). */
  async run(now = new Date()) {
    return this.runner.forEachActiveOrg('ical.import', async (org) => {
      const feeds = await this.orgDb.run(org.id, (tx) =>
        tx.icalFeed.findMany({ where: { active: true }, select: { id: true, lastAttemptAt: true } }),
      );
      const due = feeds.filter(
        (f) =>
          !f.lastAttemptAt ||
          now.getTime() - f.lastAttemptAt.getTime() >= EVERY_MS + jitterMs(f.id) - TICK_MS,
      );
      await pool(due, 4, (f) => this.sync.syncFeed(org.id, f.id, now));
    });
  }
}
