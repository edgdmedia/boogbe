import type { OrgRole } from '@boogbe/shared';
import { AppError } from '../http/app-error';

export interface RequestCtx {
  userId: string;
  email: string;
  isPlatformAdmin: boolean;
  orgId: string | null;
  role: OrgRole | null;
  memberId: string | null;
  timezone: string | null;
}

export interface OrgCtx {
  orgId: string;
  role: OrgRole;
  memberId: string;
  timezone: string;
  userId: string;
}

export function requireOrg(ctx: RequestCtx): OrgCtx {
  if (!ctx.orgId || !ctx.role || !ctx.memberId || !ctx.timezone) {
    throw new AppError('NO_ACTIVE_ORG', 400, 'Choose an operator first');
  }
  return { orgId: ctx.orgId, role: ctx.role, memberId: ctx.memberId, timezone: ctx.timezone, userId: ctx.userId };
}
