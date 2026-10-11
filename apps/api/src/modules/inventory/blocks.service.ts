import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Block, BlockInput, CalendarItem, IsoDate } from '@boogbe/shared';
import type { Block as Row } from '@prisma/client';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { CalendarSources, type CalendarSource, type Ignore } from '../calendar/calendar-sources';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: IsoDate) => new Date(`${s}T00:00:00Z`);
const LABEL: Record<string, string> = {
  maintenance: 'Maintenance',
  owner_stay: 'Owner stay',
  other: 'Blocked',
  external: 'External booking',
};

export const toBlock = (r: Row): Block => ({
  id: r.id,
  unitId: r.unitId,
  start: iso(r.start),
  end: iso(r.end),
  source: r.source as Block['source'],
  reason: r.reason as Block['reason'],
  note: r.note,
  feedId: r.feedId,
  externalSummary: r.externalSummary,
});

@Injectable()
export class BlocksService implements CalendarSource, OnModuleInit {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
    private readonly sources: CalendarSources,
  ) {}

  onModuleInit() {
    this.sources.register(this);
  }

  async items(tx: OrgTx, unitIds: string[], from: IsoDate, to: IsoDate): Promise<CalendarItem[]> {
    const rows = await tx.block.findMany({
      where: { unitId: { in: unitIds }, start: { lt: day(to) }, end: { gt: day(from) } },
      orderBy: { start: 'asc' },
    });
    return rows.map((r) => ({
      kind: 'block',
      id: r.id,
      unitId: r.unitId,
      start: iso(r.start),
      end: iso(r.end),
      source: r.source as 'manual' | 'ical',
      reason: r.reason,
      label: r.source === 'ical' ? (r.externalSummary ?? LABEL.external!) : (LABEL[r.reason] ?? 'Blocked'),
    }));
  }

  /** Only manual blocks are hard conflicts; iCal blocks are warnings (BKG-03). */
  async conflicts(tx: OrgTx, unitId: string, start: IsoDate, end: IsoDate, ignore?: Ignore) {
    const b = await tx.block.findFirst({
      where: {
        unitId,
        source: 'manual',
        start: { lt: day(end) },
        end: { gt: day(start) },
        ...(ignore?.blockId && { id: { not: ignore.blockId } }),
      },
    });
    return b ? { kind: 'block' as const, id: b.id } : null;
  }

  /** Locks the unit row, then asks every calendar source for a hard conflict. Call inside the same tx as the write. */
  async assertUnitFree(tx: OrgTx, unitId: string, start: IsoDate, end: IsoDate, ignore?: Ignore) {
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM unit WHERE id = ${unitId} AND active FOR UPDATE`;
    if (!locked.length) throw new AppError('VALIDATION_FAILED', 400, 'Unit not found or archived');
    for (const s of this.sources.all()) {
      const c = await s.conflicts?.(tx, unitId, start, end, ignore);
      if (c) throw new AppError('DATES_UNAVAILABLE', 409, 'Those dates are not available', c);
    }
  }

  create(ctx: OrgCtx, input: BlockInput): Promise<Block> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      await this.assertUnitFree(tx, input.unitId, input.start, input.end);
      const r = await tx.block.create({
        data: {
          id: newId(),
          unitId: input.unitId,
          start: day(input.start),
          end: day(input.end),
          source: 'manual',
          reason: input.reason,
          note: input.note ?? null,
          createdByMemberId: ctx.memberId,
        } as never,
      });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'block.create',
        entity: 'block',
        entityId: r.id,
        after: input,
      });
      return toBlock(r);
    });
  }

  update(ctx: OrgCtx, id: string, input: Partial<Omit<BlockInput, 'unitId'>>): Promise<Block> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const b = await tx.block.findFirst({ where: { id } });
      if (!b) throw notFound('Block');
      if (b.source !== 'manual') {
        throw new AppError(
          'INVALID_TRANSITION',
          422,
          'Calendar-sync blocks are managed by the source calendar',
        );
      }
      const start = input.start ?? iso(b.start);
      const end = input.end ?? iso(b.end);
      if (end <= start) throw new AppError('VALIDATION_FAILED', 400, 'End must be after start');
      await this.assertUnitFree(tx, b.unitId, start, end, { blockId: id });
      await tx.block.updateMany({
        where: { id },
        data: {
          start: day(start),
          end: day(end),
          ...(input.reason && { reason: input.reason }),
          ...(input.note !== undefined && { note: input.note }),
        },
      });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'block.update',
        entity: 'block',
        entityId: id,
        before: toBlock(b),
        after: input,
      });
      return toBlock((await tx.block.findFirst({ where: { id } }))!);
    });
  }

  remove(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const b = await tx.block.findFirst({ where: { id } });
      if (!b) throw notFound('Block');
      if (b.source !== 'manual') {
        throw new AppError(
          'INVALID_TRANSITION',
          422,
          'Calendar-sync blocks are managed by the source calendar',
        );
      }
      await tx.block.deleteMany({ where: { id } });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'block.delete',
        entity: 'block',
        entityId: id,
        before: toBlock(b),
      });
      return { ok: true };
    });
  }
}
