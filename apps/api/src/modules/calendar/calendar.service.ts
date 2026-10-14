import { Injectable } from '@nestjs/common';
import { todayIn, type CalendarQuery, type CalendarResponse } from '@boogbe/shared';
import { OrgDb } from '../../common/db/org-db.service';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { CalendarSources } from './calendar-sources';
import { kobo } from '../inventory/mappers';

@Injectable()
export class CalendarService {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly sources: CalendarSources,
  ) {}

  get(ctx: OrgCtx, q: CalendarQuery): Promise<CalendarResponse> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const props = await tx.property.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { units: { where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
      });
      const withUnits = props.filter((p) => p.units.length);
      const unitIds = withUnits.flatMap((p) => p.units.map((u) => u.id));
      const items = unitIds.length
        ? (await Promise.all(this.sources.all().map((s) => s.items(tx, unitIds, q.from, q.to, ctx)))).flat()
        : [];
      return {
        from: q.from,
        to: q.to,
        today: todayIn(ctx.timezone),
        properties: withUnits.map((p) => ({
          id: p.id,
          name: p.name,
          units: p.units.map((u) => ({
            id: u.id,
            name: u.name,
            bedrooms: u.bedrooms,
            maxGuests: u.maxGuests,
            nightlyRateKobo: kobo(u.nightlyRateKobo),
          })),
        })),
        items: items.sort((a, b) => a.start.localeCompare(b.start)),
      };
    });
  }
}
