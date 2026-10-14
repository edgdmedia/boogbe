import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { markdownToHtml, render, renderHtml, type TemplateKey, type TemplateVars } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';

export interface QueueEmail {
  bookingId?: string;
  paymentId?: string;
  templateKey?: TemplateKey;
  to: string;
  subject: string;
  /** Template Markdown. With `vars`, placeholders are filled as plain text (renderHtml), so a value can't add links or formatting. */
  bodyMarkdown: string;
  vars?: TemplateVars;
  dedupeKey?: string;
  actorMemberId?: string | null;
}

const toText = (md: string) => md.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]\n]+)\]\((https:[^)\s]+)\)/g, '$1 ($2)');

/** Transactional email goes through this table; MessageDispatchJob sends it. Queue inside the caller's transaction. */
@Injectable()
export class OutboxService {
  /** Null when `dedupeKey` was already queued for this org. */
  async queueEmail(tx: OrgTx, m: QueueEmail): Promise<{ id: string } | null> {
    if (m.dedupeKey && (await tx.outboundMessage.findFirst({ where: { dedupeKey: m.dedupeKey } }))) return null;
    const id = newId();
    // Strip the template's own Markdown first, then fill values, so values reach the text part untouched.
    const bodyText = m.vars ? render(toText(m.bodyMarkdown), m.vars) : toText(m.bodyMarkdown);
    const bodyHtml = m.vars ? renderHtml(m.bodyMarkdown, m.vars) : markdownToHtml(m.bodyMarkdown);
    try {
      // A savepoint, so a lost dedupe race doesn't abort the caller's transaction.
      await tx.$executeRaw`SAVEPOINT queue_email`;
      await tx.outboundMessage.create({
        data: {
          id,
          bookingId: m.bookingId ?? null,
          paymentId: m.paymentId ?? null,
          templateKey: m.templateKey ?? null,
          channel: 'email',
          recipient: m.to,
          subject: m.subject,
          bodyText,
          bodyHtml,
          status: 'queued',
          dedupeKey: m.dedupeKey ?? null,
          actorMemberId: m.actorMemberId ?? null,
        } as never,
      });
      await tx.$executeRaw`RELEASE SAVEPOINT queue_email`;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT queue_email`;
        return null;
      }
      throw e;
    }
    return { id };
  }

  async logWhatsapp(
    tx: OrgTx,
    m: { bookingId: string; templateKey: TemplateKey; to: string; text: string; actorMemberId: string | null },
  ) {
    await tx.outboundMessage.create({
      data: {
        id: newId(),
        bookingId: m.bookingId,
        templateKey: m.templateKey,
        channel: 'whatsapp',
        recipient: m.to,
        bodyText: m.text,
        status: 'whatsapp_opened',
        actorMemberId: m.actorMemberId,
        sentAt: new Date(),
      } as never,
    });
  }
}
