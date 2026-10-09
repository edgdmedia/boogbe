# M3 — Payments Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Claim each task in `docs/COORDINATION.md` before starting.

**Goal:** Record part-payments, caution deposits (received / returned / withheld), refunds and admin-only voids in an append-only ledger; show balance and deposit held everywhere; auto-confirm on first payment; refund on cancel; branded receipt PDFs; a money dashboard. Exit: E2E-04 passes; app role cannot UPDATE/DELETE payments.

**Architecture:** `payment` table is INSERT/SELECT-only for `boogbe_app`. Balances are never stored: the pure `ledger()` function in `packages/shared` is the single formula; a `booking_money` SQL view (`security_invoker`, so RLS applies) exists only for filtering/sorting lists and is pinned to `ledger()` by a consistency test. `PaymentsService` registers a `BookingHooks.decorate` so every `Booking` returned anywhere carries `paidKobo/balanceKobo/depositHeldKobo`. PDFs via `pdfkit` in `common/pdf`.

**Tech Stack:** as M2, plus `pdfkit`.

**Spec:** FRD PAY-01..07, BKG-09, BKG-11 (refund half), ORG-03 (receipt numbers).

**Depends on:** M2 complete.

## Global Constraints

- Ledger entry kinds: `payment`, `refund`, `deposit_received`, `deposit_returned`, `deposit_withheld`, `void`. `amount_kobo > 0` always; direction comes from `kind`.
- Methods: `bank_transfer`, `cash`, `pos`, `card`, `paystack`, `other`.
- `balance = (status = 'cancelled' ? 0 : finalTotal) − paid + refunded` (negative = overpaid / credit owed). `retained = paid − refunded` for cancelled bookings. `depositHeld = received − returned − withheld`.
- Voided entries are excluded from every sum; a `void` can only target a non-void, not-already-voided entry; void is admin-only (`payments.void`) and needs a reason.
- Receipt number `<receiptPrefix>-R-<6-digit seq>` for `payment` and `deposit_received` only, from `org_counter('receipt')`.
- Never format naira by hand: `formatNaira`.

## Review Focus

1. **Refund larger than what was paid** → 422 (T-M3-03 test `refund cannot exceed net paid`).
2. **Returning or withholding more deposit than is held** → 422 (T-M3-03 test `deposit return cannot exceed held`).
3. **Voiding a void, or voiding the same entry twice** → 422 (T-M3-03 test `void twice refused`).
4. **Overpayment** shows a negative balance labelled "Overpaid" rather than an error (T-M3-03 test `overpayment gives negative balance`; T-M3-06 UI test).
5. **SQL balance filter disagreeing with the TS formula** (T-M3-03 test `booking_money view agrees with ledger()`).

## Parallel split

| Task | Track | Agent | Depends on |
|---|---|---|---|
| T-M3-01 Ledger domain + contracts | domain | Claude Code | M2 |
| T-M3-02 Schema: payment, views, grants | schema | Claude Code | T-M3-01 |
| T-M3-03 Payments API, decorate, auto-confirm, balance filter, calendar balance | api | Claude Code | T-M3-02 |
| T-M3-04 Cancel-with-refund + receipt PDF | api | Claude Code | T-M3-03 |
| T-M3-05 Money summary API | api | Claude Code | T-M3-03 |
| T-M3-06 Payments panel + refund-on-cancel UI | ui | OpenCode | T-M3-01 (stub), merge after T-M3-04 |
| T-M3-07 Money dashboard UI + E2E-04 | ui/e2e | OpenCode | T-M3-05, T-M3-06 |

---

### Task 1 (T-M3-01) [domain]: Ledger maths and payment contracts

**Files:**
- Create: `packages/shared/src/domain/ledger.ts`, `packages/shared/src/contracts/payments.ts`, `packages/shared/src/contracts/money.ts`
- Modify: `packages/shared/src/contracts/bookings.ts` (`CancelBookingInput` gains refund fields), `packages/shared/src/index.ts`
- Test: `packages/shared/src/domain/ledger.test.ts`

**Interfaces (produced):**
```ts
export type EntryKind = 'payment'|'refund'|'deposit_received'|'deposit_returned'|'deposit_withheld'|'void';
export interface LedgerEntry { id: string; kind: EntryKind; amountKobo: number; voidsPaymentId: string | null }
export interface LedgerTotals { paidKobo; refundedKobo; netPaidKobo; depositReceivedKobo; depositReturnedKobo; depositWithheldKobo; depositHeldKobo; balanceKobo; retainedKobo }
export function effectiveEntries(entries: LedgerEntry[]): LedgerEntry[]          // drops voids and voided
export function ledger(entries: LedgerEntry[], b: { finalTotalKobo: number; status: BookingStatus }): LedgerTotals
export function validateEntry(entries: LedgerEntry[], next: { kind: EntryKind; amountKobo: number; voidsPaymentId?: string | null }): string | null  // error message or null
// contracts/payments.ts
PaymentMethod enum; RecordEntryInput { kind (not 'void'); amountKobo; method; receivedOn; reference?; note? } (note required for deposit_withheld)
VoidInput { paymentId; reason }
PaymentEntry { id; kind; amountKobo; method; receivedOn; reference; note; receiptNo; voided: boolean; voidsPaymentId; recordedByName; createdAt }
BookingLedger { entries: PaymentEntry[]; totals: LedgerTotals }
// contracts/money.ts
MoneyQuery { from; to; propertyId? }; MoneySummary { receivedByMethod: {method; kobo}[]; totalReceivedKobo; refundsKobo; depositsHeldKobo; outstanding: BookingSummary[]; depositsToReturn: { bookingId; ref; guestName; unitName; checkOut; heldKobo }[] }
// CancelBookingInput
{ reason; refundKobo?: number; refundMethod?: PaymentMethod; refundReference?: string }
```

- [ ] **Step 1: Failing tests**

`packages/shared/src/domain/ledger.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { effectiveEntries, ledger, validateEntry, type LedgerEntry } from './ledger';

const e = (id: string, kind: LedgerEntry['kind'], amountKobo: number, voidsPaymentId: string | null = null): LedgerEntry => ({ id, kind, amountKobo, voidsPaymentId });

describe('ledger [PAY-05]', () => {
  const entries = [e('p1', 'payment', 30_000_000), e('p2', 'payment', 20_000_000), e('d1', 'deposit_received', 10_000_000), e('r1', 'refund', 5_000_000)];
  it('computes balance and deposit held', () => {
    expect(ledger(entries, { finalTotalKobo: 60_000_000, status: 'confirmed' })).toEqual({
      paidKobo: 50_000_000, refundedKobo: 5_000_000, netPaidKobo: 45_000_000,
      depositReceivedKobo: 10_000_000, depositReturnedKobo: 0, depositWithheldKobo: 0, depositHeldKobo: 10_000_000,
      balanceKobo: 15_000_000, retainedKobo: 45_000_000,
    });
  });
  it('excludes voided entries and the void itself', () => {
    const t = ledger([...entries, e('v1', 'void', 20_000_000, 'p2')], { finalTotalKobo: 60_000_000, status: 'confirmed' });
    expect(t.paidKobo).toBe(30_000_000);
    expect(t.balanceKobo).toBe(35_000_000);
    expect(effectiveEntries([...entries, e('v1', 'void', 20_000_000, 'p2')]).map((x) => x.id)).toEqual(['p1', 'd1', 'r1']);
  });
  it('cancelled bookings owe nothing; retained is net paid', () => {
    expect(ledger(entries, { finalTotalKobo: 60_000_000, status: 'cancelled' })).toMatchObject({ balanceKobo: 0, retainedKobo: 45_000_000 });
  });
  it('overpayment gives negative balance', () => {
    expect(ledger([e('p', 'payment', 70_000_000)], { finalTotalKobo: 60_000_000, status: 'confirmed' }).balanceKobo).toBe(-10_000_000);
  });
});

describe('validateEntry [PAY-02 PAY-03 PAY-04]', () => {
  const base = [e('p1', 'payment', 50_000_000), e('d1', 'deposit_received', 10_000_000)];
  it('refund cannot exceed net paid', () => {
    expect(validateEntry(base, { kind: 'refund', amountKobo: 50_000_001 })).toBe('Refund is more than the guest has paid (₦500,000)');
    expect(validateEntry(base, { kind: 'refund', amountKobo: 50_000_000 })).toBeNull();
  });
  it('deposit return/withhold cannot exceed held', () => {
    expect(validateEntry(base, { kind: 'deposit_returned', amountKobo: 10_000_001 })).toBe('Only ₦100,000 deposit is held');
    expect(validateEntry([...base, e('w', 'deposit_withheld', 4_000_000)], { kind: 'deposit_returned', amountKobo: 7_000_000 })).toBe('Only ₦60,000 deposit is held');
  });
  it('void twice refused; void of a void refused; unknown target refused', () => {
    const withVoid = [...base, e('v1', 'void', 50_000_000, 'p1')];
    expect(validateEntry(withVoid, { kind: 'void', amountKobo: 50_000_000, voidsPaymentId: 'p1' })).toBe('That entry is already voided');
    expect(validateEntry(withVoid, { kind: 'void', amountKobo: 50_000_000, voidsPaymentId: 'v1' })).toBe('A void cannot be voided');
    expect(validateEntry(base, { kind: 'void', amountKobo: 1, voidsPaymentId: 'nope' })).toBe('Entry not found');
  });
  it('voiding a payment that funded a later refund is refused', () => {
    const t = [e('p1', 'payment', 50_000_000), e('r1', 'refund', 50_000_000)];
    expect(validateEntry(t, { kind: 'void', amountKobo: 50_000_000, voidsPaymentId: 'p1' })).toBe('Void the refund first — it would exceed what was paid');
  });
});
```
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @boogbe/shared test` → FAIL.

- [ ] **Step 3: Implement**

`packages/shared/src/domain/ledger.ts`:
```ts
import type { BookingStatus } from '../contracts/calendar';
import { formatNaira, sumKobo } from './money';

export type EntryKind = 'payment' | 'refund' | 'deposit_received' | 'deposit_returned' | 'deposit_withheld' | 'void';
export interface LedgerEntry { id: string; kind: EntryKind; amountKobo: number; voidsPaymentId: string | null }
export interface LedgerTotals {
  paidKobo: number; refundedKobo: number; netPaidKobo: number;
  depositReceivedKobo: number; depositReturnedKobo: number; depositWithheldKobo: number; depositHeldKobo: number;
  balanceKobo: number; retainedKobo: number;
}

