import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface OrgBrandInfo {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
}

/** Letterhead facts and timezone from the global organization table. Pass the caller's transaction when there is one (see MemberNames). */
@Injectable()
export class OrgInfo {
  constructor(private readonly prisma: PrismaService) {}

  async get(
    orgId: string,
    db: Pick<Prisma.TransactionClient, 'organization'> = this.prisma,
  ): Promise<OrgBrandInfo> {
    const o = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
    return {
      name: o.name,
      address: o.address,
      phone: o.whatsappPhone ?? o.contactPhone,
      email: o.contactEmail,
      timezone: o.timezone,
    };
  }
}
