import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  ENTRY_LABELS,
  ledger,
  METHOD_LABELS,
  todayIn,
  validateEntry,
  type CancelBookingInput,
  type Booking,
  type BookingLedger,
  type LedgerEntry,
  type RecordEntryInput,
  type VoidInput,
} from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { MemberNames } from '../../common/db/member-names';
import { OrgInfo } from '../../common/db/org-info';
import { STORAGE, type Storage } from '../../common/files/storage';
import { renderReceipt } from '../../common/pdf/receipt';
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
type ReceiptFile = { filename: string; pdf: Buffer };

@Injectable()
export class PaymentsService implements OnModuleInit {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly audit: AuditService,
    private readonly names: MemberNames,
    private readonly bookingHooks: BookingHooks,
    private readonly bookings: BookingsService,
    readonly hooks: PaymentHooks,
    private readonly orgInfo: OrgInfo,
    @Inject(STORAGE) private readonly storage: Storage,
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

  /** Cancel and refund in one transaction: a refund that fails validation rolls the cancel back (BKG-11). */
  cancelWithRefund(ctx: OrgCtx, bookingId: string, input: CancelBookingInput) {
    return this.orgDb.run(ctx.orgId, (tx) => this.cancelWithRefundIn(tx, ctx, bookingId, input));
  }

  /** In the caller's transaction, so a conflict resolution and its cancel commit or roll back together (T-M4-05). */
  async cancelWithRefundIn(tx: OrgTx, ctx: OrgCtx, bookingId: string, input: CancelBookingInput) {
    await this.bookings.transitionIn(tx, ctx, ctx.orgId, bookingId, 'cancelled', input.reason);
    if (input.refundKobo && input.refundKobo > 0) {
      await this.recordIn(tx, ctx, bookingId, {
        kind: 'refund',
        amountKobo: input.refundKobo,
        method: input.refundMethod!,
        receivedOn: todayIn(ctx.timezone),
        reference: input.refundReference ?? null,
        note: input.reason,
      } as RecordEntryInput);
    }
    return this.bookings.getIn(tx, ctx.orgId, bookingId);
  }

  /** Receipt PDF for one money-in entry; the balance shown is the balance right after that entry (PAY-06). */
  async receipt(ctx: OrgCtx, paymentId: string): Promise<ReceiptFile> {
    return this.receiptForOrg(ctx.orgId, paymentId);
  }

  /** For the email outbox, which runs in the worker with an org id but no member (T-M5-04). */
  async receiptForOrg(orgId: string, paymentId: string): Promise<ReceiptFile> {
    const data = await this.orgDb.run(orgId, async (tx) => {
      const p = await tx.payment.findFirst({ where: { id: paymentId } });
      if (!p || !p.receiptNo) throw notFound('Receipt');
      const booking = await this.bookings.getIn(tx, orgId, p.bookingId);
      const rows = await tx.payment.findMany({
        where: { bookingId: p.bookingId, createdAt: { lte: p.createdAt } },
        orderBy: { createdAt: 'asc' },
      });
      const t = ledger(
        rows.map((r) => ({
          id: r.id,
          kind: r.kind as LedgerEntry['kind'],
          amountKobo: kobo(r.amountKobo),
          voidsPaymentId: r.voidsPaymentId,
        })),
        { finalTotalKobo: booking.finalTotalKobo, status: booking.status },
      );
      const s = await tx.orgSettings.findFirstOrThrow();
      const org = await this.orgInfo.get(orgId, tx);
      return { p, receiptNo: p.receiptNo, booking, t, logoKey: s.logoKey, org };
    });
    const logo = data.logoKey ? await this.storage.get(data.logoKey) : null;
    const pdf = await renderReceipt({
      org: { ...data.org, logo },
      receiptNo: data.receiptNo,
      issuedOn: data.p.receivedOn.toISOString().slice(0, 10),
      booking: {
        ref: data.booking.ref,
        unitName: data.booking.unit.name,
        propertyName: data.booking.unit.propertyName,
        checkIn: data.booking.checkIn,
        checkOut: data.booking.checkOut,
        nights: data.booking.nights,
      },
      guestName: data.booking.guest.fullName,
      entryLabel: ENTRY_LABELS[data.p.kind as keyof typeof ENTRY_LABELS],
      amountKobo: kobo(data.p.amountKobo),
      method: METHOD_LABELS[data.p.method as keyof typeof METHOD_LABELS],
      reference: data.p.reference,
      balanceAfterKobo: data.t.balanceKobo,
      depositHeldKobo: data.t.depositHeldKobo,
    });
    return { filename: `${data.receiptNo}.pdf`, pdf };
  }
}