export function effectiveEntries(entries: LedgerEntry[]): LedgerEntry[] {
  const voided = new Set(entries.filter((x) => x.kind === 'void').map((x) => x.voidsPaymentId));
  return entries.filter((x) => x.kind !== 'void' && !voided.has(x.id));
}

const sumOf = (es: LedgerEntry[], k: EntryKind) => sumKobo(es.filter((x) => x.kind === k).map((x) => x.amountKobo));

export function ledger(entries: LedgerEntry[], b: { finalTotalKobo: number; status: BookingStatus }): LedgerTotals {
  const es = effectiveEntries(entries);
  const paid = sumOf(es, 'payment'); const refunded = sumOf(es, 'refund');
  const dr = sumOf(es, 'deposit_received'); const dret = sumOf(es, 'deposit_returned'); const dw = sumOf(es, 'deposit_withheld');
  const net = paid - refunded;
  return {
    paidKobo: paid, refundedKobo: refunded, netPaidKobo: net,
    depositReceivedKobo: dr, depositReturnedKobo: dret, depositWithheldKobo: dw, depositHeldKobo: dr - dret - dw,
    balanceKobo: b.status === 'cancelled' ? 0 : b.finalTotalKobo - net,
    retainedKobo: net,
  };
}

export function validateEntry(entries: LedgerEntry[], next: { kind: EntryKind; amountKobo: number; voidsPaymentId?: string | null }): string | null {
  if (!Number.isSafeInteger(next.amountKobo) || next.amountKobo <= 0) return 'Amount must be more than ₦0';
  const t = ledger(entries, { finalTotalKobo: 0, status: 'confirmed' });
  switch (next.kind) {
    case 'refund':
      return next.amountKobo > t.netPaidKobo ? `Refund is more than the guest has paid (${formatNaira(t.netPaidKobo)})` : null;
    case 'deposit_returned':
    case 'deposit_withheld':
      return next.amountKobo > t.depositHeldKobo ? `Only ${formatNaira(t.depositHeldKobo)} deposit is held` : null;
    case 'void': {
      const target = entries.find((x) => x.id === next.voidsPaymentId);
      if (!target) return 'Entry not found';
      if (target.kind === 'void') return 'A void cannot be voided';
      if (entries.some((x) => x.kind === 'void' && x.voidsPaymentId === target.id)) return 'That entry is already voided';
      const after = ledger([...entries, { id: '_', kind: 'void', amountKobo: target.amountKobo, voidsPaymentId: target.id }], { finalTotalKobo: 0, status: 'confirmed' });
      if (after.netPaidKobo < 0) return 'Void the refund first — it would exceed what was paid';
      if (after.depositHeldKobo < 0) return 'Void the deposit return first — it would exceed what was received';
      return null;
    }
    default:
      return null;
  }
}
```
`packages/shared/src/contracts/payments.ts`:
```ts
import { z } from 'zod';
import { IsoDateSchema, Kobo } from './common';

export const PaymentMethod = z.enum(['bank_transfer', 'cash', 'pos', 'card', 'paystack', 'other']);
export type PaymentMethod = z.infer<typeof PaymentMethod>;
export const METHOD_LABELS: Record<PaymentMethod, string> = { bank_transfer: 'Bank transfer', cash: 'Cash', pos: 'POS', card: 'Card', paystack: 'Paystack', other: 'Other' };
export const EntryKindEnum = z.enum(['payment', 'refund', 'deposit_received', 'deposit_returned', 'deposit_withheld', 'void']);
export const ENTRY_LABELS: Record<z.infer<typeof EntryKindEnum>, string> = { payment: 'Payment', refund: 'Refund', deposit_received: 'Deposit received', deposit_returned: 'Deposit returned', deposit_withheld: 'Deposit kept', void: 'Void' };

export const RecordEntryInput = z.object({
  kind: EntryKindEnum.exclude(['void']),
  amountKobo: Kobo.refine((v) => v > 0, 'Amount must be more than ₦0'),
  method: PaymentMethod,
  receivedOn: IsoDateSchema,
  reference: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
}).refine((x) => x.kind !== 'deposit_withheld' || (x.note && x.note.length >= 3), { path: ['note'], message: 'Say why the deposit is kept' });
export type RecordEntryInput = z.infer<typeof RecordEntryInput>;
export const VoidInput = z.object({ paymentId: z.string(), reason: z.string().trim().min(3).max(300) });
export type VoidInput = z.infer<typeof VoidInput>;

export const PaymentEntry = z.object({
  id: z.string(), kind: EntryKindEnum, amountKobo: z.number().int(), method: PaymentMethod, receivedOn: z.string(),
  reference: z.string().nullable(), note: z.string().nullable(), receiptNo: z.string().nullable(),
  voided: z.boolean(), voidsPaymentId: z.string().nullable(), recordedByName: z.string().nullable(), createdAt: z.string(),
});
export type PaymentEntry = z.infer<typeof PaymentEntry>;
export const LedgerTotalsSchema = z.object({
  paidKobo: z.number().int(), refundedKobo: z.number().int(), netPaidKobo: z.number().int(),
  depositReceivedKobo: z.number().int(), depositReturnedKobo: z.number().int(), depositWithheldKobo: z.number().int(), depositHeldKobo: z.number().int(),
  balanceKobo: z.number().int(), retainedKobo: z.number().int(),
});
export const BookingLedger = z.object({ entries: z.array(PaymentEntry), totals: LedgerTotalsSchema });
export type BookingLedger = z.infer<typeof BookingLedger>;
```
`packages/shared/src/contracts/money.ts`:
```ts
import { z } from 'zod';
import { BookingSummary } from './bookings';
import { IsoDateSchema } from './common';
import { PaymentMethod } from './payments';

export const MoneyQuery = z.object({ from: IsoDateSchema, to: IsoDateSchema, propertyId: z.string().optional() }).refine((q) => q.to > q.from, { path: ['to'], message: 'to must be after from' });
export const MoneySummary = z.object({
  receivedByMethod: z.array(z.object({ method: PaymentMethod, kobo: z.number().int() })),
  totalReceivedKobo: z.number().int(), refundsKobo: z.number().int(), depositsHeldKobo: z.number().int(),
  outstanding: z.array(BookingSummary),
  depositsToReturn: z.array(z.object({ bookingId: z.string(), ref: z.string(), guestName: z.string(), unitName: z.string(), checkOut: z.string(), heldKobo: z.number().int() })),
});
export type MoneySummary = z.infer<typeof MoneySummary>;
```
In `bookings.ts` replace `CancelBookingInput`:
```ts
export const CancelBookingInput = z.object({
  reason: z.string().trim().min(3).max(300),
  refundKobo: Kobo.optional(),
  refundMethod: z.enum(['bank_transfer', 'cash', 'pos', 'card', 'paystack', 'other']).optional(),
  refundReference: z.string().max(120).optional(),
}).refine((c) => !c.refundKobo || !!c.refundMethod, { path: ['refundMethod'], message: 'How was the refund paid?' });
```
Exports in `index.ts`: ledger, payments, money.

- [ ] **Step 4: Run tests** — PASS. **Step 5: Commit**
```bash
git add packages/shared
git commit -m "feat(shared): ledger maths, payment and money contracts, refund on cancel contract [PAY-01..05 BKG-11]"
```

---

### Task 2 (T-M3-02) [schema]: Payment table, ledger views, append-only grants

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/0005_payments/migration.sql`; Test `apps/api/test/payments-schema.int.ts`.

- [ ] **Step 1: Schema**
```prisma
model Payment {
  id                 String   @id
  orgId              String   @map("org_id")
  bookingId          String   @map("booking_id")
  booking            Booking  @relation(fields: [bookingId], references: [id])
  kind               String
  amountKobo         BigInt   @map("amount_kobo")
  method             String
  receivedOn         DateTime @db.Date @map("received_on")
  reference          String?
  externalRef        String?  @map("external_ref")
  note               String?
  receiptNo          String?  @map("receipt_no")
  voidsPaymentId     String?  @map("voids_payment_id")
  recordedByMemberId String?  @map("recorded_by_member_id")
  createdAt          DateTime @default(now()) @map("created_at")

  @@index([orgId, bookingId, createdAt])
  @@index([orgId, receivedOn])
  @@map("payment")
}
```
(Add `payments Payment[]` to `Booking`.)

