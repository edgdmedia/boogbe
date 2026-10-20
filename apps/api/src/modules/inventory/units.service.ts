import { Injectable } from '@nestjs/common';
import { todayIn, type IsoDate, type SetUnitOwnerInput, type Unit, type UnitInput } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { OwnershipService } from './ownership.service';
import { toUnit } from './mappers';
import { bumpSiteVersion, siteRelevant } from '../website/site-version';

@Injectable()
export class UnitsService {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
    private readonly ownership: OwnershipService,
  ) {}

  private async hydrate(
    tx: OrgTx,
    rows: Awaited<ReturnType<OrgTx['unit']['findMany']>>,
    asOf: IsoDate,
  ): Promise<Unit[]> {
    const current = await this.ownership.currentOwner(
      tx,
      rows.map((r) => r.id),
      asOf,
    );
    const ownerIds = [...new Set([...current.values()].filter((x): x is string => !!x))];
    const names = new Map(
      (await tx.owner.findMany({ where: { id: { in: ownerIds } } })).map((o) => [o.id, o.name]),
    );
    return rows.map((r) => {
      const oid = current.get(r.id) ?? null;
      return toUnit(r, {
        owner: oid ? { id: oid, name: names.get(oid) ?? '' } : null,
        source: oid === null ? 'operator' : r.ownerFollowsProperty ? 'property' : 'unit',
      });
    });
  }

  list(ctx: OrgCtx, q: { propertyId?: string; includeArchived?: boolean; asOf?: IsoDate }): Promise<Unit[]> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const rows = await tx.unit.findMany({
        where: {
          ...(q.propertyId && { propertyId: q.propertyId }),
          ...(!q.includeArchived && { active: true }),
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      return this.hydrate(tx, rows, q.asOf ?? todayIn(ctx.timezone));
    });
  }

  async get(ctx: OrgCtx, id: string): Promise<Unit> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const row = await tx.unit.findFirst({ where: { id } });
      if (!row) throw notFound('Unit');
      return (await this.hydrate(tx, [row], todayIn(ctx.timezone)))[0]!;
    });
  }

  async create(ctx: OrgCtx, input: UnitInput): Promise<Unit> {
    const id = newId();
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const p = await tx.property.findFirst({ where: { id: input.propertyId, active: true } });
      if (!p) throw new AppError('VALIDATION_FAILED', 400, 'Property not found');
      await tx.unit.create({
        data: {
          id,
          ...input,
          nightlyRateKobo: BigInt(input.nightlyRateKobo),
          feeFixedMonthlyKobo: BigInt(input.feeFixedMonthlyKobo),
        } as never,
      });
      await tx.unitOwnership.create({
        data: {
          id: newId(),
          unitId: id,
          ownerId: p.defaultOwnerId,
          effectiveFrom: new Date(`${todayIn(ctx.timezone)}T00:00:00Z`),
        } as never,
      });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'unit.create',
        entity: 'unit',
        entityId: id,
        after: input,
      });
    });
    return this.get(ctx, id);
  }

  async update(ctx: OrgCtx, id: string, input: Partial<UnitInput>): Promise<Unit> {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const before = await tx.unit.findFirst({ where: { id } });
      if (!before) throw notFound('Unit');
      if (input.propertyId && input.propertyId !== before.propertyId) {
        throw new AppError('VALIDATION_FAILED', 400, 'A unit cannot move to another property');
      }
      await tx.unit.updateMany({
        where: { id },
        data: {
          ...input,
          ...(input.nightlyRateKobo !== undefined && { nightlyRateKobo: BigInt(input.nightlyRateKobo) }),
          ...(input.feeFixedMonthlyKobo !== undefined && {
            feeFixedMonthlyKobo: BigInt(input.feeFixedMonthlyKobo),
          }),
        },
      });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'unit.update',
        entity: 'unit',
        entityId: id,
        before,
        after: input,
      });
      // Website-relevant fields only; listingId/listingLabel cannot arrive through this DTO —
      // the link is set by the listings API (T-WL-04), which bumps on its own.
      const siteChanged =
        (input.nightlyRateKobo !== undefined && BigInt(input.nightlyRateKobo) !== before.nightlyRateKobo) ||
        (input.maxGuests !== undefined && input.maxGuests !== before.maxGuests) ||
        (input.bedrooms !== undefined && input.bedrooms !== before.bedrooms) ||
        (input.name !== undefined && input.name !== before.name) ||
        (input.publicListed !== undefined && input.publicListed !== before.publicListed);
      if (siteChanged && siteRelevant(before)) await bumpSiteVersion(tx);
    });
    return this.get(ctx, id);
  }

  async setActive(ctx: OrgCtx, id: string, active: boolean) {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const u = await tx.unit.findFirst({ where: { id } });
      if (!u) throw notFound('Unit');
      await tx.unit.updateMany({ where: { id }, data: { active } });
      await this.audit.record(tx, {
        actor: ctx,
        action: active ? 'unit.unarchive' : 'unit.archive',
        entity: 'unit',
        entityId: id,
      });
      // Archiving a linked unit drops it from /site's bookable set.
      if (siteRelevant(u)) await bumpSiteVersion(tx);
    });
    return this.get(ctx, id);
  }

  async setOwner(ctx: OrgCtx, id: string, input: SetUnitOwnerInput): Promise<Unit> {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const u = await tx.unit.findFirst({ where: { id }, include: { property: true } });
      if (!u) throw notFound('Unit');
      const ownerId =
        input.mode === 'owner' ? input.ownerId : input.mode === 'property' ? u.property.defaultOwnerId : null;
      await tx.unit.updateMany({ where: { id }, data: { ownerFollowsProperty: input.mode === 'property' } });
      await this.ownership.setUnitOwner(tx, id, ownerId, input.effectiveFrom);
      await this.audit.record(tx, {
        actor: ctx,
        action: 'unit.owner_change',
        entity: 'unit',
        entityId: id,
        after: input,
      });
    });
    return this.get(ctx, id);
  }

  async ownershipHistory(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const u = await tx.unit.findFirst({ where: { id } });
      if (!u) throw notFound('Unit');
      const periods = (await this.ownership.periodsFor(tx, [id])).get(id)!;
      const ids = periods.map((p) => p.ownerId).filter((x): x is string => !!x);
      const names = new Map(
        (await tx.owner.findMany({ where: { id: { in: ids } } })).map((o) => [o.id, o.name]),
      );
      return {
        items: periods.map((p) => ({
          ownerId: p.ownerId,
          ownerName: p.ownerId ? (names.get(p.ownerId) ?? null) : null,
          from: p.from,
          to: p.to,
        })),
      };
    });
  }
}
