import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertKobo, type Guest, type GuestInput } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';

const enc = (name: string, id: string) => Buffer.from(`${name}\u0000${id}`).toString('base64url');
const dec = (c: string) => {
  const [name, id] = Buffer.from(c, 'base64url').toString().split('\u0000');
  return { name: name!, id: id! };
};

interface Row {
  id: string;
  full_name: string;
  phone_e164: string;
  email: string | null;
  notes: string | null;
  booking_count: bigint | number;
  ltv: Prisma.Decimal | bigint | null;
  last_stay: Date | null;
}
const kobo = (v: Prisma.Decimal | bigint | null) => {
  const n = Number(v ?? 0);
  assertKobo(n);
  return n;
};
const toGuest = (r: Row): Guest => ({
  id: r.id,
  fullName: r.full_name,
  phoneE164: r.phone_e164,
  email: r.email,
  notes: r.notes,
  bookingCount: Number(r.booking_count),
  lifetimeValueKobo: kobo(r.ltv),
  lastStayAt: r.last_stay ? r.last_stay.toISOString().slice(0, 10) : null,
});

// Raw SQL inside OrgDb.run: RLS (app.org_id) scopes both tables, so no explicit org filter is needed.
const SELECT = Prisma.sql`
  SELECT g.id, g.full_name, g.phone_e164, g.email, g.notes,
         count(b.id) FILTER (WHERE b.status NOT IN ('cancelled')) AS booking_count,
         sum(b.final_total_kobo) FILTER (WHERE b.status IN ('confirmed','checked_in','checked_out')) AS ltv,
         max(b.check_in) FILTER (WHERE b.status IN ('checked_in','checked_out')) AS last_stay
  FROM guest g LEFT JOIN booking b ON b.guest_id = g.id`;

@Injectable()
export class GuestsService {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
  ) {}

  list(ctx: OrgCtx, q: { q?: string; cursor?: string; limit: number }) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const conds: Prisma.Sql[] = [Prisma.sql`g.anonymised_at IS NULL`];
      if (q.q) {
        const digits = q.q.replace(/\D/g, '');
        const like = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        const ors = [
          Prisma.sql`g.full_name ILIKE ${like}`,
          Prisma.sql`lower(g.email) LIKE ${q.q.toLowerCase() + '%'}`,
        ];
        // "0809…" typed locally matches "+234809…": drop the leading trunk 0.
        if (digits.length >= 4)
          ors.push(Prisma.sql`g.phone_e164 LIKE ${'%' + digits.replace(/^0/, '') + '%'}`);
        conds.push(Prisma.sql`(${Prisma.join(ors, ' OR ')})`);
      }
      if (q.cursor) {
        const c = dec(q.cursor);
        conds.push(Prisma.sql`(g.full_name, g.id) > (${c.name}, ${c.id})`);
      }
      const rows = await tx.$queryRaw<Row[]>`${SELECT} WHERE ${Prisma.join(conds, ' AND ')}
        GROUP BY g.id ORDER BY g.full_name, g.id LIMIT ${q.limit + 1}`;
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return {
        items: page.map(toGuest),
        nextCursor: rows.length > q.limit && last ? enc(last.full_name, last.id) : null,
      };
    });
  }

  match(ctx: OrgCtx, q: { phone?: string; email?: string }) {
    if (!q.phone && !q.email) return Promise.resolve({ items: [] });
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const ors: Prisma.Sql[] = [];
      if (q.phone) ors.push(Prisma.sql`g.phone_e164 = ${q.phone}`);
      if (q.email) ors.push(Prisma.sql`lower(g.email) = ${q.email.toLowerCase()}`);
      const rows = await tx.$queryRaw<
        Row[]
      >`${SELECT} WHERE g.anonymised_at IS NULL AND (${Prisma.join(ors, ' OR ')})
        GROUP BY g.id ORDER BY g.full_name LIMIT 5`;
      return { items: rows.map(toGuest) };
    });
  }

  async getIn(tx: OrgTx, id: string): Promise<Guest> {
    const rows = await tx.$queryRaw<Row[]>`${SELECT} WHERE g.id = ${id} GROUP BY g.id`;
    if (!rows[0]) throw notFound('Guest');
    return toGuest(rows[0]);
  }

  get(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, (tx) => this.getIn(tx, id));
  }

  create(ctx: OrgCtx, input: GuestInput) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const id = newId();
      await tx.guest.create({
        data: {
          id,
          fullName: input.fullName,
          phoneE164: input.phoneE164,
          email: input.email?.toLowerCase() ?? null,
          notes: input.notes ?? null,
        } as never,
      });
      await this.audit.record(tx, {
        actor: ctx,
        action: 'guest.create',
        entity: 'guest',
        entityId: id,
        after: { fullName: input.fullName },
      });
      return this.getIn(tx, id);
    });
  }

  update(ctx: OrgCtx, id: string, input: Partial<GuestInput>) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.guest.updateMany({
        where: { id, anonymisedAt: null },
        data: { ...input, ...(input.email !== undefined && { email: input.email?.toLowerCase() ?? null }) },
      });
      if (!r.count) throw notFound('Guest');
      await this.audit.record(tx, {
        actor: ctx,
        action: 'guest.update',
        entity: 'guest',
        entityId: id,
        after: input,
      });
      return this.getIn(tx, id);
    });
  }
}
