import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CreateOperatorInput, Operator, OperatorDetail, OrgRole } from '@boogbe/shared';
import { PrismaService } from '../../common/db/prisma.service';
import { OrgDb } from '../../common/db/org-db.service';
import { AppError, notFound } from '../../common/http/app-error';
import { MAILER } from '../../common/mail/mail.module';
import type { Mailer } from '../../common/mail/mailer';
import { inviteEmail } from '../../common/mail/templates';
import { loadEnv } from '../../env';
import { AuditService } from '../../common/audit/audit.service';

export const prefixFromSlug = (slug: string) => slug.replace(/[^a-z0-9]/g, '').slice(0, 3).toUpperCase().padEnd(2, 'X');

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  private toOperator(
    o: {
      id: string;
      name: string;
      slug: string;
      status: string;
      timezone: string;
      currency: string;
      createdAt: Date;
      _count: { members: number };
    },
    pending: number,
  ): Operator {
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      status: o.status as Operator['status'],
      timezone: o.timezone,
      currency: o.currency,
      createdAt: o.createdAt.toISOString(),
      memberCount: o._count.members,
      pendingInvites: pending,
    };
  }

  async list(): Promise<Operator[]> {
    const orgs = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { members: true } } },
    });
    const pending = await this.prisma.invitation.groupBy({ by: ['organizationId'], where: { status: 'pending' }, _count: true });
    const map = new Map(pending.map((p) => [p.organizationId, p._count]));
    return orgs.map((o) => this.toOperator(o, map.get(o.id) ?? 0));
  }

  async get(id: string): Promise<OperatorDetail> {
    const o = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        _count: { select: { members: true } },
        members: { include: { user: true } },
        invitations: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!o) throw notFound('Operator');
    return {
      ...this.toOperator(o, o.invitations.filter((i) => i.status === 'pending').length),
      members: o.members.map((m) => ({
        id: m.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role as OrgRole,
        createdAt: m.createdAt.toISOString(),
      })),
      invitations: o.invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role ?? 'admin',
        status: i.status,
        expiresAt: i.expiresAt.toISOString(),
      })),
    };
  }

  async createOperator(input: CreateOperatorInput, actorUserId: string): Promise<Operator> {
    const id = randomUUID();
    await this.prisma.organization.create({
      data: {
        id,
        name: input.name,
        slug: input.slug,
        timezone: input.timezone,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        whatsappPhone: input.whatsappPhone,
      },
    });
    const prefix = prefixFromSlug(input.slug);
    await this.orgDb.run(id, async (tx) => {
      await tx.orgSettings.create({ data: { receiptPrefix: prefix, statementPrefix: prefix, bookingPrefix: prefix } as never });
      await this.audit.record(tx, {
        actor: { userId: actorUserId, memberId: null },
        action: 'operator.create',
        entity: 'organization',
        entityId: id,
        after: input,
      });
    });
    return (await this.list()).find((o) => o.id === id)!;
  }

  async setStatus(id: string, status: 'active' | 'suspended', actorUserId: string) {
    const r = await this.prisma.organization.updateMany({ where: { id }, data: { status } });
    if (!r.count) throw notFound('Operator');
    await this.orgDb.run(id, (tx) =>
      this.audit.record(tx, {
        actor: { userId: actorUserId, memberId: null },
        action: `operator.${status}`,
        entity: 'organization',
        entityId: id,
      }),
    );
    return { ok: true };
  }

  /** Writes the invitation row directly: the platform admin is not a member, so Better Auth's member-scoped invite API can't be used. */
  async inviteAdmin(orgId: string, email: string, actorUserId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw notFound('Operator');
    await this.prisma.invitation.updateMany({
      where: { organizationId: orgId, email, status: 'pending' },
      data: { status: 'canceled' },
    });
    const inv = await this.prisma.invitation.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        email,
        role: 'admin',
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        inviterId: actorUserId,
      },
    });
    await this.sendInvite(inv.id, email, org.name, 'admin');
    await this.orgDb.run(orgId, (tx) =>
      this.audit.record(tx, {
        actor: { userId: actorUserId, memberId: null },
        action: 'invitation.create',
        entity: 'invitation',
        entityId: inv.id,
        after: { role: 'admin' },
      }),
    );
    return { id: inv.id, email, role: 'admin', status: 'pending', expiresAt: inv.expiresAt.toISOString() };
  }

  async resend(invitationId: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { id: invitationId }, include: { organization: true } });
    if (!inv || inv.status !== 'pending') throw notFound('Invitation');
    await this.prisma.invitation.update({ where: { id: inv.id }, data: { expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
    await this.sendInvite(inv.id, inv.email, inv.organization.name, (inv.role ?? 'admin') as OrgRole);
    return { ok: true };
  }

  async revoke(invitationId: string) {
    const r = await this.prisma.invitation.updateMany({
      where: { id: invitationId, status: 'pending' },
      data: { status: 'canceled' },
    });
    if (!r.count) throw new AppError('NOT_FOUND', 404, 'Invitation not found or not pending');
    return { ok: true };
  }

  private async sendInvite(id: string, email: string, orgName: string, role: OrgRole) {
    const url = `${loadEnv().APP_ORIGIN}/auth/accept-invite/${id}`;
    await this.mailer.send({ to: email, ...inviteEmail({ orgName, role, url }) });
  }
}
