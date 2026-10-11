import { Injectable } from '@nestjs/common';
import { ownerOn, planOwnerChange, type IsoDate, type OwnershipPeriod } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AppError } from '../../common/http/app-error';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const date = (s: IsoDate) => new Date(`${s}T00:00:00Z`);

@Injectable()
export class OwnershipService {
  async periodsFor(tx: OrgTx, unitIds: string[]): Promise<Map<string, OwnershipPeriod[]>> {
    const rows = await tx.unitOwnership.findMany({
      where: { unitId: { in: unitIds } },
      orderBy: { effectiveFrom: 'asc' },
    });
    const map = new Map<string, OwnershipPeriod[]>(unitIds.map((id) => [id, []]));
    for (const r of rows) {
      map
        .get(r.unitId)!
        .push({
          ownerId: r.ownerId,
          from: iso(r.effectiveFrom),
          to: r.effectiveTo ? iso(r.effectiveTo) : null,
        });
    }
    return map;
  }

  async currentOwner(tx: OrgTx, unitIds: string[], asOf: IsoDate): Promise<Map<string, string | null>> {
    const periods = await this.periodsFor(tx, unitIds);
    return new Map(unitIds.map((id) => [id, ownerOn(periods.get(id) ?? [], asOf).ownerId]));
  }

  async setUnitOwner(
    tx: OrgTx,
    unitId: string,
    ownerId: string | null,
    effectiveFrom: IsoDate,
  ): Promise<void> {
    // Serialises concurrent ownership changes on one unit (the exclusion constraint is the backstop).
    await tx.$queryRaw`SELECT id FROM unit WHERE id = ${unitId} FOR UPDATE`;
    if (ownerId) {
      const o = await tx.owner.findFirst({ where: { id: ownerId, active: true } });
      if (!o) throw new AppError('VALIDATION_FAILED', 400, 'Owner not found');
    }
    const periods = (await this.periodsFor(tx, [unitId])).get(unitId)!;
    let plan;
    try {
      plan = planOwnerChange(periods, ownerId, effectiveFrom);
    } catch (e) {
      throw new AppError('INVALID_TRANSITION', 422, (e as Error).message);
    }
    switch (plan.kind) {
      case 'noop':
        return;
      case 'insert':
        await tx.unitOwnership.create({
          data: { id: newId(), unitId, ownerId, effectiveFrom: date(plan.insertFrom) } as never,
        });
        return;
      case 'replace':
        await tx.unitOwnership.updateMany({
          where: { unitId, effectiveFrom: date(plan.from), effectiveTo: null },
          data: { ownerId },
        });
        return;
      case 'split':
        await tx.unitOwnership.updateMany({
          where: { unitId, effectiveFrom: date(plan.closeFrom), effectiveTo: null },
          data: { effectiveTo: date(plan.insertFrom) },
        });
        await tx.unitOwnership.create({
          data: { id: newId(), unitId, ownerId, effectiveFrom: date(plan.insertFrom) } as never,
        });
        return;
    }
  }
}