- [ ] **Step 2: Migration SQL** (`0005_payments`, appended):
```sql
ALTER TABLE payment ADD CONSTRAINT payment_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE payment ADD CONSTRAINT payment_voids_fk FOREIGN KEY (voids_payment_id) REFERENCES payment(id);
ALTER TABLE payment ADD CONSTRAINT payment_amount_chk CHECK (amount_kobo > 0);
ALTER TABLE payment ADD CONSTRAINT payment_kind_chk CHECK (kind IN ('payment','refund','deposit_received','deposit_returned','deposit_withheld','void'));
ALTER TABLE payment ADD CONSTRAINT payment_method_chk CHECK (method IN ('bank_transfer','cash','pos','card','paystack','other'));
ALTER TABLE payment ADD CONSTRAINT payment_void_target_chk CHECK ((kind = 'void') = (voids_payment_id IS NOT NULL));
CREATE UNIQUE INDEX payment_one_void_per_entry ON payment (voids_payment_id) WHERE kind = 'void';
CREATE UNIQUE INDEX payment_receipt_no ON payment (org_id, receipt_no) WHERE receipt_no IS NOT NULL;

ALTER TABLE payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON payment USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
REVOKE UPDATE, DELETE ON payment FROM boogbe_app;

-- Views run with the caller's rights so RLS still applies.
CREATE VIEW payment_effective WITH (security_invoker = true) AS
  SELECT p.* FROM payment p
  WHERE p.kind <> 'void' AND NOT EXISTS (SELECT 1 FROM payment v WHERE v.kind = 'void' AND v.voids_payment_id = p.id);

CREATE VIEW booking_money WITH (security_invoker = true) AS
  SELECT b.id AS booking_id, b.org_id, b.status, b.final_total_kobo,
    COALESCE(sum(e.amount_kobo) FILTER (WHERE e.kind = 'payment'), 0)::bigint AS paid_kobo,
    COALESCE(sum(e.amount_kobo) FILTER (WHERE e.kind = 'refund'), 0)::bigint AS refunded_kobo,
    (COALESCE(sum(e.amount_kobo) FILTER (WHERE e.kind = 'deposit_received'), 0)
      - COALESCE(sum(e.amount_kobo) FILTER (WHERE e.kind IN ('deposit_returned','deposit_withheld')), 0))::bigint AS deposit_held_kobo,
    CASE WHEN b.status = 'cancelled' THEN 0
         ELSE b.final_total_kobo - COALESCE(sum(e.amount_kobo) FILTER (WHERE e.kind = 'payment'), 0) + COALESCE(sum(e.amount_kobo) FILTER (WHERE e.kind = 'refund'), 0)
    END::bigint AS balance_kobo
  FROM booking b LEFT JOIN payment_effective e ON e.booking_id = b.id
  GROUP BY b.id;
GRANT SELECT ON payment_effective, booking_money TO boogbe_app;
```
- [ ] **Step 3: Failing test** `apps/api/test/payments-schema.int.ts`:
```ts
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';

describe('payment ledger is append-only [PAY-04]', () => {
  let c: Client; let orgId: string; let bookingId: string;
  beforeAll(async () => { c = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await c.connect(); });
  afterAll(async () => { await c.end(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id;
    bookingId = await seedBooking(orgId, await seedUnit(orgId, await seedProperty(orgId)), await seedGuest(orgId), { checkIn: '2026-11-01', checkOut: '2026-11-03' });
  });
  const inOrg = async <T>(fn: () => Promise<T>) => { await c.query('begin'); await c.query(`select set_config('app.org_id',$1,true)`, [orgId]); try { return await fn(); } finally { await c.query('rollback'); } };

  it('app role can insert and select but not update or delete', async () => {
    await inOrg(async () => {
      const id = newId();
      await c.query(`insert into payment(id, org_id, booking_id, kind, amount_kobo, method, received_on) values ($1,$2,$3,'payment',100,'cash','2026-10-10')`, [id, orgId, bookingId]);
      await expect(c.query(`update payment set amount_kobo = 1 where id = $1`, [id])).rejects.toThrow(/permission denied/);
    });
    await inOrg(async () => { await expect(c.query(`delete from payment`)).rejects.toThrow(/permission denied/); });
  });

  it('booking_money respects RLS and voids', async () => {
    await inOrg(async () => {
      const p1 = newId(); const p2 = newId();
      await c.query(`insert into payment(id, org_id, booking_id, kind, amount_kobo, method, received_on) values ($1,$2,$3,'payment',4000000,'cash','2026-10-10'),($4,$2,$3,'payment',1000000,'cash','2026-10-10')`, [p1, orgId, bookingId, p2]);
      await c.query(`insert into payment(id, org_id, booking_id, kind, amount_kobo, method, received_on, voids_payment_id) values ($1,$2,$3,'void',1000000,'cash','2026-10-10',$4)`, [newId(), orgId, bookingId, p2]);
      const { rows } = await c.query(`select paid_kobo, balance_kobo from booking_money where booking_id = $1`, [bookingId]);
      expect(rows[0]).toEqual({ paid_kobo: '4000000', balance_kobo: '6000000' });
    });
    const { rows } = await c.query(`select count(*)::int n from booking_money`);
    expect(rows[0].n).toBe(0); // no org set
  });
});
```
- [ ] **Step 4:** `pnpm db:reset && pnpm --filter @boogbe/api prisma:generate && pnpm test:int` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(db): append-only payment ledger with security-invoker balance views [PAY-04 PAY-05]"`

Note for `rls.int.ts` coverage test: views have no `relkind = 'r'`, so they are not checked; `security_invoker` makes them safe — this note is the reason.

---

### Task 3 (T-M3-03) [api]: Payments API, booking decoration, auto-confirm, balance filter, calendar balances

**Files:**
- Create: `apps/api/src/modules/payments/{payments.module.ts,payments.controller.ts,payments.service.ts,payments.mapper.ts}`
- Modify: `apps/api/src/modules/bookings/bookings.service.ts` (`balanceDue` SQL filter), `apps/api/src/modules/bookings/booking-source.ts` (balances), `apps/api/src/app.module.ts`, `apps/api/test/helpers/routes.ts`
- Test: `apps/api/test/payments.int.ts`

**Interfaces:**
- `GET /v1/bookings/:id/ledger` (`payments.read`) → `BookingLedger`.
- `POST /v1/bookings/:id/payments` (`payments.write`) body `RecordEntryInput` → `BookingLedger` 201. Locks the booking row (`SELECT … FOR UPDATE`) before validating so concurrent refunds can't both pass.
- `POST /v1/bookings/:id/payments/void` (`payments.void`) body `VoidInput` → `BookingLedger`.
- `PaymentsService.recordIn(tx, ctx, bookingId, input): Promise<{ entryId: string }>` (used by cancel-with-refund and M5's receipt email hook), `ledgerFor(tx, bookingIds: string[]): Map<bookingId, { entries: LedgerEntry[] }>`.
- `PaymentHooks` registry: `register({ afterRecord(tx, ctx, bookingId, entry) })` — M5 queues receipt email on `payment`/`deposit_received`.
- Decoration: on module init `bookingHooks.register({ decorate })` sets `paidKobo = netPaidKobo`, `balanceKobo`, `depositHeldKobo` for every booking.
- Auto-confirm (BKG-09): after a `payment` entry, if booking is `tentative` and `org_settings.auto_confirm_on_payment`, call `BookingsService.transitionIn(tx, ctx, orgId, id, 'confirmed', 'payment received')`.
- `balanceDue=true` filter: `id IN (SELECT booking_id FROM booking_money WHERE balance_kobo > 0)` added to the Prisma where via `{ id: { in: ids } }` precomputed with `$queryRaw` — replaces the post-filter from M2.
- Calendar booking items get `balanceKobo` from `booking_money`.

- [ ] **Step 1: Failing tests** `apps/api/test/payments.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { ledger } from '@boogbe/shared';

describe('payments [PAY-01..05 BKG-09]', () => {
  let t: TestApp; let fd: Agent; let admin: Agent; let orgId: string; let bookingId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id;
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'TAN','TAN','TAN',now())`, [orgId]);
    await m.end();
    const unitId = await seedUnit(orgId, await seedProperty(orgId), { rateKobo: 20_000_000 });
    fd = (await signInAs(t, 'frontdesk', orgId)).agent; admin = (await signInAs(t, 'admin', orgId)).agent;
    await admin.post(`/v1/units/${unitId}/fees`).send({ kind: 'caution_deposit', label: 'Caution deposit', amountKobo: 10_000_000, basis: 'per_stay' }).expect(201);
    bookingId = (await fd.post('/v1/bookings').send({ unitId, guestId: await seedGuest(orgId), checkIn: '2026-11-01', checkOut: '2026-11-04', guestCount: 2, source: 'whatsapp' }).expect(201)).body.id;
  });
  const pay = (body: Record<string, unknown>, agent = fd) => agent.post(`/v1/bookings/${bookingId}/payments`).send({ method: 'bank_transfer', receivedOn: '2026-10-10', ...body });

  it('part-payment updates balance, issues a receipt number and auto-confirms', async () => {
    const r = (await pay({ kind: 'payment', amountKobo: 30_000_000, reference: 'GTB-123' }).expect(201)).body;
    expect(r.totals).toMatchObject({ paidKobo: 30_000_000, balanceKobo: 30_000_000 });
    expect(r.entries[0].receiptNo).toBe('TAN-R-000001');
    const b = (await fd.get(`/v1/bookings/${bookingId}`).expect(200)).body;
    expect(b).toMatchObject({ status: 'confirmed', paidKobo: 30_000_000, balanceKobo: 30_000_000, depositHeldKobo: 0 });
  });

  it('auto-confirm can be switched off', async () => {
    await admin.patch('/v1/org/settings').send({ autoConfirmOnPayment: false }).expect(200);
    await pay({ kind: 'payment', amountKobo: 1_000_000 }).expect(201);
    expect((await fd.get(`/v1/bookings/${bookingId}`).expect(200)).body.status).toBe('tentative');
  });

  it('deposit received, partly withheld with a note, rest returned', async () => {
    await pay({ kind: 'deposit_received', amountKobo: 10_000_000 }).expect(201);
    await pay({ kind: 'deposit_withheld', amountKobo: 2_000_000 }).expect(400); // note required
    await pay({ kind: 'deposit_withheld', amountKobo: 2_000_000, note: 'Broken glass' }).expect(201);
    await pay({ kind: 'deposit_returned', amountKobo: 9_000_000 }).expect(422);
    const r = (await pay({ kind: 'deposit_returned', amountKobo: 8_000_000 }).expect(201)).body;
    expect(r.totals.depositHeldKobo).toBe(0);
  });

  it('refund cannot exceed net paid', async () => {
    await pay({ kind: 'payment', amountKobo: 5_000_000 }).expect(201);
    expect((await pay({ kind: 'refund', amountKobo: 5_000_001 })).status).toBe(422);
  });

  it('overpayment gives negative balance', async () => {
    const r = (await pay({ kind: 'payment', amountKobo: 70_000_000 }).expect(201)).body;
    expect(r.totals.balanceKobo).toBe(-10_000_000);
  });

  it('void is admin-only, needs a reason, cannot repeat', async () => {
    const p = (await pay({ kind: 'payment', amountKobo: 5_000_000 }).expect(201)).body.entries[0];
    await fd.post(`/v1/bookings/${bookingId}/payments/void`).send({ paymentId: p.id, reason: 'Wrong booking' }).expect(403);
    const r = (await admin.post(`/v1/bookings/${bookingId}/payments/void`).send({ paymentId: p.id, reason: 'Wrong booking' }).expect(200)).body;
    expect(r.totals.paidKobo).toBe(0);
    expect(r.entries.find((e: { id: string }) => e.id === p.id).voided).toBe(true);
    await admin.post(`/v1/bookings/${bookingId}/payments/void`).send({ paymentId: p.id, reason: 'again' }).expect(422);
  });

  it('balanceDue filter and booking_money view agree with ledger()', async () => {
    await pay({ kind: 'payment', amountKobo: 20_000_000 }).expect(201);
    const list = (await fd.get('/v1/bookings?balanceDue=true').expect(200)).body.items;
    expect(list).toHaveLength(1);
    const lg = (await fd.get(`/v1/bookings/${bookingId}/ledger`).expect(200)).body;
    const b = (await fd.get(`/v1/bookings/${bookingId}`).expect(200)).body;
    const ts = ledger(lg.entries.map((e: { id: string; kind: string; amountKobo: number; voidsPaymentId: string | null }) => e), { finalTotalKobo: b.finalTotalKobo, status: b.status });
    expect(list[0].balanceKobo).toBe(ts.balanceKobo);
  });

  it('calendar items carry the balance', async () => {
    await pay({ kind: 'payment', amountKobo: 20_000_000 }).expect(201);
    const cal = (await fd.get('/v1/calendar?from=2026-11-01&to=2026-11-05').expect(200)).body;
    expect(cal.items[0].balanceKobo).toBe(40_000_000);
  });
});
```
- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Implement**

`apps/api/src/modules/payments/payments.mapper.ts`:
```ts
import type { PaymentEntry } from '@boogbe/shared';
import type { Payment } from '@prisma/client';
import { kobo } from '../inventory/mappers';

