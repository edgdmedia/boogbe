import { Inject, Injectable } from '@nestjs/common';
import type { Owner, OwnerInput } from '@boogbe/shared';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { OrgDb } from '../../common/db/org-db.service';
import { PrismaService } from '../../common/db/prisma.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import { AUTH } from '../../common/auth/auth.tokens';
import type { Auth } from '../../common/auth/auth';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { toOwner } from './mappers';

@Injectable()
export class OwnersService {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  /** Invitations are a global (Better Auth) table, so they are read with the raw client scoped by organizationId. */
  private async portalStatus(ctx: OrgCtx, owners: { userId: string | null; email: string | null }[]) {
    const emails = owners.filter((o) => !o.userId && o.email).map((o) => o.email!.toLowerCase());
    const pending = emails.length
      ? await this.prisma.invitation.findMany({
          where: { organizationId: ctx.orgId, email: { in: emails }, role: 'landlord', status: 'pending' },
          select: { email: true },
        })
      : [];
    const set = new Set(pending.map((p) => p.email));
    return (o: { userId: string | null; email: string | null }): Owner['portalStatus'] =>
      o.userId ? 'active' : o.email && set.has(o.email.toLowerCase()) ? 'invited' : 'none';
  }

  async list(ctx: OrgCtx, includeArchived = false): Promise<Owner[]> {
    const rows = await this.orgDb.run(ctx.orgId, (tx) =>
      tx.owner.findMany({ where: includeArchived ? {} : { active: true }, orderBy: { name: 'asc' } }),
    );
    const status = await this.portalStatus(ctx, rows);
    return rows.map((r) => toOwner(r, status(r)));
  }

  async create(ctx: OrgCtx, input: OwnerInput): Promise<Owner> {
    const row = await this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.owner.create({
        data: { id: newId(), ...input, email: input.email?.toLowerCase() ?? null } as never,
      });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'owner.create',
        entity: 'owner',
        entityId: r.id,
        after: input,
      });
      return r;
    });
    return toOwner(row, 'none');
  }

  async update(ctx: OrgCtx, id: string, input: Partial<OwnerInput>): Promise<Owner> {
    const row = await this.orgDb.run(ctx.orgId, async (tx) => {
      const before = await tx.owner.findFirst({ where: { id } });
      if (!before) throw notFound('Owner');
      await tx.owner.updateMany({
        where: { id },
        data: { ...input, ...(input.email !== undefined && { email: input.email?.toLowerCase() ?? null }) },
      });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'owner.update',
        entity: 'owner',
        entityId: id,
        before,
        after: input,
      });
      return (await tx.owner.findFirst({ where: { id } }))!;
    });
    return toOwner(row, (await this.portalStatus(ctx, [row]))(row));
  }

  async archive(ctx: OrgCtx, id: string) {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.owner.updateMany({ where: { id }, data: { active: false } });
      if (!r.count) throw notFound('Owner');
      await this.audit.record(tx, { actor: ctx, action: 'owner.archive', entity: 'owner', entityId: id });
    });
    return { ok: true };
  }

  /** Invite the owner to the read-only portal. Uses the caller's session so Better Auth enforces invite permission. */
  async invite(ctx: OrgCtx, id: string, headers: IncomingHttpHeaders) {
    const owner = await this.orgDb.run(ctx.orgId, (tx) =>
      tx.owner.findFirst({ where: { id, active: true } }),
    );
    if (!owner) throw notFound('Owner');
    if (!owner.email)
      throw new AppError('VALIDATION_FAILED', 400, 'Add an email address for this owner first');
    if (owner.userId) throw new AppError('CONFLICT', 409, 'This owner already has portal access');
    const inv = await this.auth.api.createInvitation({
      headers: fromNodeHeaders(headers),
      body: { email: owner.email, role: 'landlord' as never, organizationId: ctx.orgId, resend: true },
    });
    return { invitationId: inv.id, portalStatus: 'invited' as const };
  }
}
