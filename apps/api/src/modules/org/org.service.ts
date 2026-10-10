import { Injectable } from '@nestjs/common';
import type { OrgSettingsResponse, UpdateOrgSettingsInput } from '@boogbe/shared';
import { PrismaService } from '../../common/db/prisma.service';
import { OrgDb } from '../../common/db/org-db.service';
import { AuditService } from '../../common/audit/audit.service';
import type { OrgCtx } from '../../common/auth/request-ctx';

const ORG_FIELDS = ['name', 'contactEmail', 'contactPhone', 'whatsappPhone', 'address'] as const;

@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
  ) {}

  async get(ctx: OrgCtx): Promise<OrgSettingsResponse> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
    const s = await this.orgDb.run(ctx.orgId, (tx) => tx.orgSettings.findFirstOrThrow());
    return {
      org: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        timezone: org.timezone,
        currency: org.currency,
        contactEmail: org.contactEmail,
        contactPhone: org.contactPhone,
        whatsappPhone: org.whatsappPhone,
        address: org.address,
      },
      settings: {
        checkInTime: s.checkInTime,
        checkOutTime: s.checkOutTime,
        holdHours: s.holdHours,
        autoConfirmOnPayment: s.autoConfirmOnPayment,
        ownerSeesGuestNames: s.ownerSeesGuestNames,
        receiptPrefix: s.receiptPrefix,
        statementPrefix: s.statementPrefix,
        bookingPrefix: s.bookingPrefix,
      },
    };
  }

  async update(ctx: OrgCtx, input: UpdateOrgSettingsInput): Promise<OrgSettingsResponse> {
    const before = await this.get(ctx);
    const orgPatch = Object.fromEntries(ORG_FIELDS.filter((k) => k in input).map((k) => [k, input[k]]));
    const settingsPatch = Object.fromEntries(
      Object.entries(input).filter(([k]) => !(ORG_FIELDS as readonly string[]).includes(k)),
    );
    if (Object.keys(orgPatch).length) await this.prisma.organization.updateMany({ where: { id: ctx.orgId }, data: orgPatch });
    await this.orgDb.run(ctx.orgId, async (tx) => {
      if (Object.keys(settingsPatch).length) await tx.orgSettings.updateMany({ data: settingsPatch });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'settings.update',
        entity: 'org_settings',
        entityId: ctx.orgId,
        before,
        after: input,
      });
    });
    return this.get(ctx);
  }
}