export function toEntries(rows: Payment[], names: Map<string, string>): PaymentEntry[] {
  const voided = new Set(rows.filter((r) => r.kind === 'void').map((r) => r.voidsPaymentId));
  return rows.map((r) => ({
    id: r.id, kind: r.kind as PaymentEntry['kind'], amountKobo: kobo(r.amountKobo), method: r.method as PaymentEntry['method'],
    receivedOn: r.receivedOn.toISOString().slice(0, 10), reference: r.reference, note: r.note, receiptNo: r.receiptNo,
    voided: voided.has(r.id), voidsPaymentId: r.voidsPaymentId, recordedByName: r.recordedByMemberId ? names.get(r.recordedByMemberId) ?? null : null, createdAt: r.createdAt.toISOString(),
  }));
}
```
`apps/api/src/modules/payments/payment-hooks.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { PaymentEntry } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import type { OrgCtx } from '../../common/auth/request-ctx';
export interface PaymentHook { afterRecord?(tx: OrgTx, ctx: OrgCtx, bookingId: string, entry: PaymentEntry): Promise<void> }
@Injectable()
export class PaymentHooks {
  private readonly hooks: PaymentHook[] = [];
  register(h: PaymentHook) { this.hooks.push(h); }
  async afterRecord(tx: OrgTx, ctx: OrgCtx, bookingId: string, entry: PaymentEntry) { for (const h of this.hooks) await h.afterRecord?.(tx, ctx, bookingId, entry); }
}
```
`apps/api/src/modules/payments/payments.service.ts`:
```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ledger, validateEntry, type Booking, type BookingLedger, type LedgerEntry, type RecordEntryInput, type VoidInput } from '@boogbe/shared';
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

@Injectable()
export class PaymentsService implements OnModuleInit {
  constructor(
    private readonly orgDb: OrgDb, private readonly audit: AuditService, private readonly names: MemberNames,
    private readonly bookingHooks: BookingHooks, private readonly bookings: BookingsService, readonly hooks: PaymentHooks,
  ) {}

  onModuleInit() {
    this.bookingHooks.register({
      decorate: async (tx, list: Booking[]) => {
        const map = await this.entriesFor(tx, list.map((b) => b.id));
        for (const b of list) {
          const t = ledger(map.get(b.id) ?? [], { finalTotalKobo: b.finalTotalKobo, status: b.status });
          b.paidKobo = t.netPaidKobo; b.balanceKobo = t.balanceKobo; b.depositHeldKobo = t.depositHeldKobo;
        }
      },
    });
  }

  async entriesFor(tx: OrgTx, bookingIds: string[]): Promise<Map<string, LedgerEntry[]>> {
    const rows = bookingIds.length ? await tx.payment.findMany({ where: { bookingId: { in: bookingIds } }, orderBy: { createdAt: 'asc' } }) : [];
    const map = new Map<string, LedgerEntry[]>();
    for (const r of rows) {
      const list = map.get(r.bookingId) ?? []; list.push({ id: r.id, kind: r.kind as LedgerEntry['kind'], amountKobo: kobo(r.amountKobo), voidsPaymentId: r.voidsPaymentId }); map.set(r.bookingId, list);
    }
    return map;
  }

  async ledgerIn(tx: OrgTx, orgId: string, bookingId: string): Promise<BookingLedger> {
    const b = await tx.booking.findFirst({ where: { id: bookingId } });
    if (!b) throw notFound('Booking');
    const rows = await tx.payment.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } });
    const names = await this.names.forMembers(orgId, rows.map((r) => r.recordedByMemberId).filter((x): x is string => !!x));
    const entries = toEntries(rows, names);
    return { entries, totals: ledger(entries.map((e) => ({ id: e.id, kind: e.kind, amountKobo: e.amountKobo, voidsPaymentId: e.voidsPaymentId })), { finalTotalKobo: kobo(b.finalTotalKobo), status: b.status as Booking['status'] }) };
  }

  ledger(ctx: OrgCtx, bookingId: string) { return this.orgDb.run(ctx.orgId, (tx) => this.ledgerIn(tx, ctx.orgId, bookingId)); }

  async recordIn(tx: OrgTx, ctx: OrgCtx, bookingId: string, input: RecordEntryInput | ({ kind: 'void'; voidsPaymentId: string; reason: string })) {
    const locked = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT id, status FROM booking WHERE id = ${bookingId} FOR UPDATE`;
    if (!locked[0]) throw notFound('Booking');
    const existing = (await this.entriesFor(tx, [bookingId])).get(bookingId) ?? [];
    const isVoid = input.kind === 'void';
    const target = isVoid ? await tx.payment.findFirst({ where: { id: input.voidsPaymentId, bookingId } }) : null;
    const amountKobo = isVoid ? (target ? kobo(target.amountKobo) : 1) : input.amountKobo;
    const err = validateEntry(existing, { kind: input.kind, amountKobo, voidsPaymentId: isVoid ? input.voidsPaymentId : null });
    if (err) throw new AppError('INVALID_TRANSITION', 422, err);

    const id = newId();
    const receiptNo = input.kind === 'payment' || input.kind === 'deposit_received'
      ? `${(await tx.orgSettings.findFirstOrThrow()).receiptPrefix}-R-${String(await this.orgDb.nextNumber(tx, 'receipt')).padStart(6, '0')}` : null;
    await tx.payment.create({ data: {
      id, bookingId, kind: input.kind, amountKobo: BigInt(amountKobo),
      method: isVoid ? target!.method : input.method, receivedOn: isVoid ? target!.receivedOn : new Date(`${input.receivedOn}T00:00:00Z`),
      reference: isVoid ? null : input.reference ?? null, note: isVoid ? input.reason : input.note ?? null,
      receiptNo, voidsPaymentId: isVoid ? input.voidsPaymentId : null, recordedByMemberId: ctx.memberId,
    } as never });
    await this.audit.record(tx, { actor: ctx, action: `payment.${input.kind}`, entity: 'payment', entityId: id, after: { bookingId, amountKobo, kind: input.kind, ...(isVoid && { voids: input.voidsPaymentId, reason: input.reason }) } });

    if (input.kind === 'payment' && locked[0].status === 'tentative') {
      const s = await tx.orgSettings.findFirstOrThrow();
      if (s.autoConfirmOnPayment) await this.bookings.transitionIn(tx, ctx, ctx.orgId, bookingId, 'confirmed', 'payment received');
    }
    const lg = await this.ledgerIn(tx, ctx.orgId, bookingId);
    await this.hooks.afterRecord(tx, ctx, bookingId, lg.entries.find((e) => e.id === id)!);
    return { entryId: id };
  }

  record(ctx: OrgCtx, bookingId: string, input: RecordEntryInput) {
    return this.orgDb.run(ctx.orgId, async (tx) => { await this.recordIn(tx, ctx, bookingId, input); return this.ledgerIn(tx, ctx.orgId, bookingId); });
  }

  void(ctx: OrgCtx, bookingId: string, input: VoidInput) {
    return this.orgDb.run(ctx.orgId, async (tx) => { await this.recordIn(tx, ctx, bookingId, { kind: 'void', voidsPaymentId: input.paymentId, reason: input.reason }); return this.ledgerIn(tx, ctx.orgId, bookingId); });
  }
}
```
`payments.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { RecordEntryInput, VoidInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { PaymentsService } from './payments.service';

class RecordDto extends createZodDto(RecordEntryInput) {}
class VoidDto extends createZodDto(VoidInput) {}

@Controller('bookings/:id')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}
  @Get('ledger') @Permission('payments.read') ledger(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.ledger(requireOrg(c), id); }
  @Post('payments') @Permission('payments.write') record(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: RecordDto) { return this.svc.record(requireOrg(c), id, b); }
  @Post('payments/void') @HttpCode(200) @Permission('payments.void') void(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: VoidDto) { return this.svc.void(requireOrg(c), id, b); }
}
```
`payments.module.ts`: `@Global() @Module({ controllers: [PaymentsController], providers: [PaymentsService, PaymentHooks], exports: [PaymentsService, PaymentHooks] })`. Import in `AppModule` after `BookingsModule`; also in `WorkerModule` (decorate must run when the worker loads bookings).

`BookingsService.list` — replace the M2 post-filter:
```ts
      let idFilter: Prisma.BookingWhereInput = {};
      if (q.balanceDue === 'true') {
        const due = await tx.$queryRaw<{ booking_id: string }[]>`SELECT booking_id FROM booking_money WHERE balance_kobo > 0`;
        idFilter = { id: { in: due.map((d) => d.booking_id) } };
      }
```
merge `idFilter` into `where` and delete the `items.filter(...)` line.

`BookingSourceImpl.items` — after loading rows:
```ts
    const money = rows.length ? await tx.$queryRaw<{ booking_id: string; balance_kobo: bigint }[]>`SELECT booking_id, balance_kobo FROM booking_money WHERE booking_id = ANY(${rows.map((r) => r.id)})` : [];
    const bal = new Map(money.map((m) => [m.booking_id, Number(m.balance_kobo)]));
```
and set `balanceKobo: bal.get(b.id) ?? null`.

Isolation: `/v1/bookings/:id/...` already maps to the `booking` fixture.

- [ ] **Step 4:** `pnpm test:int` → PASS. **Step 5: Commit** `git commit -m "feat(payments): append-only ledger API, balances on bookings and calendar, auto-confirm [PAY-01..05 BKG-09]"`

---

### Task 4 (T-M3-04) [api]: Cancel with refund; receipt PDF

**Files:**
- Create: `apps/api/src/common/pdf/{pdf.ts,layout.ts,receipt.ts}`
- Modify: `apps/api/src/modules/bookings/bookings.service.ts` (`cancel`), `apps/api/src/modules/payments/payments.controller.ts` (receipt route), `apps/api/package.json` (`pdfkit`, `@types/pdfkit`)
- Test: `apps/api/test/cancel-refund.int.ts`, `apps/api/src/common/pdf/receipt.spec.ts`

**Interfaces:**
- `renderPdf(draw: (doc: PDFKit.PDFDocument) => void, opts?: { compress?: boolean }): Promise<Buffer>`; `brandHeader(doc, b: { orgName; address?; phone?; email?; logo?: Buffer | null })`; `renderReceipt(d: ReceiptData, opts?): Promise<Buffer>` with `ReceiptData = { org: { name; address; phone; email; logo: Buffer|null }; receiptNo; issuedOn; booking: { ref; unitName; propertyName; checkIn; checkOut; nights }; guestName; entryLabel; amountKobo; method; reference: string|null; balanceAfterKobo; depositHeldKobo }`.
- `GET /v1/payments/:paymentId/receipt.pdf` (`payments.read`) → `application/pdf`, `Content-Disposition: attachment; filename="<receiptNo>.pdf"`; 404 if entry has no receipt number. Balance shown is the balance **after** that entry (ledger computed over entries up to and including it).
- `POST /v1/bookings/:id/cancel` now: transition to `cancelled`, then if `refundKobo > 0` call `PaymentsService.recordIn(tx, ctx, id, { kind: 'refund', amountKobo, method, receivedOn: today, reference })` in the same transaction. Because `BookingsModule` cannot import `PaymentsModule` (cycle), move the cancel orchestration into `PaymentsService.cancelWithRefund(ctx, id, input)` and point the controller route there (`PaymentsController` gains `@Post('cancel')` under `bookings/:id`; delete the M2 cancel route from `BookingsController`).

- [ ] **Step 1: Failing tests**

`apps/api/src/common/pdf/receipt.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { renderReceipt } from './receipt';

describe('renderReceipt [PAY-06]', () => {
  it('produces a PDF containing the key facts', async () => {
    const buf = await renderReceipt({
      org: { name: 'Tanuhomes', address: 'Lekki Phase 1, Lagos', phone: '+2348107548559', email: 'hello@tanuhomes.com', logo: null },
      receiptNo: 'TAN-R-000042', issuedOn: '2026-10-10',
      booking: { ref: 'TAN-2610-0007', unitName: 'Kairo', propertyName: 'The Rock', checkIn: '2026-11-01', checkOut: '2026-11-04', nights: 3 },
      guestName: 'Adaeze Okafor', entryLabel: 'Payment', amountKobo: 30_000_000, method: 'Bank transfer', reference: 'GTB-123', balanceAfterKobo: 30_000_000, depositHeldKobo: 0,
    }, { compress: false });
    const text = buf.toString('latin1');
    expect(text.startsWith('%PDF')).toBe(true);
    for (const s of ['TAN-R-000042', 'TAN-2610-0007', 'Adaeze Okafor', 'Tanuhomes']) expect(text).toContain(s);
  });
});
```
(`₦` is not in the standard PDF fonts; the renderer registers `NotoSans` from `apps/api/assets/fonts/NotoSans-Regular.ttf` and `-Bold.ttf` — download both from Google Fonts (OFL) into that folder in this task; test text checks ASCII strings only.)

`apps/api/test/cancel-refund.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedGuest, seedProperty, seedUnit } from './helpers/inventory';

describe('cancel with refund [BKG-11] and receipts [PAY-06]', () => {
  let t: TestApp; let fd: Agent; let orgId: string; let bookingId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg('Tanuhomes')).id;
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'TAN','TAN','TAN',now())`, [orgId]);
    await m.end();
    const unitId = await seedUnit(orgId, await seedProperty(orgId), { rateKobo: 20_000_000 });
    fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    bookingId = (await fd.post('/v1/bookings').send({ unitId, guestId: await seedGuest(orgId), checkIn: '2026-11-01', checkOut: '2026-11-04', guestCount: 2, source: 'whatsapp' }).expect(201)).body.id;
    await fd.post(`/v1/bookings/${bookingId}/payments`).send({ kind: 'payment', amountKobo: 30_000_000, method: 'bank_transfer', receivedOn: '2026-10-10' }).expect(201);
  });

  it('cancels and records the refund atomically; retained shows the rest', async () => {
    await fd.post(`/v1/bookings/${bookingId}/cancel`).send({ reason: 'Flight cancelled', refundKobo: 20_000_000, refundMethod: 'bank_transfer' }).expect(200);
    const lg = (await fd.get(`/v1/bookings/${bookingId}/ledger`).expect(200)).body;
    expect(lg.totals).toMatchObject({ refundedKobo: 20_000_000, retainedKobo: 10_000_000, balanceKobo: 0 });
  });

  it('a refund over the paid amount rolls the cancel back', async () => {
    await fd.post(`/v1/bookings/${bookingId}/cancel`).send({ reason: 'x x x', refundKobo: 40_000_000, refundMethod: 'cash' }).expect(422);
    expect((await fd.get(`/v1/bookings/${bookingId}`).expect(200)).body.status).toBe('confirmed');
  });

  it('downloads a receipt PDF', async () => {
    const lg = (await fd.get(`/v1/bookings/${bookingId}/ledger`).expect(200)).body;
    const r = await fd.get(`/v1/payments/${lg.entries[0].id}/receipt.pdf`).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toContain('TAN-R-000001.pdf');
    expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });
});
```
- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Implement PDF**

`apps/api/src/common/pdf/pdf.ts`:
```ts
import PDFDocument from 'pdfkit';
import { resolve } from 'node:path';

