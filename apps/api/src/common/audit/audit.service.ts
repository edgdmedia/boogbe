import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { newId } from '../db/ids';
import type { OrgTx } from '../db/org-db.service';

export interface AuditEntry {
  actor: { userId: string; memberId: string | null };
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

const PII_KEYS = new Set(['phone', 'phoneE164', 'email', 'accountNumber', 'password']);

function scrub(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(
    JSON.stringify(v, (k, val) => (PII_KEYS.has(k) ? '[redacted]' : typeof val === 'bigint' ? val.toString() : val)),
  );
}

@Injectable()
export class AuditService {
  async record(tx: OrgTx, e: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        id: newId(),
        actorUserId: e.actor.userId,
        actorMemberId: e.actor.memberId,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId,
        before: scrub(e.before),
        after: scrub(e.after),
        ip: e.ip ?? null,
      } as Prisma.AuditLogUncheckedCreateInput,
    });
  }
}
