import { Injectable } from '@nestjs/common';
import type { UnitFee, UnitFeeInput } from '@boogbe/shared';
import type { UnitFee as Row } from '@prisma/client';
import { OrgDb } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { kobo } from './mappers';
import { bumpSiteVersion, siteRelevant } from '../website/site-version';

const toFee = (r: Row): UnitFee => ({
  id: r.id,
  unitId: r.unitId,
  kind: r.kind as UnitFee['kind'],
  label: r.label,
  amountKobo: kobo(r.amountKobo),
  basis: r.basis as UnitFee['basis'],
  includedGuests: r.includedGuests,
  refundable: r.refundable,
  active: r.active,
});

@Injectable()
export class FeesService {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
  ) {}

  list(ctx: OrgCtx, unitId: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      if (!(await tx.unit.findFirst({ where: { id: unitId } }))) throw notFound('Unit');
      return (
        await tx.unitFee.findMany({ where: { unitId, active: true }, orderBy: { createdAt: 'asc' } })
      ).map(toFee);
    });
  }

  create(ctx: OrgCtx, unitId: string, input: UnitFeeInput) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const u = await tx.unit.findFirst({ where: { id: unitId } });
      if (!u) throw notFound('Unit');
      const r = await tx.unitFee.create({
        data: {
          id: newId(),
          unitId,
          kind: input.kind,
          label: input.label,
          amountKobo: BigInt(input.amountKobo),
          basis: input.basis,
          includedGuests: input.includedGuests ?? null,
          // Only caution deposits are refunded to the guest (INV-05).
          refundable: input.kind === 'caution_deposit',
          active: input.active,
        } as never,
      });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'fee.create',
        entity: 'unit_fee',
        entityId: r.id,
        after: input,
      });
      // Any fee write on a linked unit can change the site's caution-deposit figure.
      if (siteRelevant(u)) await bumpSiteVersion(tx);
      return toFee(r);
    });
  }

  update(
    ctx: OrgCtx,
    id: string,
    input: Partial<Pick<UnitFeeInput, 'label' | 'amountKobo' | 'includedGuests'>>,
  ) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const before = await tx.unitFee.findFirst({ where: { id } });
      if (!before) throw notFound('Fee');
      await tx.unitFee.updateMany({
        where: { id },
        data: { ...input, ...(input.amountKobo !== undefined && { amountKobo: BigInt(input.amountKobo) }) },
      });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'fee.update',
        entity: 'unit_fee',
        entityId: id,
        before,
        after: input,
      });
      const u = await tx.unit.findFirst({ where: { id: before.unitId } });
      if (u && siteRelevant(u)) await bumpSiteVersion(tx);
      return toFee((await tx.unitFee.findFirst({ where: { id } }))!);
    });
  }

  archive(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const fee = await tx.unitFee.findFirst({ where: { id } });
      if (!fee) throw notFound('Fee');
      await tx.unitFee.updateMany({ where: { id }, data: { active: false } });
      await this.audit.record(tx, { actor: ctx, action: 'fee.archive', entity: 'unit_fee', entityId: id });
      const u = await tx.unit.findFirst({ where: { id: fee.unitId } });
      if (u && siteRelevant(u)) await bumpSiteVersion(tx);
      return { ok: true };
    });
  }
}