const FONTS = resolve(__dirname, '../../../assets/fonts');
export function renderPdf(draw: (doc: PDFKit.PDFDocument) => void, opts: { compress?: boolean } = {}): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, compress: opts.compress ?? true, info: { Producer: 'Boogbe' } });
    doc.registerFont('body', `${FONTS}/NotoSans-Regular.ttf`);
    doc.registerFont('bold', `${FONTS}/NotoSans-Bold.ttf`);
    doc.font('body');
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => ok(Buffer.concat(chunks))); doc.on('error', fail);
    draw(doc); doc.end();
  });
}
```
(With `compress: false`, pdfkit still subsets/encodes TrueType text as glyph ids, so literal strings may not appear. To keep the text test meaningful, `renderPdf` also writes `info.Subject` with the key strings joined by ` · ` — `info: { Producer: 'Boogbe', Subject: opts.subject }` — and `renderReceipt` passes `subject: [receiptNo, booking.ref, guestName, org.name].join(' · ')`. The info dictionary is stored as plain text when `compress: false`.)

Update the signature: `renderPdf(draw, opts: { compress?: boolean; subject?: string } = {})` and `info: { Producer: 'Boogbe', ...(opts.subject && { Subject: opts.subject }) }`.

`apps/api/src/common/pdf/layout.ts`:
```ts
import { formatNaira } from '@boogbe/shared';
export interface Brand { name: string; address?: string | null; phone?: string | null; email?: string | null; logo?: Buffer | null }
export function brandHeader(doc: PDFKit.PDFDocument, b: Brand) {
  if (b.logo) { try { doc.image(b.logo, 48, 40, { fit: [64, 64] }); } catch { /* unsupported image: skip */ } }
  doc.font('bold').fontSize(16).text(b.name, b.logo ? 124 : 48, 44);
  doc.font('body').fontSize(9).fillColor('#5b6d72').text([b.address, b.phone, b.email].filter(Boolean).join('  ·  '), b.logo ? 124 : 48, 66);
  doc.fillColor('#182d32').moveDown(3);
}
export function row(doc: PDFKit.PDFDocument, label: string, value: string, opts: { bold?: boolean } = {}) {
  const y = doc.y;
  doc.font(opts.bold ? 'bold' : 'body').fontSize(11).text(label, 48, y, { width: 300 });
  doc.text(value, 348, y, { width: 199, align: 'right' });
  doc.moveDown(0.4);
}
export const naira = formatNaira;
export function footer(doc: PDFKit.PDFDocument, text: string) {
  doc.font('body').fontSize(8).fillColor('#5b6d72').text(text, 48, 780, { width: 499, align: 'center' });
}
```
`apps/api/src/common/pdf/receipt.ts`:
```ts
import { renderPdf } from './pdf';
import { brandHeader, footer, naira, row, type Brand } from './layout';

export interface ReceiptData {
  org: Brand & { logo: Buffer | null }; receiptNo: string; issuedOn: string;
  booking: { ref: string; unitName: string; propertyName: string; checkIn: string; checkOut: string; nights: number };
  guestName: string; entryLabel: string; amountKobo: number; method: string; reference: string | null; balanceAfterKobo: number; depositHeldKobo: number;
}
const d = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function renderReceipt(r: ReceiptData, opts: { compress?: boolean } = {}) {
  return renderPdf((doc) => {
    brandHeader(doc, r.org);
    doc.font('bold').fontSize(20).text('Receipt', 48);
    doc.font('body').fontSize(10).text(`${r.receiptNo}  ·  ${d(r.issuedOn)}`).moveDown();
    row(doc, 'Guest', r.guestName);
    row(doc, 'Booking', r.booking.ref);
    row(doc, 'Stay', `${r.booking.unitName}, ${r.booking.propertyName}`);
    row(doc, 'Dates', `${d(r.booking.checkIn)} – ${d(r.booking.checkOut)} (${r.booking.nights} night${r.booking.nights === 1 ? '' : 's'})`);
    doc.moveDown();
    row(doc, r.entryLabel, naira(r.amountKobo), { bold: true });
    row(doc, 'Paid by', r.method + (r.reference ? ` · ${r.reference}` : ''));
    doc.moveDown();
    row(doc, r.balanceAfterKobo < 0 ? 'Overpaid' : 'Balance remaining', naira(Math.abs(r.balanceAfterKobo)), { bold: true });
    if (r.depositHeldKobo > 0) row(doc, 'Refundable caution deposit held', naira(r.depositHeldKobo));
    footer(doc, `Thank you for staying with ${r.org.name}. Generated by Boogbe.`);
  }, { ...opts, subject: [r.receiptNo, r.booking.ref, r.guestName, r.org.name].join(' · ') });
}
```
Receipt route in a new `ReceiptsController` (`@Controller('payments')`, `@Get(':id/receipt.pdf') @Permission('payments.read')`) calling `PaymentsService.receipt(ctx, paymentId)`:
```ts
  async receipt(ctx: OrgCtx, paymentId: string): Promise<{ filename: string; pdf: Buffer }> {
    const data = await this.orgDb.run(ctx.orgId, async (tx) => {
      const p = await tx.payment.findFirst({ where: { id: paymentId } });
      if (!p || !p.receiptNo) throw notFound('Receipt');
      const booking = await this.bookings.getIn(tx, ctx.orgId, p.bookingId);
      const rows = await tx.payment.findMany({ where: { bookingId: p.bookingId, createdAt: { lte: p.createdAt } }, orderBy: { createdAt: 'asc' } });
      const t = ledger(rows.map((r) => ({ id: r.id, kind: r.kind as LedgerEntry['kind'], amountKobo: kobo(r.amountKobo), voidsPaymentId: r.voidsPaymentId })), { finalTotalKobo: booking.finalTotalKobo, status: booking.status });
      const s = await tx.orgSettings.findFirstOrThrow();
      return { p, booking, t, logoKey: s.logoKey };
    });
    const org = await this.orgInfo.get(ctx.orgId); // { name, address, phone, email }
    const logo = data.logoKey ? await this.storageBuffer(data.logoKey) : null;
    const pdf = await renderReceipt({
      org: { ...org, logo }, receiptNo: data.p.receiptNo!, issuedOn: data.p.receivedOn.toISOString().slice(0, 10),
      booking: { ref: data.booking.ref, unitName: data.booking.unit.name, propertyName: data.booking.unit.propertyName, checkIn: data.booking.checkIn, checkOut: data.booking.checkOut, nights: data.booking.nights },
      guestName: data.booking.guest.fullName, entryLabel: ENTRY_LABELS[data.p.kind as keyof typeof ENTRY_LABELS], amountKobo: kobo(data.p.amountKobo),
      method: METHOD_LABELS[data.p.method as keyof typeof METHOD_LABELS], reference: data.p.reference, balanceAfterKobo: data.t.balanceKobo, depositHeldKobo: data.t.depositHeldKobo,
    });
    return { filename: `${data.p.receiptNo}.pdf`, pdf };
  }
