import { Injectable } from '@nestjs/common';
import type { PaymentEntry } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import type { OrgCtx } from '../../common/auth/request-ctx';

export interface PaymentHook {
  afterRecord?(tx: OrgTx, ctx: OrgCtx, bookingId: string, entry: PaymentEntry): Promise<void>;
}

/** Extension point: M5 queues the receipt email when a payment or deposit is recorded. */
@Injectable()
export class PaymentHooks {
  private readonly hooks: PaymentHook[] = [];
  register(h: PaymentHook) {
    this.hooks.push(h);
  }
  async afterRecord(tx: OrgTx, ctx: OrgCtx, bookingId: string, entry: PaymentEntry) {
    for (const h of this.hooks) await h.afterRecord?.(tx, ctx, bookingId, entry);
  }
}
