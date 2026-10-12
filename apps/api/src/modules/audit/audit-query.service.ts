import { Injectable } from '@nestjs/common';
import type { AuditEntry } from '@boogbe/shared';
import { OrgDb } from '../../common/db/org-db.service';
import { UserNames } from '../../common/db/user-names';
import type { OrgCtx } from '../../common/auth/request-ctx';

@Injectable()
export class AuditQueryService {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly users: UserNames,
  ) {}

  list(ctx: OrgCtx, q: { entity?: string; entityId?: string; cursor?: string; limit: number }) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: {
          ...(q.entity && { entity: q.entity }),
          ...(q.entityId && { entityId: q.entityId }),
          ...(q.cursor && { id: { lt: q.cursor } }),
        },
        orderBy: { id: 'desc' }, // UUIDv7 ids sort by creation time
        take: q.limit + 1,
      });
      const page = rows.slice(0, q.limit);
      const names = await this.users.forUsers(
        page.map((r) => r.actorUserId),
        tx,
      );
      const items: AuditEntry[] = page.map((r) => ({
        id: r.id,
        at: r.at.toISOString(),
        actorName: names.get(r.actorUserId) ?? null,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        before: r.before,
        after: r.after,
      }));
      return { items, nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
    });
  }
}
