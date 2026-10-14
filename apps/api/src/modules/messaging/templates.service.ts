import { Injectable } from '@nestjs/common';
import {
  DEFAULT_TEMPLATES,
  markdownToHtml,
  render,
  SAMPLE_VARS,
  TEMPLATE_KEYS,
  TEMPLATE_LABELS,
  type MessageTemplate,
  type PreviewResponse,
  type PreviewTemplateInput,
  type TemplateKey,
  type UpdateTemplateInput,
} from '@boogbe/shared';
import type { MessageTemplate as Row } from '@prisma/client';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { OrgInfo } from '../../common/db/org-info';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import type { OrgCtx } from '../../common/auth/request-ctx';

const toTemplate = (r: Row): MessageTemplate => ({
  key: r.key as TemplateKey,
  label: TEMPLATE_LABELS[r.key as TemplateKey],
  emailSubject: r.emailSubject,
  emailBody: r.emailBody,
  whatsappBody: r.whatsappBody,
  autoEmail: r.autoEmail,
  active: r.active,
  updatedAt: r.updatedAt.toISOString(),
});

/** Per-operator message templates (MSG-01, MSG-02). Defaults are created on first use. */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
    private readonly orgInfo: OrgInfo,
  ) {}

  /** Inserts any missing default template; safe to call concurrently (unique (org, key) + skipDuplicates). */
  async ensureDefaults(tx: OrgTx): Promise<void> {
    const have = new Set((await tx.messageTemplate.findMany({ select: { key: true } })).map((r) => r.key));
    const missing = TEMPLATE_KEYS.filter((k) => !have.has(k));
    if (missing.length) {
      await tx.messageTemplate.createMany({
        data: missing.map((k) => ({ id: newId(), key: k, ...DEFAULT_TEMPLATES[k] })) as never,
        skipDuplicates: true,
      });
    }
  }

  async getIn(tx: OrgTx, key: TemplateKey): Promise<MessageTemplate> {
    await this.ensureDefaults(tx);
    return toTemplate((await tx.messageTemplate.findFirst({ where: { key } }))!);
  }

  list(ctx: OrgCtx): Promise<{ items: MessageTemplate[] }> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      await this.ensureDefaults(tx);
      const rows = await tx.messageTemplate.findMany();
      return { items: TEMPLATE_KEYS.map((k) => toTemplate(rows.find((r) => r.key === k)!)) };
    });
  }

  update(ctx: OrgCtx, key: TemplateKey, input: UpdateTemplateInput): Promise<MessageTemplate> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const before = await this.getIn(tx, key);
      await tx.messageTemplate.updateMany({ where: { key }, data: input });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'template.update',
        entity: 'message_template',
        entityId: key,
        before,
        after: input,
      });
      return this.getIn(tx, key);
    });
  }

  /** Sample guest and booking, but the operator's own name and contacts, so the preview looks like theirs. */
  async preview(ctx: OrgCtx, input: PreviewTemplateInput): Promise<PreviewResponse> {
    const org = await this.orgInfo.get(ctx.orgId);
    const vars = {
      ...SAMPLE_VARS,
      'operator.name': org.name,
      ...(org.phone && { 'operator.phone': org.phone }),
      ...(org.email && { 'operator.email': org.email }),
    };
    return {
      emailSubject: render(input.emailSubject, vars),
      emailHtml: markdownToHtml(render(input.emailBody, vars)),
      whatsappText: render(input.whatsappBody, vars),
    };
  }
}
