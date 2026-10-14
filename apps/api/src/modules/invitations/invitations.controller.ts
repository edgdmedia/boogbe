import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { OrgRole, PublicInvitation } from '@boogbe/shared';
import { PrismaService } from '../../common/db/prisma.service';
import { Public } from '../../common/auth/decorators';
import { notFound } from '../../common/http/app-error';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/public')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async publicView(@Param('id') id: string): Promise<PublicInvitation> {
    const inv = await this.prisma.invitation.findUnique({ where: { id }, include: { organization: { select: { name: true } } } });
    if (!inv) throw notFound('Invitation');
    const userExists = !!(await this.prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } }));
    return {
      id: inv.id,
      email: inv.email,
      orgName: inv.organization.name,
      role: (inv.role ?? 'admin') as OrgRole,
      status: inv.status,
      expired: inv.expiresAt < new Date(),
      userExists,
    };
  }
}
