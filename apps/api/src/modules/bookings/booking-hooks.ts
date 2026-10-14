import { Injectable } from '@nestjs/common';
import type { Booking, BookingStatus } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import type { OrgCtx } from '../../common/auth/request-ctx';

export interface BookingHook {
  afterCreate?(tx: OrgTx, ctx: OrgCtx, booking: Booking): Promise<void>;
  afterTransition?(tx: OrgTx, ctx: OrgCtx | null, booking: Booking, from: BookingStatus): Promise<void>;
  afterUpdate?(tx: OrgTx, ctx: OrgCtx, before: Booking, after: Booking): Promise<void>;
  /** Fill computed fields (M3: paid/balance/deposit). Mutates in place. */
  decorate?(tx: OrgTx, bookings: Booking[]): Promise<void>;
}

/** Extension point: payments (M3), messaging (M5) and tasks (M6) react to bookings without BookingsService knowing them. */
@Injectable()
export class BookingHooks {
  private readonly hooks: BookingHook[] = [];
  register(h: BookingHook) {
    this.hooks.push(h);
  }
  async run<K extends keyof BookingHook>(name: K, ...args: Parameters<NonNullable<BookingHook[K]>>) {
    for (const h of this.hooks) {
      const fn = h[name] as ((...a: unknown[]) => Promise<void>) | undefined;
      if (fn) await fn.apply(h, args);
    }
  }
}
