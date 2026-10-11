import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

/** Member → user display name. Members/users are global (Better Auth) tables, scoped here by organizationId. */
@Injectable()
export class MemberNames {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pass the caller's transaction when there is one: a second pooled connection taken from inside a
   * transaction can starve the pool under contention (every waiter holds one connection already).
   */
  async forMembers(
    orgId: string,
    memberIds: string[],
    db: Pick<Prisma.TransactionClient, 'member'> = this.prisma,
  ) {
    if (!memberIds.length) return new Map<string, string>();
    const rows = await db.member.findMany({
      where: { organizationId: orgId, id: { in: [...new Set(memberIds)] } },
      include: { user: { select: { name: true } } },
    });
    return new Map(rows.map((r) => [r.id, r.user.name]));
  }
}