```
Supporting pieces:
- `OrgInfo` (in `common/db/org-info.ts`, uses `PrismaService` on the global `organization` table): `get(orgId) → { name, address, phone: whatsappPhone ?? contactPhone, email: contactEmail }`. Add to `DbModule`.
- `Storage.get(key): Promise<Buffer | null>` — add to the `Storage` interface (`R2Storage`: `GetObjectCommand` + `transformToByteArray`; `MemoryStorage`: map lookup). `PaymentsService.storageBuffer = (k) => this.storage.get(k)` via `@Inject(STORAGE)`.
- Controller:
```ts
@Controller('payments')
export class ReceiptsController {
  constructor(private readonly svc: PaymentsService) {}
  @Get(':id/receipt.pdf') @Permission('payments.read')
  async receipt(@Ctx() c: RequestCtx, @Param('id') id: string, @Res() res: Response) {
    const { filename, pdf } = await this.svc.receipt(requireOrg(c), id);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  }
}
```
Isolation fixture: `ISOLATION_FIXTURES.payment` inserting a payment with a receipt number on a seeded booking; `ROUTE_FIXTURE.push({ match: /^\/v1\/payments\//, fixture: 'payment' })`.

Cancel orchestration in `PaymentsService`:
```ts
  cancelWithRefund(ctx: OrgCtx, bookingId: string, input: CancelBookingInput) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      await this.bookings.transitionIn(tx, ctx, ctx.orgId, bookingId, 'cancelled', input.reason);
      if (input.refundKobo && input.refundKobo > 0) {
        await this.recordIn(tx, ctx, bookingId, { kind: 'refund', amountKobo: input.refundKobo, method: input.refundMethod!, receivedOn: todayIn(ctx.timezone), reference: input.refundReference ?? null, note: input.reason });
      }
      return this.bookings.getIn(tx, ctx.orgId, bookingId);
    });
  }
```
Move the route: `PaymentsController` (`bookings/:id`) adds `@Post('cancel') @HttpCode(200) @Permission('bookings.write') cancel(...) { return this.svc.cancelWithRefund(requireOrg(c), id, b); }` and remove `cancel` from `BookingsController` + `BookingsService.cancel`.

- [ ] **Step 4:** `pnpm --filter @boogbe/api test && pnpm test:int` → PASS. **Step 5: Commit** `git commit -m "feat(payments): refund on cancel and branded receipt PDFs [BKG-11 PAY-06 ORG-03]"`

---

### Task 5 (T-M3-05) [api]: Money summary

**Files:** Create `apps/api/src/modules/payments/money.controller.ts`, `money.service.ts`; Test `apps/api/test/money.int.ts`.

**Interfaces:** `GET /v1/money/summary?from&to&propertyId` (`payments.read`) → `MoneySummary`:
- `receivedByMethod` / `totalReceivedKobo`: effective `payment` entries with `received_on` in `[from, to)` (deposits excluded), grouped by method, filtered by property via booking → unit.
- `refundsKobo`: effective refunds in range.
- `depositsHeldKobo`: Σ `deposit_held_kobo` across all bookings (not range-bound).
- `outstanding`: bookings with `balance_kobo > 0` and status in (`tentative`,`confirmed`,`checked_in`,`checked_out`), ordered by `check_in`, max 100, as `BookingSummary`.
- `depositsToReturn`: status `checked_out` and `deposit_held_kobo > 0`, ordered by `check_out`.

- [ ] **Step 1: Failing test** `apps/api/test/money.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';

describe('money summary [PAY-07]', () => {
  let t: TestApp; let admin: Agent; let orgId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await truncateAll(); orgId = (await seedOrg()).id; admin = (await signInAs(t, 'admin', orgId)).agent; });

  it('groups receipts by method and lists outstanding and deposits to return', async () => {
    const u = await seedUnit(orgId, await seedProperty(orgId)); const g = await seedGuest(orgId, { fullName: 'Ada' });
    const b1 = await seedBooking(orgId, u, g, { checkIn: '2026-10-01', checkOut: '2026-10-03', status: 'checked_out', totalKobo: 40_000_000 });
    const b2 = await seedBooking(orgId, u, g, { checkIn: '2026-10-10', checkOut: '2026-10-12', status: 'confirmed', totalKobo: 40_000_000 });
    const m = await migratorClient();
    const ins = (b: string, kind: string, amt: number, method: string, on: string) => m.query(`insert into payment(id, org_id, booking_id, kind, amount_kobo, method, received_on) values ($1,$2,$3,$4,$5,$6,$7)`, [newId(), orgId, b, kind, amt, method, on]);
    await ins(b1, 'payment', 40_000_000, 'bank_transfer', '2026-10-01');
    await ins(b1, 'deposit_received', 10_000_000, 'cash', '2026-10-01');
    await ins(b2, 'payment', 15_000_000, 'pos', '2026-10-05');
    await ins(b2, 'payment', 5_000_000, 'pos', '2026-11-05'); // outside range
    await m.end();
    const r = (await admin.get('/v1/money/summary?from=2026-10-01&to=2026-11-01').expect(200)).body;
    expect(r.receivedByMethod).toEqual(expect.arrayContaining([{ method: 'bank_transfer', kobo: 40_000_000 }, { method: 'pos', kobo: 15_000_000 }]));
    expect(r.totalReceivedKobo).toBe(55_000_000);
    expect(r.depositsHeldKobo).toBe(10_000_000);
    expect(r.outstanding.map((o: { id: string; balanceKobo: number }) => [o.id, o.balanceKobo])).toEqual([[b2, 20_000_000]]);
    expect(r.depositsToReturn).toEqual([expect.objectContaining({ bookingId: b1, heldKobo: 10_000_000, guestName: 'Ada' })]);
  });

  it('frontdesk can read; housekeeper cannot', async () => {
    await (await signInAs(t, 'frontdesk', orgId)).agent.get('/v1/money/summary?from=2026-10-01&to=2026-11-01').expect(200);
    await (await signInAs(t, 'housekeeper', orgId)).agent.get('/v1/money/summary?from=2026-10-01&to=2026-11-01').expect(403);
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `money.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MoneySummary, PaymentMethod } from '@boogbe/shared';
import { OrgDb } from '../../common/db/org-db.service';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { BookingsService } from '../bookings/bookings.service';
import { toSummary } from '../bookings/booking.mapper';

@Injectable()
export class MoneyService {
  constructor(private readonly orgDb: OrgDb, private readonly bookings: BookingsService) {}

  summary(ctx: OrgCtx, q: { from: string; to: string; propertyId?: string }): Promise<MoneySummary> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const prop = q.propertyId ? Prisma.sql`AND u.property_id = ${q.propertyId}` : Prisma.empty;
      const byMethod = await tx.$queryRaw<{ method: PaymentMethod; kobo: bigint }[]>`
        SELECT e.method, sum(e.amount_kobo)::bigint AS kobo FROM payment_effective e JOIN booking b ON b.id = e.booking_id JOIN unit u ON u.id = b.unit_id
        WHERE e.kind = 'payment' AND e.received_on >= ${q.from}::date AND e.received_on < ${q.to}::date ${prop} GROUP BY e.method ORDER BY 2 DESC`;
      const [ref] = await tx.$queryRaw<{ kobo: bigint | null }[]>`
        SELECT sum(e.amount_kobo)::bigint AS kobo FROM payment_effective e JOIN booking b ON b.id = e.booking_id JOIN unit u ON u.id = b.unit_id
        WHERE e.kind = 'refund' AND e.received_on >= ${q.from}::date AND e.received_on < ${q.to}::date ${prop}`;
      const money = await tx.$queryRaw<{ booking_id: string; balance_kobo: bigint; deposit_held_kobo: bigint; status: string }[]>`
        SELECT m.booking_id, m.balance_kobo, m.deposit_held_kobo, m.status FROM booking_money m JOIN booking b ON b.id = m.booking_id JOIN unit u ON u.id = b.unit_id
        WHERE (m.balance_kobo > 0 AND m.status IN ('tentative','confirmed','checked_in','checked_out')) OR m.deposit_held_kobo > 0 ${prop}`;
      const ids = money.map((m) => m.booking_id);
      const rows = ids.length ? await tx.booking.findMany({ where: { id: { in: ids } }, include: (await import('../bookings/booking.mapper')).BOOKING_INCLUDE, orderBy: { checkIn: 'asc' } }) : [];
      const full = await this.bookings.hydrate(tx, ctx.orgId, rows);
      return {
        receivedByMethod: byMethod.map((r) => ({ method: r.method, kobo: Number(r.kobo) })),
        totalReceivedKobo: byMethod.reduce((s, r) => s + Number(r.kobo), 0),
        refundsKobo: Number(ref?.kobo ?? 0n),
        depositsHeldKobo: money.reduce((s, m) => s + Math.max(0, Number(m.deposit_held_kobo)), 0),
        outstanding: full.filter((b) => (b.balanceKobo ?? 0) > 0 && b.status !== 'cancelled').slice(0, 100).map(toSummary),
        depositsToReturn: full.filter((b) => b.status === 'checked_out' && (b.depositHeldKobo ?? 0) > 0)
          .sort((a, b) => a.checkOut.localeCompare(b.checkOut))
          .map((b) => ({ bookingId: b.id, ref: b.ref, guestName: b.guest.fullName, unitName: b.unit.name, checkOut: b.checkOut, heldKobo: b.depositHeldKobo! })),
      };
    });
  }
}
```
(Replace the dynamic `import(...)` with a static `import { BOOKING_INCLUDE, toSummary } from '../bookings/booking.mapper'` at the top.)
Controller `@Controller('money') @Get('summary') @Permission('payments.read')` with `class Q extends createZodDto(MoneyQuery)`; add `MoneyService` + controller to `PaymentsModule`.

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(money): receipts by method, outstanding balances, deposits to return [PAY-07]"`

