import { Injectable } from '@nestjs/common';
import { forgetPublicOrg } from '../public/public-org-cache';
import type { OrgSettingsResponse, UpdateOrgSettingsInput } from '@boogbe/shared';
import { PrismaService } from '../../common/db/prisma.service';
import { OrgDb } from '../../common/db/org-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { FilesService } from '../../common/files/files.service';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { bumpSiteVersion } from '../website/site-version';

const ORG_FIELDS = ['name', 'contactEmail', 'contactPhone', 'whatsappPhone', 'address'] as const;

@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
    private readonly files: FilesService,
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
        logoUrl: s.logoKey ? await this.files.signedUrlForKey(s.logoKey) : null,
        publicEnabled: s.publicEnabled,
        publicHoldMinutes: s.publicHoldMinutes,
        publicOrigins: s.publicOrigins,
        publicSiteUrl: s.publicSiteUrl,
        notifyEmails: s.notifyEmails,
      },
    };
  }

  async update(ctx: OrgCtx, input: UpdateOrgSettingsInput): Promise<OrgSettingsResponse> {
    const before = await this.get(ctx);
    const orgPatch = Object.fromEntries(ORG_FIELDS.filter((k) => k in input).map((k) => [k, input[k]]));
    // logoFileId is resolved to org_settings.logo_key below; it is not a column.
    const nonColumns = new Set(['logoFileId']);
    const settingsPatch = Object.fromEntries(
      Object.entries(input).filter(
        ([k]) => !(ORG_FIELDS as readonly string[]).includes(k) && !nonColumns.has(k),
      ),
    );
    if (Object.keys(orgPatch).length)
      await this.prisma.organization.updateMany({ where: { id: ctx.orgId }, data: orgPatch });
    await this.orgDb.run(ctx.orgId, async (tx) => {
      if ('logoFileId' in input) {
        settingsPatch.logoKey = input.logoFileId
          ? (await this.files.assertConfirmed(tx, input.logoFileId, 'logo')).key
          : null;
      }
      // The contract reduces each origin to scheme+host; two URLs on one site collapse to one origin.
      if (input.publicOrigins) settingsPatch.publicOrigins = [...new Set(input.publicOrigins)];
      if (input.notifyEmails)
        settingsPatch.notifyEmails = [...new Set(input.notifyEmails.map((e) => e.toLowerCase()))];
      if (Object.keys(settingsPatch).length) await tx.orgSettings.updateMany({ data: settingsPatch });
      // Toggling online booking flips every unit's `bookable` in /site (spec §5.2). Saving the
      // same value back is not a change and must not bump.
      if (input.publicEnabled !== undefined && input.publicEnabled !== before.settings.publicEnabled)
        await bumpSiteVersion(tx);
      await this.audit.record(tx, {
        actor: ctx,
        action: 'settings.update',
        entity: 'org_settings',
        entityId: ctx.orgId,
        before,
        after: input,
      });
    });
    // A public booking lookup cached before this change would otherwise answer from stale settings for 30 s.
    forgetPublicOrg(before.org.slug);
    return this.get(ctx);
  }
}
