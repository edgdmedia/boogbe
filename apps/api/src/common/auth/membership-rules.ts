import type { PrismaClient } from '@prisma/client';
import { APIError } from 'better-auth/api';
import { ORG_ROLES, type OrgRole } from '@boogbe/shared';

export function assertKnownRole(role: string): asserts role is OrgRole {
  if (!(ORG_ROLES as readonly string[]).includes(role)) {
    throw new APIError('BAD_REQUEST', { message: `Unknown role "${role}"` });
  }
}

/** nextRole = null means the member is being removed. */
export async function assertNotLastAdmin(
  prisma: PrismaClient,
  orgId: string,
  memberId: string,
  nextRole: OrgRole | null,
) {
  const target = await prisma.member.findUnique({ where: { id: memberId } });
  if (!target || target.role !== 'admin' || nextRole === 'admin') return;
  const admins = await prisma.member.count({ where: { organizationId: orgId, role: 'admin' } });
  if (admins <= 1) throw new APIError('BAD_REQUEST', { message: 'An operator needs at least one admin' });
}
