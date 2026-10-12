import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

/** User id → display name (global Better Auth table). Pass the caller's transaction when inside one. */
@Injectable()
export class UserNames {
  constructor(private readonly prisma: PrismaService) {}
  async forUsers(ids: string[], db: Pick<Prisma.TransactionClient, 'user'> = this.prisma) {
    if (!ids.length) return new Map<string, string>();
    const rows = await db.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((u) => [u.id, u.name]));
  }
}