---

### Task 6 (T-M3-06) [ui]: Payments panel and refund-on-cancel

**Files:**
- Create: `apps/app/src/features/payments/{PaymentsPanel.tsx,RecordEntryForm.tsx,VoidDialog.tsx,hooks.ts,register.ts}`
- Modify: `apps/app/src/features/bookings/StatusActions.tsx` (cancel dialog gains refund fields), `apps/app/src/main.tsx` (import `features/payments/register`)
- Test: `apps/app/src/features/payments/PaymentsPanel.test.tsx`

**Interfaces:**
- `register.ts` pushes `PaymentsPanel` into `BOOKING_PANELS` (side-effect import in `main.tsx`).
- `<PaymentsPanel booking refresh />`: totals strip (Total · Paid · Balance/Overpaid/Retained · Deposit held), entries table (date, type, method, amount with sign, reference, receipt link `/v1/payments/:id/receipt.pdf` opened via `window.open` with credentials — use a plain `<a href download>` since the cookie is same-site), voided rows struck through; buttons "Record payment", "Deposit", "Refund"; admin sees "Void" per row.
- `<RecordEntryForm bookingId kind defaultAmountKobo onSaved />` — kind select limited to the button that opened it (payment | deposit_received/deposit_returned/deposit_withheld | refund), `MoneyInput`, method select (`METHOD_LABELS`), date (default today in operator tz), reference, note (required for kept deposit); client-side `validateEntry` against current ledger for instant feedback.

- [ ] **Step 1: Failing test** `apps/app/src/features/payments/PaymentsPanel.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsPanel } from './PaymentsPanel';

const ledger = { entries: [
  { id: 'p1', kind: 'payment', amountKobo: 70_000_000, method: 'bank_transfer', receivedOn: '2026-10-10', reference: 'GTB-1', note: null, receiptNo: 'TAN-R-000001', voided: false, voidsPaymentId: null, recordedByName: 'Ada', createdAt: '2026-10-10T10:00:00Z' },
  { id: 'p2', kind: 'payment', amountKobo: 5_000_000, method: 'cash', receivedOn: '2026-10-10', reference: null, note: null, receiptNo: 'TAN-R-000002', voided: true, voidsPaymentId: null, recordedByName: 'Ada', createdAt: '2026-10-10T11:00:00Z' },
], totals: { paidKobo: 70_000_000, refundedKobo: 0, netPaidKobo: 70_000_000, depositReceivedKobo: 0, depositReturnedKobo: 0, depositWithheldKobo: 0, depositHeldKobo: 0, balanceKobo: -10_000_000, retainedKobo: 70_000_000 } };
vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: vi.fn(async () => ledger) }));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }) }));

describe('PaymentsPanel', () => {
  it('shows overpaid, receipt links and struck-through voids', async () => {
    const booking = { id: 'b1', status: 'confirmed', finalTotalKobo: 60_000_000 } as never;
    render(<SWRConfig value={{ provider: () => new Map() }}><PaymentsPanel booking={booking} refresh={vi.fn()} /></SWRConfig>);
    expect(await screen.findByText('Overpaid')).toBeInTheDocument();
    expect(screen.getByText('₦100,000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'TAN-R-000001' })).toHaveAttribute('href', '/v1/payments/p1/receipt.pdf');
    expect(screen.getByText('₦50,000').closest('tr')).toHaveClass('line-through');
    expect(screen.getAllByRole('button', { name: 'Void' })).toHaveLength(1);
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement**

`apps/app/src/features/payments/hooks.ts`:
```ts
import { BookingLedger } from '@boogbe/shared';
import { useApi } from '../../lib/api';
export const useLedger = (bookingId: string) => useApi(`/v1/bookings/${bookingId}/ledger`, BookingLedger);
```
`apps/app/src/features/payments/RecordEntryForm.tsx`:
```tsx
import { useState } from 'react';
import { ENTRY_LABELS, METHOD_LABELS, PaymentMethod, todayIn, validateEntry, type BookingLedger, type RecordEntryInput } from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/use-me';
import { MoneyInput } from '../inventory/money-input';

type Kind = RecordEntryInput['kind'];
export function RecordEntryForm({ bookingId, kinds, defaultAmountKobo, ledger, onSaved }: { bookingId: string; kinds: Kind[]; defaultAmountKobo: number; ledger: BookingLedger; onSaved: () => void }) {
  const { me } = useMe();
  const [v, setV] = useState({ kind: kinds[0]!, amountKobo: defaultAmountKobo, method: 'bank_transfer' as PaymentMethod, receivedOn: todayIn(me?.activeOrg?.timezone ?? 'Africa/Lagos'), reference: '', note: '' });
  const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  const local = validateEntry(ledger.entries.map((e) => ({ id: e.id, kind: e.kind, amountKobo: e.amountKobo, voidsPaymentId: e.voidsPaymentId })), { kind: v.kind, amountKobo: v.amountKobo });
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault(); setErr(undefined);
      if (local) return setErr(local);
      if (v.kind === 'deposit_withheld' && v.note.trim().length < 3) return setErr('Say why the deposit is kept');
      setBusy(true);
      try { await api(`/v1/bookings/${bookingId}/payments`, { method: 'POST', body: { ...v, reference: v.reference || null, note: v.note || null } }); onSaved(); }
      catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); } finally { setBusy(false); }
    }}>
      {kinds.length > 1 && <Field label="Type"><Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as Kind })}>{kinds.map((k) => <option key={k} value={k}>{ENTRY_LABELS[k]}</option>)}</Select></Field>}
      <Field label="Amount" error={local ?? undefined}><MoneyInput value={v.amountKobo} onChange={(k) => setV({ ...v, amountKobo: k })} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Method"><Select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value as PaymentMethod })}>{PaymentMethod.options.filter((m) => m !== 'paystack').map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}</Select></Field>
        <Field label="Date"><Input type="date" value={v.receivedOn} onChange={(e) => setV({ ...v, receivedOn: e.target.value })} /></Field>
      </div>
      <Field label="Reference" hint="Transfer reference or POS slip number"><Input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
      <Field label={v.kind === 'deposit_withheld' ? 'Reason (required)' : 'Note'}><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button type="submit" loading={busy}>Save</Button>
    </form>
  );
}
```
`apps/app/src/features/payments/VoidDialog.tsx`:
```tsx
import { useState } from 'react';
import { formatNaira, type PaymentEntry } from '@boogbe/shared';
import { Button, Field, Input } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';

export function VoidForm({ bookingId, entry, onSaved }: { bookingId: string; entry: PaymentEntry; onSaved: () => void }) {
  const [reason, setReason] = useState(''); const [err, setErr] = useState<string>();
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => { e.preventDefault(); try { await api(`/v1/bookings/${bookingId}/payments/void`, { method: 'POST', body: { paymentId: entry.id, reason } }); onSaved(); } catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); } }}>
      <p className="text-sm">Void {formatNaira(entry.amountKobo)} recorded on {entry.receivedOn}? It stays in the history, struck through.</p>
      <Field label="Reason"><Input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button type="submit" variant="danger">Void entry</Button>
    </form>
  );
}
```
`apps/app/src/features/payments/PaymentsPanel.tsx`:
```tsx
import { useState } from 'react';
import { can, ENTRY_LABELS, formatNaira, METHOD_LABELS, type Booking, type PaymentEntry, type RecordEntryInput } from '@boogbe/shared';
import { Button, Card, Dialog, Spinner } from '@boogbe/ui';
import { useMe } from '../../lib/use-me';
import { useLedger } from './hooks';
import { RecordEntryForm } from './RecordEntryForm';
import { VoidForm } from './VoidDialog';

const SIGN: Record<string, 1 | -1 | 0> = { payment: 1, deposit_received: 1, refund: -1, deposit_returned: -1, deposit_withheld: 0, void: 0 };

