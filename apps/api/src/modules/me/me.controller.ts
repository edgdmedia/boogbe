import { Controller, Get } from '@nestjs/common';
import type { MeResponse, OrgRole } from '@boogbe/shared';
import { PrismaService } from '../../common/db/prisma.service';
import { Ctx, SignedIn } from '../../common/auth/decorators';
import type { RequestCtx } from '../../common/auth/request-ctx';

@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @SignedIn()
  async me(@Ctx() ctx: RequestCtx): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    const members = await this.prisma.member.findMany({
      where: { userId: ctx.userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    const active = members.find((m) => m.organizationId === ctx.orgId);
    return {
      user: { id: user.id, name: user.name, email: user.email, isPlatformAdmin: ctx.isPlatformAdmin },
      activeOrg: active
        ? {
            id: active.organization.id,
            name: active.organization.name,
            slug: active.organization.slug,
            role: active.role as OrgRole,
            timezone: active.organization.timezone,
            currency: active.organization.currency,
          }
        : null,
      memberships: members.map((m) => ({ orgId: m.organizationId, orgName: m.organization.name, role: m.role as OrgRole })),
    };
  }
}
