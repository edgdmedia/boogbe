import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ACTIVE_STATUSES, addDays, todayIn, type ExportChannel, type IcalExport } from '@boogbe/shared';
import type { IcalExport as Row } from '@prisma/client';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { PrismaService } from '../../common/db/prisma.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { loadEnv } from '../../env';
import { renderIcs } from './ics';

const newToken = () => randomBytes(32).toString('base64url');
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

const toExport = (r: Row): IcalExport => ({
  id: r.id,
  unitId: r.unitId,
  channel: r.channel as ExportChannel,
  url: `${loadEnv().API_PUBLIC_ORIGIN}/v1/ical/${r.token}.ics`,
  excludeFeedId: r.excludeFeedId,
  createdAt: r.createdAt.toISOString(),
  rotatedAt: r.rotatedAt?.toISOString() ?? null,
});

@Injectable()
export class ExportsService {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listIn(tx: OrgTx, unitId: string): Promise<IcalExport[]> {
    return (await tx.icalExport.findMany({ where: { unitId }, orderBy: { createdAt: 'asc' } })).map(toExport);
  }

  /**
   * Points each per-channel export at the unit's active feed of the same channel, so dates that channel
   * sent us are never echoed back to it. Called whenever a feed is added, toggled or removed.
   */
  async relink(tx: OrgTx, unitId: string): Promise<void> {
    const feeds = await tx.icalFeed.findMany({ where: { unitId, active: true }, orderBy: { createdAt: 'asc' } });
    for (const ex of await tx.icalExport.findMany({ where: { unitId, channel: { not: 'all' } } })) {
      const feedId = feeds.find((f) => f.channel === ex.channel)?.id ?? null;
      if (ex.excludeFeedId !== feedId) await tx.icalExport.updateMany({ where: { id: ex.id }, data: { excludeFeedId: feedId } });
    }
  }

  /** Idempotent per unit + channel (ICS-04). */
  create(ctx: OrgCtx, unitId: string, channel: ExportChannel): Promise<IcalExport> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      if (!(await tx.unit.findFirst({ where: { id: unitId } }))) throw notFound('Unit');
      const id = newId();
      // ON CONFLICT DO NOTHING: two clicks at once both get the one export instead of a unique-key error.
      await tx.icalExport.createMany({ data: [{ id, unitId, channel, token: newToken() } as never], skipDuplicates: true });
      const row = (await tx.icalExport.findFirst({ where: { unitId, channel } }))!;
      if (row.id !== id) return toExport(row);
      await this.relink(tx, unitId);
      await this.audit.record(tx, {
        actor: ctx,
        action: 'ical_export.create',
        entity: 'ical_export',
        entityId: id,
        after: { unitId, channel },
      });
      return toExport((await tx.icalExport.findFirst({ where: { id } }))!);
    });
  }

  /** A new token; the old link stops working at once. */
  rotate(ctx: OrgCtx, id: string): Promise<IcalExport> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.icalExport.updateMany({ where: { id }, data: { token: newToken(), rotatedAt: new Date() } });
      if (!r.count) throw notFound('Export');
      await this.audit.record(tx, { actor: ctx, action: 'ical_export.rotate', entity: 'ical_export', entityId: id });
      return toExport((await tx.icalExport.findFirst({ where: { id } }))!);
    });
  }

  /**
   * Public feed body, or null for an unknown token or a suspended organisation. The token is resolved by the
   * SECURITY DEFINER `ical_export_lookup`; everything after that is read under the org's RLS context.
   * Events carry no guest details: bookings are "Reserved", blocks "Blocked".
   */
  async render(token: string): Promise<string | null> {
    const [hit] = await this.prisma.$queryRaw<{ org_id: string; unit_id: string; exclude_feed_id: string | null }[]>`
      SELECT org_id, unit_id, exclude_feed_id FROM ical_export_lookup(${token})`;
    if (!hit) return null;
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: hit.org_id },
      select: { name: true, timezone: true },
    });
    const today = todayIn(org.timezone);
    const from = day(addDays(today, -30));
    const to = day(addDays(today, 730));
    return this.orgDb.run(hit.org_id, async (tx) => {
      const unit = await tx.unit.findFirstOrThrow({ where: { id: hit.unit_id } });
      const bookings = await tx.booking.findMany({
        where: { unitId: unit.id, status: { in: [...ACTIVE_STATUSES] }, checkOut: { gt: from }, checkIn: { lt: to } },
        orderBy: { checkIn: 'asc' },
      });
      const blocks = await tx.block.findMany({
        where: {
          unitId: unit.id,
          end: { gt: from },
          start: { lt: to },
          ...(hit.exclude_feed_id && { OR: [{ feedId: null }, { feedId: { not: hit.exclude_feed_id } }] }),
        },
        orderBy: { start: 'asc' },
      });
      return renderIcs({
        name: `${unit.name} – ${org.name}`,
        events: [
          ...bookings.map((b) => ({ uid: `booking-${b.id}@boogbe`, start: iso(b.checkIn), end: iso(b.checkOut), summary: 'Reserved' })),
          ...blocks.map((k) => ({ uid: `block-${k.id}@boogbe`, start: iso(k.start), end: iso(k.end), summary: 'Blocked' })),
        ],
      });
    });
  }
}