export function PaymentsPanel({ booking, refresh }: { booking: Pick<Booking, 'id' | 'status' | 'finalTotalKobo'>; refresh: () => void }) {
  const { me } = useMe(); const role = me?.activeOrg?.role;
  const { data, mutate } = useLedger(booking.id);
  const [dlg, setDlg] = useState<null | { kinds: RecordEntryInput['kind'][]; amount: number; title: string } | { void: PaymentEntry }>(null);
  if (!data) return <Card><Spinner /></Card>;
  const t = data.totals; const done = async () => { setDlg(null); await mutate(); refresh(); };
  const balanceLabel = booking.status === 'cancelled' ? 'Retained' : t.balanceKobo < 0 ? 'Overpaid' : 'Balance';
  const balanceValue = booking.status === 'cancelled' ? t.retainedKobo : Math.abs(t.balanceKobo);
  const canWrite = !!role && can(role, 'payments.write'); const canVoid = !!role && can(role, 'payments.void');
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-semibold">Payments</h2>
      <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        <div><dt className="text-ink-muted">Total</dt><dd className="font-medium">{formatNaira(booking.finalTotalKobo)}</dd></div>
        <div><dt className="text-ink-muted">Paid</dt><dd className="font-medium">{formatNaira(t.netPaidKobo)}</dd></div>
        <div><dt className="text-ink-muted">{balanceLabel}</dt><dd className={`font-medium ${balanceLabel === 'Balance' && t.balanceKobo > 0 ? 'text-danger' : ''}`}>{formatNaira(balanceValue)}</dd></div>
        <div><dt className="text-ink-muted">Deposit held</dt><dd className="font-medium">{formatNaira(t.depositHeldKobo)}</dd></div>
      </dl>
      {data.entries.length > 0 && (
        <div className="overflow-x-auto"><table className="w-full text-sm"><tbody>
          {data.entries.filter((e) => e.kind !== 'void').map((e) => (
            <tr key={e.id} className={`border-t border-line ${e.voided ? 'line-through text-ink-muted' : ''}`}>
              <td className="py-1 pr-2">{e.receivedOn}</td><td className="pr-2">{ENTRY_LABELS[e.kind]}</td><td className="pr-2">{METHOD_LABELS[e.method]}</td>
              <td className="pr-2 text-right">{SIGN[e.kind] === -1 ? '−' : ''}{formatNaira(e.amountKobo)}</td>
              <td className="pr-2">{e.reference ?? e.note ?? ''}</td>
              <td className="pr-2">{e.receiptNo && !e.voided && <a href={`/v1/payments/${e.id}/receipt.pdf`} className="text-brand" download>{e.receiptNo}</a>}</td>
              <td>{canVoid && !e.voided && <Button variant="ghost" onClick={() => setDlg({ void: e })}>Void</Button>}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          {booking.status !== 'cancelled' && <Button onClick={() => setDlg({ kinds: ['payment'], amount: Math.max(0, t.balanceKobo), title: 'Record payment' })}>Record payment</Button>}
          <Button variant="secondary" onClick={() => setDlg({ kinds: ['deposit_received', 'deposit_returned', 'deposit_withheld'], amount: 0, title: 'Caution deposit' })}>Deposit</Button>
          {t.netPaidKobo > 0 && <Button variant="secondary" onClick={() => setDlg({ kinds: ['refund'], amount: 0, title: 'Refund' })}>Refund</Button>}
        </div>
      )}
      <Dialog open={!!dlg && 'kinds' in dlg} onClose={() => setDlg(null)} title={dlg && 'kinds' in dlg ? dlg.title : ''}>
        {dlg && 'kinds' in dlg && <RecordEntryForm bookingId={booking.id} kinds={dlg.kinds} defaultAmountKobo={dlg.amount} ledger={data} onSaved={done} />}
      </Dialog>
      <Dialog open={!!dlg && 'void' in dlg} onClose={() => setDlg(null)} title="Void entry">{dlg && 'void' in dlg && <VoidForm bookingId={booking.id} entry={dlg.void} onSaved={done} />}</Dialog>
    </Card>
  );
}
```
In dev the receipt link `/v1/...` is proxied by Vite; in production the app is on `app.boogbe.com` and the API on `api.boogbe.com`, so build the href with `${import.meta.env.VITE_API_ORIGIN ?? ''}/v1/payments/${e.id}/receipt.pdf` (the session cookie is on `.boogbe.com`). Update the test expectation accordingly (`VITE_API_ORIGIN` is undefined in tests → `/v1/...`).

`apps/app/src/features/payments/register.ts`:
```ts
import { BOOKING_PANELS } from '../bookings/BookingDetail';
import { PaymentsPanel } from './PaymentsPanel';
BOOKING_PANELS.push(PaymentsPanel);
```
`main.tsx`: `import './features/payments/register';` before rendering.

`StatusActions.tsx` cancel dialog: fetch `useLedger(booking.id)`; if `netPaidKobo > 0` show "Refund to guest" `MoneyInput` (default 0, max `netPaidKobo`), method select and reference; POST body `{ reason, ...(refund > 0 && { refundKobo: refund, refundMethod, refundReference }) }`; text below: "Kept by you: {formatNaira(netPaid - refund)}". If `depositHeldKobo > 0`, add a note "Caution deposit of ₦X is still held — return it from the Payments panel."

- [ ] **Step 4:** PASS + build. **Step 5: Commit** `git commit -m "feat(app): payments panel with receipts and voids; refund on cancel [PAY-01..06 BKG-11]"`

---

### Task 7 (T-M3-07) [ui][e2e]: Money dashboard and E2E-04

**Files:** Create `apps/app/src/features/payments/MoneyPage.tsx`; modify router (`/money`, nav "Money" `payments.read`, icon `Wallet`); Create `e2e/e04-payment-receipt.spec.ts`; Test `apps/app/src/features/payments/MoneyPage.test.tsx`.

- [ ] **Step 1: Failing test** `MoneyPage.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { MoneyPage } from './MoneyPage';

vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: vi.fn(async () => ({
  receivedByMethod: [{ method: 'bank_transfer', kobo: 40_000_000 }, { method: 'pos', kobo: 15_000_000 }], totalReceivedKobo: 55_000_000, refundsKobo: 0, depositsHeldKobo: 10_000_000,
  outstanding: [{ id: 'b2', ref: 'TAN-2610-0002', unitName: 'Kairo', propertyName: 'Rock', guestName: 'Ada', checkIn: '2026-10-10', checkOut: '2026-10-12', nights: 2, status: 'confirmed', source: 'phone', finalTotalKobo: 40_000_000, balanceKobo: 20_000_000 }],
  depositsToReturn: [{ bookingId: 'b1', ref: 'TAN-2610-0001', guestName: 'Ada', unitName: 'Kairo', checkOut: '2026-10-03', heldKobo: 10_000_000 }],
})) }));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }) }));

describe('MoneyPage', () => {
  it('shows totals, outstanding and deposits to return', async () => {
    render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter><MoneyPage /></MemoryRouter></SWRConfig>);
    expect(await screen.findByText('₦550,000')).toBeInTheDocument();
    expect(screen.getByText('Bank transfer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'TAN-2610-0002' })).toHaveAttribute('href', '/bookings/b2');
    expect(screen.getByRole('link', { name: 'TAN-2610-0001' })).toHaveAttribute('href', '/bookings/b1');
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `MoneyPage.tsx`:
```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, formatNaira, METHOD_LABELS, MoneySummary, monthOf, todayIn } from '@boogbe/shared';
import { Card, EmptyState, Input, Spinner } from '@boogbe/ui';
import { useApi } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useMe } from '../../lib/use-me';

export function MoneyPage() {
  const { me } = useMe(); const today = todayIn(me?.activeOrg?.timezone ?? 'Africa/Lagos');
  const [from, setFrom] = useState(monthOf(today)); const [to, setTo] = useState(addDays(today, 1));
  const { data } = useApi(`/v1/money/summary?from=${from}&to=${to}`, MoneySummary);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Money</h1>
        <Input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <Input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
      {!data ? <Spinner /> : <>
        <div className="grid gap-3 md:grid-cols-3">
          <Card><p className="text-sm text-ink-muted">Received</p><p className="text-2xl font-semibold">{formatNaira(data.totalReceivedKobo)}</p>
            <ul className="mt-2 text-sm">{data.receivedByMethod.map((m) => <li key={m.method} className="flex justify-between"><span>{METHOD_LABELS[m.method]}</span><span>{formatNaira(m.kobo)}</span></li>)}</ul></Card>
          <Card><p className="text-sm text-ink-muted">Refunded</p><p className="text-2xl font-semibold">{formatNaira(data.refundsKobo)}</p></Card>
          <Card><p className="text-sm text-ink-muted">Caution deposits held</p><p className="text-2xl font-semibold">{formatNaira(data.depositsHeldKobo)}</p></Card>
        </div>
        <Card><h2 className="mb-2 font-semibold">Guests who still owe</h2>
          {data.outstanding.length === 0 ? <EmptyState title="Nobody owes anything" /> : data.outstanding.map((b) => (
            <div key={b.id} className="flex justify-between border-t border-line py-2 text-sm"><span><Link to={`/bookings/${b.id}`} className="text-brand">{b.ref}</Link> · {b.guestName} · {b.unitName} · {formatDate(b.checkIn)}</span><span className="font-medium text-danger">{formatNaira(b.balanceKobo ?? 0)}</span></div>
          ))}</Card>
        <Card><h2 className="mb-2 font-semibold">Deposits to return</h2>
          {data.depositsToReturn.length === 0 ? <EmptyState title="No deposits waiting" /> : data.depositsToReturn.map((d) => (
            <div key={d.bookingId} className="flex justify-between border-t border-line py-2 text-sm"><span><Link to={`/bookings/${d.bookingId}`} className="text-brand">{d.ref}</Link> · {d.guestName} · left {formatDate(d.checkOut)}</span><span className="font-medium">{formatNaira(d.heldKobo)}</span></div>
          ))}</Card>
      </>}
    </div>
  );
}
```
`e2e/e04-payment-receipt.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { resetDb } from './fixtures';
import { createUnit, onboardOperator } from './helpers';

test.beforeAll(() => resetDb());

test('E2E-04 part-payment updates balance and the receipt downloads', async ({ page, browser }) => {
  const admin = await onboardOperator(page, browser, 'tanu-pay');
  await createUnit(admin, { property: 'The Rock', unit: 'Kairo', rateNaira: '200000' });
  const unitId = (await (await admin.request.get('/v1/units')).json()).items[0].id;
  const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  await admin.goto(`/bookings/new?unitId=${unitId}&checkIn=${d(2)}&checkOut=${d(5)}`);
  await admin.getByRole('button', { name: 'New guest' }).click();
  await admin.getByLabel('Full name').fill('Adaeze Okafor');
  await admin.getByLabel(/^Phone/).fill('08031234567');
  await admin.getByRole('button', { name: 'Add guest' }).click();
  await admin.getByRole('button', { name: 'Save booking' }).click();
  await admin.getByRole('button', { name: 'Record payment' }).click();
  await admin.getByLabel('Amount').fill('250000');
  await admin.getByLabel('Reference').fill('GTB-998');
  await admin.getByRole('button', { name: 'Save' }).click();
  await expect(admin.getByText('Confirmed')).toBeVisible();          // auto-confirm
  await expect(admin.locator('dd', { hasText: '₦350,000' })).toBeVisible(); // balance 600k − 250k
  const [download] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('link', { name: /-R-000001/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/-R-000001\.pdf$/);
});
```
- [ ] **Step 4:** unit + `pnpm test:e2e --project=desktop` → PASS. **Step 5: Commit** `git commit -m "feat(app): money dashboard; E2E-04 [PAY-07]"`

---

## Self-review notes (completed)
- Coverage: PAY-01 (T3, T6), PAY-02 (T1, T3), PAY-03 (T1, T3, T4), PAY-04 (T2 grants, T3 void), PAY-05 (T1, T2 view, T3 decorate + consistency test), PAY-06 (T4, T6), PAY-07 (T5, T7), BKG-09 (T3), BKG-11 refund (T4, T6), ORG-03 receipts (T3).
- Interfaces for later: `PaymentHooks.register({ afterRecord })` (M5 receipt email), `PaymentsService.entriesFor/ledgerIn/recordIn`, `renderPdf/brandHeader/row/footer` (M7 statements), `OrgInfo.get`, `Storage.get`.
- The cancel route moved from `BookingsController` to `PaymentsController` (`POST /v1/bookings/:id/cancel`); URL unchanged, so the M2 UI keeps working.
