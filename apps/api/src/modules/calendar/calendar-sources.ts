import { Injectable } from '@nestjs/common';
import type { CalendarItem, IsoDate } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import type { OrgCtx } from '../../common/auth/request-ctx';

export interface Ignore {
  blockId?: string;
  bookingId?: string;
}

export interface CalendarSource {
  items(tx: OrgTx, unitIds: string[], from: IsoDate, to: IsoDate, ctx: OrgCtx): Promise<CalendarItem[]>;
  /** Returns the first hard conflict in [start, end) for the unit, or null. */
  conflicts?(
    tx: OrgTx,
    unitId: string,
    start: IsoDate,
    end: IsoDate,
    ignore?: Ignore,
  ): Promise<{ kind: 'booking' | 'block'; id: string } | null>;
}

/** Registry so M2 (bookings) and M4 (iCal) can add calendar items and availability checks without touching M1 code. */
@Injectable()
export class CalendarSources {
  private readonly sources: CalendarSource[] = [];
  register(s: CalendarSource) {
    this.sources.push(s);
  }
  all() {
    return this.sources;
  }
}
