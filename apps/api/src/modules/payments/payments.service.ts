import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  ledger,
  validateEntry,
  type Booking,
  type BookingLedger,
  type LedgerEntry,
  type RecordEntryInput,
  type VoidInput,
} from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { MemberNames } from '../../common/db/member-names';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { BookingHooks } from '../bookings/booking-hooks';
import { BookingsService } from '../bookings/bookings.service';
import { kobo } from '../inventory/mappers';
import { toEntries } from './payments.mapper';
import { PaymentHooks } from './payment-hooks';

type VoidRequest = { kind: 'void'; voidsPaymentId: string; reason: string };

@Injectable()
export class PaymentsService implements OnModuleInit {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
    private readonly names: MemberNames,
    private readonly bookingHooks: BookingHooks,
    private readonly bookings: BookingsService,
    readonly hooks: PaymentHooks,
  ) {}

  /** Every Booking leaving the API carries paid/balance/deposit computed from the ledger (PAY-05: never stored). */
  onModuleInit() {
    this.bookingHooks.register({
      decorate: async (tx, list: Booking[]) => {
        const map = await this.entriesFor(
          tx,
          list.map((b) => b.id),
        );
        for (const b of list) {
          const t = ledger(map.get(b.id) ?? [], { finalTotalKobo: b.finalTotalKobo, status: b.status });
          b.paidKobo = t.netPaidKobo;
          b.balanceKobo = t.balanceKobo;
          b.depositHeldKobo = t.depositHeldKobo;
        }
      },
    });
  }

  async entriesFor(tx: OrgTx, bookingIds: string[]): Promise<Map<string, LedgerEntry[]>> {
    const rows = bookingIds.length
      ? await tx.payment.findMany({ where: { bookingId: { in: bookingIds } }, orderBy: { createdAt: 'asc' } })
      : [];
    const map = new Map<string, LedgerEntry[]>();
    for (const r of rows) {
      const list = map.get(r.bookingId) ?? [];
      list.push({
        id: r.id,
        kind: r.kind as LedgerEntry['kind'],
        amountKobo: kobo(r.amountKobo),
        voidsPaymentId: r.voidsPaymentId,
      });
      map.set(r.bookingId, list);
    }
    return map;
  }

  async ledgerIn(tx: OrgTx, orgId: string, bookingId: string): Promise<BookingLedger> {
    const b = await tx.booking.findFirst({ where: { id: bookingId } });
    if (!b) throw notFound('Booking');
    const rows = await tx.payment.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } });
    const names = await this.names.forMembers(
      orgId,
      rows.map((r) => r.recordedByMemberId).filter((x): x is string => !!x),
      tx,
    );
    const entries = toEntries(rows, names);
    return {
      entries,
      totals: ledger(
        entries.map((e) => ({
          id: e.id,
          kind: e.kind,
          amountKobo: e.amountKobo,
          voidsPaymentId: e.voidsPaymentId,
        })),
        { finalTotalKobo: kobo(b.finalTotalKobo), status: b.status as Booking['status'] },
      ),
    };
  }

  ledger(ctx: OrgCtx, bookingId: string) {
    return this.orgDb.run(ctx.orgId, (tx) => this.ledgerIn(tx, ctx.orgId, bookingId));
  }

  /** Locks the booking row first, so two concurrent refunds can't both pass validation. */
  async recordIn(tx: OrgTx, ctx: OrgCtx, bookingId: string, input: RecordEntryInput | VoidRequest) {
    const locked = await tx.$queryRaw<
      { id: string; status: string }[]
    >`SELECT id, status FROM booking WHERE id = ${bookingId} FOR UPDATE`;
    if (!locked[0]) throw notFound('Booking');
    const existing = (await this.entriesFor(tx, [bookingId])).get(bookingId) ?? [];
    const isVoid = input.kind === 'void';
    const target = isVoid
      ? await tx.payment.findFirst({ where: { id: input.voidsPaymentId, bookingId } })
      : null;
    const amountKobo = isVoid ? (target ? kobo(target.amountKobo) : 1) : input.amountKobo;
    const err = validateEntry(existing, {
      kind: input.kind,
      amountKobo,
      voidsPaymentId: isVoid ? input.voidsPaymentId : null,
    });
    if (err) throw new AppError('INVALID_TRANSITION', 422, err);

    const id = newId();
    // Receipts only for money in (PAY-01/06): payments and deposits received.
    const receiptNo =
      input.kind === 'payment' || input.kind === 'deposit_received'
        ? `${(await tx.orgSettings.findFirstOrThrow()).receiptPrefix}-R-${String(await this.orgDb.nextNumber(tx, 'receipt')).padStart(6, '0')}`
        : null;
    await tx.payment.create({
      data: {
        id,
        bookingId,
        kind: input.kind,
        amountKobo: BigInt(amountKobo),
        method: isVoid ? target!.method : input.method,
        receivedOn: isVoid ? target!.receivedOn : new Date(`${input.receivedOn}T00:00:00Z`),
        reference: isVoid ? null : (input.reference ?? null),
        note: isVoid ? input.reason : (input.note ?? null),
        receiptNo,
        voidsPaymentId: isVoid ? input.voidsPaymentId : null,
        recordedByMemberId: ctx.memberId,
      } as never,
    });
    await this.audit.record(tx, {
      actor: ctx,
      action: `payment.${input.kind}`,
      entity: 'payment',
      entityId: id,
      after: {
        bookingId,
        amountKobo,
        kind: input.kind,
        ...(isVoid && { voids: input.voidsPaymentId, reason: input.reason }),
      },
    });

    // BKG-09: the first payment confirms a tentative booking unless the operator switched it off.
    if (input.kind === 'payment' && locked[0].status === 'tentative') {
      const s = await tx.orgSettings.findFirstOrThrow();
      if (s.autoConfirmOnPayment)
        await this.bookings.transitionIn(tx, ctx, ctx.orgId, bookingId, 'confirmed', 'payment received');
    }
    const lg = await this.ledgerIn(tx, ctx.orgId, bookingId);
    await this.hooks.afterRecord(
      tx,
      ctx,
      bookingId,
      lg.entries.find((e) => e.id === id)!,
    );
    return { entryId: id };
  }

  record(ctx: OrgCtx, bookingId: string, input: RecordEntryInput) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      await this.recordIn(tx, ctx, bookingId, input);
      return this.ledgerIn(tx, ctx.orgId, bookingId);
    });
  }

  void(ctx: OrgCtx, bookingId: string, input: VoidInput) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      await this.recordIn(tx, ctx, bookingId, {
        kind: 'void',
        voidsPaymentId: input.paymentId,
        reason: input.reason,
      });
      return this.ledgerIn(tx, ctx.orgId, bookingId);
    });
  }
}
