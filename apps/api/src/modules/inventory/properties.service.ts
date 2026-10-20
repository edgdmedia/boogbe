import { Injectable } from '@nestjs/common';
import type { Property, PropertyInput, SetPropertyOwnerInput } from '@boogbe/shared';
import { OrgDb } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { OwnershipService } from './ownership.service';
import { toProperty } from './mappers';
import { bumpSiteVersion } from '../website/site-version';

@Injectable()
export class PropertiesService {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
    private readonly ownership: OwnershipService,
  ) {}

  async list(ctx: OrgCtx, includeArchived: boolean): Promise<Property[]> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const rows = await tx.property.findMany({
        where: includeArchived ? {} : { active: true },
        orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { units: { where: { active: true } } } } },
      });
      const ownerIds = [...new Set(rows.map((r) => r.defaultOwnerId).filter((x): x is string => !!x))];
      const owners = new Map(
        (await tx.owner.findMany({ where: { id: { in: ownerIds } } })).map((o) => [o.id, o.name]),
      );
      return rows.map((r) =>
        toProperty(r, r._count.units, r.defaultOwnerId ? (owners.get(r.defaultOwnerId) ?? null) : null),
      );
    });
  }

  async get(ctx: OrgCtx, id: string): Promise<Property> {
    const p = (await this.list(ctx, true)).find((x) => x.id === id);
    if (!p) throw notFound('Property');
    return p;
  }

  async create(ctx: OrgCtx, input: PropertyInput): Promise<Property> {
    const id = newId();
    await this.orgDb.run(ctx.orgId, async (tx) => {
      await tx.property.create({
        data: { id, ...input, feeFixedMonthlyKobo: BigInt(input.feeFixedMonthlyKobo) } as never,
      });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'property.create',
        entity: 'property',
        entityId: id,
        after: input,
      });
    });
    return this.get(ctx, id);
  }

  async update(ctx: OrgCtx, id: string, input: Partial<PropertyInput>): Promise<Property> {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const before = await tx.property.findFirst({ where: { id } });
      if (!before) throw notFound('Property');
      await tx.property.updateMany({
        where: { id },
        data: {
          ...input,
          ...(input.feeFixedMonthlyKobo !== undefined && {
            feeFixedMonthlyKobo: BigInt(input.feeFixedMonthlyKobo),
          }),
        },
      });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'property.update',
        entity: 'property',
        entityId: id,
        before,
        after: input,
      });
    });
    return this.get(ctx, id);
  }

  async setActive(ctx: OrgCtx, id: string, active: boolean) {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.property.updateMany({ where: { id }, data: { active } });
      if (!r.count) throw notFound('Property');
      await this.audit.record(tx, {
        actor: ctx,
        action: active ? 'property.unarchive' : 'property.archive',
        entity: 'property',
        entityId: id,
      });
      // The site shows a linked unit only while its property is active.
      if (await tx.unit.count({ where: { propertyId: id, listingId: { not: null } } })) await bumpSiteVersion(tx);
    });
    return this.get(ctx, id);
  }

  /** Changes the default owner and moves every unit that follows the property, from effectiveFrom. */
  async setDefaultOwner(ctx: OrgCtx, id: string, input: SetPropertyOwnerInput): Promise<Property> {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const p = await tx.property.findFirst({ where: { id } });
      if (!p) throw notFound('Property');
      await tx.property.updateMany({ where: { id }, data: { defaultOwnerId: input.defaultOwnerId } });
      const units = await tx.unit.findMany({ where: { propertyId: id, ownerFollowsProperty: true } });
      for (const u of units)
        await this.ownership.setUnitOwner(tx, u.id, input.defaultOwnerId, input.effectiveFrom);
      await this.audit.record(tx, {
        actor: ctx,
        action: 'property.owner_change',
        entity: 'property',
        entityId: id,
        before: { defaultOwnerId: p.defaultOwnerId },
        after: input,
      });
    });
    return this.get(ctx, id);
  }
}
