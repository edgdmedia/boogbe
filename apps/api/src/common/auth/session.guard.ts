import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { ORG_ROLES, can, type OrgRole } from '@boogbe/shared';
import { PrismaService } from '../db/prisma.service';
import { AppError } from '../http/app-error';
import type { Auth } from './auth';
import { AUTH } from './auth.tokens';
import { ACCESS_KEY, type AccessRule } from './decorators';
import type { RequestCtx } from './request-ctx';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule>(ACCESS_KEY, [ec.getHandler(), ec.getClass()]);
    if (!rule) throw new AppError('FORBIDDEN', 403, 'Route has no access rule'); // fail closed
    if (rule.kind === 'public') return true;

    const req = ec.switchToHttp().getRequest();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new AppError('UNAUTHENTICATED', 401, 'Please sign in');

    const ctx: RequestCtx = {
      userId: session.user.id,
      email: session.user.email,
      isPlatformAdmin: (session.user as { role?: string }).role === 'admin',
      orgId: null,
      role: null,
      memberId: null,
      timezone: null,
    };
    const activeOrgId = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId;
    if (activeOrgId) {
      // Role is always read from the DB, never trusted from the session (as Unclutter roles.guard.ts).
      const member = await this.prisma.member.findFirst({
        where: { organizationId: activeOrgId, userId: ctx.userId },
        include: { organization: { select: { status: true, timezone: true } } },
      });
      if (member && (ORG_ROLES as readonly string[]).includes(member.role)) {
        if (member.organization.status !== 'active' && rule.kind === 'permission') {
          throw new AppError('ORG_SUSPENDED', 403, 'This operator account is suspended');
        }
        Object.assign(ctx, {
          orgId: activeOrgId,
          role: member.role as OrgRole,
          memberId: member.id,
          timezone: member.organization.timezone,
        });
      }
    }
    req.ctx = ctx;

    if (rule.kind === 'signedIn') return true;
    if (rule.kind === 'platformAdmin') {
      if (!ctx.isPlatformAdmin) throw new AppError('FORBIDDEN', 403, 'Platform admins only');
      return true;
    }
    if (!ctx.role) throw new AppError('NO_ACTIVE_ORG', 400, 'Choose an operator first');
    if (!can(ctx.role, rule.permission)) throw new AppError('FORBIDDEN', 403, 'You do not have permission to do that');
    return true;
  }
}
