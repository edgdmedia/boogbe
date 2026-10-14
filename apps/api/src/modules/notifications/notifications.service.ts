import { Injectable } from '@nestjs/common';
import type { Notification, OrgRole } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { AlertMailer } from './alert-mailer';

export interface NewNotification {
  kind: Notification['kind'];
  title: string;
  body?: string;
  link?: string;
  dedupeKey?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly alertMailer: AlertMailer,
  ) {}

  /** Returns how many rows were created; 0 when every recipient already had this dedupeKey. */
  private async insert(tx: OrgTx, userIds: string[], n: NewNotification): Promise<number> {
    if (!userIds.length) return 0;
    // (org, user, dedupeKey) is unique, so a job that runs twice never notifies twice.
    const r = await tx.notification.createMany({
      data: userIds.map((userId) => ({
        id: newId(),
        userId,
        kind: n.kind,
        title: n.title,
        body: n.body ?? null,
        link: n.link ?? null,
        dedupeKey: n.dedupeKey ?? null,
      })) as never,
      skipDuplicates: true,
    });
    return r.count;
  }

  /**
   * Members are a global table; read through the caller's transaction so no second pooled connection is taken.
   * `email` also mails the recipients, but only when the alert is new (the dedupeKey stops repeats).
   */
  async notifyRoles(
    tx: OrgTx,
    orgId: string,
    roles: OrgRole[],
    n: NewNotification,
    opts: { email?: boolean } = {},
  ) {
    const members = await tx.member.findMany({
      where: { organizationId: orgId, role: { in: roles } },
      select: { userId: true, user: { select: { email: true } } },
    });
    const created = await this.insert(
      tx,
      members.map((m) => m.userId),
      n,
    );
    if (opts.email && created > 0)
      await this.alertMailer.send(
        members.map((m) => m.user.email),
        n.title,
        n.body ?? n.title,
        n.link,
      );
  }

  async notifyMember(tx: OrgTx, orgId: string, memberId: string, n: NewNotification) {
    const m = await tx.member.findFirst({
      where: { organizationId: orgId, id: memberId },
      select: { userId: true },
    });
    if (m) await this.insert(tx, [m.userId], n);
  }

  list(ctx: OrgCtx) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const [items, unreadCount] = await Promise.all([
        tx.notification.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
        tx.notification.count({ where: { userId: ctx.userId, readAt: null } }),
      ]);
      return {
        unreadCount,
        items: items.map((n) => ({
          id: n.id,
          kind: n.kind as Notification['kind'],
          title: n.title,
          body: n.body,
          link: n.link,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
      };
    });
  }

  markRead(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.notification.updateMany({
        where: { id, userId: ctx.userId },
        data: { readAt: new Date() },
      });
      if (!r.count) throw notFound('Notification');
      return { ok: true };
    });
  }

  markAllRead(ctx: OrgCtx) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      await tx.notification.updateMany({
        where: { userId: ctx.userId, readAt: null },
        data: { readAt: new Date() },
      });
      return { ok: true };
    });
  }
}
