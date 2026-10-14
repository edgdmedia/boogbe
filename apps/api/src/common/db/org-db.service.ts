import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { orgScope, orgStore } from './org-scope.extension';

export type OrgTx = Prisma.TransactionClient;
type CounterName = 'receipt' | 'statement' | 'booking';

@Injectable()
export class OrgDb {
  private readonly scoped;
  constructor(prisma: PrismaService) {
    this.scoped = prisma.$extends(orgScope);
  }

  /** Runs `fn` in a transaction with app.org_id set for RLS and orgId injected into every tenant query. */
  run<T>(orgId: string, fn: (tx: OrgTx) => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
    if (!orgId) return Promise.reject(new Error('OrgDb.run: orgId required'));
    return orgStore.run({ orgId }, () =>
      this.scoped.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
          return fn(tx as unknown as OrgTx);
        },
        { timeout: opts.timeoutMs ?? 15_000, maxWait: 5_000 },
      ),
    );
  }

  /** Gapless per-org sequence. Must be called inside run(). */
  async nextNumber(tx: OrgTx, name: CounterName): Promise<number> {
    const rows = await tx.$queryRaw<{ value: bigint }[]>`
      INSERT INTO org_counter (org_id, name, value) VALUES (app_current_org(), ${name}, 1)
      ON CONFLICT (org_id, name) DO UPDATE SET value = org_counter.value + 1
      RETURNING value`;
    return Number(rows[0]!.value);
  }

  unsafeScopedClientForTests() {
    return this.scoped;
  }
}
