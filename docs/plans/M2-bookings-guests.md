# M2 — Guests & Bookings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Claim each task in `docs/COORDINATION.md` before starting.

**Goal:** Front desk records bookings from the calendar with clash protection (database exclusion constraint + unit lock), computed pricing with an audited override, booking statuses with tentative-hold expiry, guest records with duplicate hints, in-app notifications, and an admin audit viewer. Exit: E2E-02 and E2E-03 pass; 20-way race test green.

**Architecture:** Pure pricing and status logic in `packages/shared/src/domain` (used by API and UI). `BookingsService` writes inside `OrgDb.run`, calls `BlocksService.assertUnitFree` (unit row lock + manual-block check), and relies on the `booking_no_overlap` exclusion constraint for booking-vs-booking races. `BookingSource` registers with `CalendarSources`. A minimal `notifications` module lands here because hold expiry needs it (M4/M7 reuse it).

**Tech Stack:** as M1, plus `libphonenumber-js` in `@boogbe/shared`.

**Spec:** `docs/superpowers/specs/2026-10-09-boogbe-v1-design.md` · FRD: GST-01..04, BKG-01..08, BKG-10..13, NTF-01 (in-app part), AUD-02. BKG-09 (auto-confirm on payment) and the refund half of BKG-11 land in M3.

**Depends on:** M1 complete.

## Global Constraints

- Booking stays are `[checkIn, checkOut)`; nights ≥ 1; same-day turnover allowed.
- Active statuses (hold the dates): `tentative`, `confirmed`, `checked_in`.
- `booking_line` rows are a snapshot; rate/fee edits never change existing bookings.
- Deposit lines are `kind = 'deposit'`, `refundable = true`, **excluded** from `final_total_kobo`.
- Booking ref format: `<bookingPrefix>-<YYMM>-<seq 4+ digits>` (e.g. `TAN-2610-0042`), YYMM from the creation date in the operator timezone, seq from `org_counter('booking')`.
- New error codes are **appended** to `ERROR_CODES`: `ICAL_OVERLAP`, `CAPACITY_EXCEEDED`.
- Every write is audited via `AuditService.record` in the same transaction.
- Phones stored E.164; default country NG.

## Review Focus

1. **Two people booking the same dates at the same moment** — exactly one succeeds, the rest get 409 `DATES_UNAVAILABLE` (T-M2-04 race test, 20 concurrent requests).
2. **Moving a booking onto its own dates or extending it** must not conflict with itself (T-M2-05 test `extending a stay ignores itself`).
3. **Cancelled bookings free the dates immediately** (T-M2-05 test `cancel frees dates`).
4. **Total override to ₦0 or below** — ₦0 allowed with reason (free stay), negative refused (T-M2-04 test `override cannot go negative`).
5. **A tentative booking that is confirmed just before the hold job runs** must not be cancelled by the job (T-M2-05 test `hold job skips bookings confirmed meanwhile`).

## Parallel split

| Task | Track | Suggested agent | Depends on |
|---|---|---|---|
| T-M2-01 Pricing/status domain + contracts | domain | Claude Code | M1 |
| T-M2-02 Schema: guests, bookings, lines, events, notifications | schema | Claude Code | T-M2-01 |
| T-M2-03 Guests API | api | Claude Code | T-M2-02 |
| T-M2-04 Quote + create + get + list bookings, BookingSource | api | Claude Code | T-M2-03 |
| T-M2-05 Edit/move/reprice, transitions, cancel, holds job, notifications | api | Claude Code | T-M2-04 |
| T-M2-06 Audit viewer API | api | Claude Code | T-M2-02 |
| T-M2-07 Guests UI + guest picker | ui | OpenCode | T-M2-01 (stub), merge after T-M2-03 |
| T-M2-08 Booking form, detail, list UI | ui | OpenCode | T-M2-01 (stub), merge after T-M2-05 |
| T-M2-09 Notifications bell, audit page, E2E-02/03 | ui/e2e | OpenCode | T-M2-05, T-M2-06, T-M2-08 |

---

### Task 1 (T-M2-01) [domain]: Pricing, booking status, phone helpers and contracts

**Files:**
- Create: `packages/shared/src/domain/pricing.ts`, `packages/shared/src/domain/booking-status.ts`, `packages/shared/src/domain/phone.ts`
- Create: `packages/shared/src/contracts/guests.ts`, `packages/shared/src/contracts/bookings.ts`, `packages/shared/src/contracts/notifications.ts`, `packages/shared/src/contracts/audit.ts`
- Modify: `packages/shared/src/errors.ts` (append codes), `packages/shared/src/index.ts`, `packages/shared/package.json` (add `libphonenumber-js`)
- Test: `packages/shared/src/domain/pricing.test.ts`, `packages/shared/src/domain/booking-status.test.ts`, `packages/shared/src/domain/phone.test.ts`

**Interfaces (produced):**
```ts
// pricing.ts
export type LineKind = 'accommodation' | 'fee' | 'deposit' | 'adjustment';
export type Recognition = 'per_night' | 'on_check_in';
export interface PriceLine { kind: LineKind; feeKind: UnitFeeKind | null; label: string; quantity: number; unitAmountKobo: number; amountKobo: number; refundable: boolean; recognition: Recognition }
export interface QuoteInput { nightlyRateKobo: number; fees: Pick<UnitFee, 'kind'|'label'|'amountKobo'|'basis'|'includedGuests'|'active'>[]; checkIn: IsoDate; checkOut: IsoDate; guestCount: number }
export interface PriceResult { nights: number; lines: PriceLine[]; computedTotalKobo: number; finalTotalKobo: number; depositKobo: number }
export function quote(input: QuoteInput): PriceResult
export function applyOverride(r: PriceResult, finalTotalKobo: number): PriceResult  // adds/removes one 'adjustment' line
export function totals(lines: PriceLine[]): { totalKobo: number; depositKobo: number }
// booking-status.ts
export const ACTIVE_STATUSES: readonly BookingStatus[]
export function canTransition(from: BookingStatus, to: BookingStatus): boolean
export function nextStatuses(from: BookingStatus): BookingStatus[]
export const STATUS_LABELS: Record<BookingStatus, string>
// phone.ts
export function normalizePhone(input: string, defaultCountry?: 'NG'): string | null  // E.164 or null
export function waDigits(e164: string): string  // '+2348012345678' -> '2348012345678'
```
Contracts (exact names): `GuestInput`, `Guest`, `GuestMatchQuery`, `GuestListQuery`; `BookingSource` enum (`whatsapp|phone|walk_in|direct|airbnb|booking_com|other`), `PriceLineSchema`, `QuoteRequest`, `QuoteResponse`, `CreateBookingInput`, `UpdateBookingInput`, `TransitionInput`, `CancelBookingInput`, `Booking`, `BookingSummary`, `BookingListQuery`; `Notification`, `NotificationList`; `AuditEntry`, `AuditQuery`.

- [ ] **Step 1: Write failing tests**

`packages/shared/src/domain/pricing.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyOverride, quote, totals } from './pricing';

const fees = [
  { kind: 'caution_deposit' as const, label: 'Caution deposit', amountKobo: 10_000_000, basis: 'per_stay' as const, includedGuests: null, active: true },
  { kind: 'cleaning' as const, label: 'Cleaning', amountKobo: 1_500_000, basis: 'per_stay' as const, includedGuests: null, active: true },
  { kind: 'extra_guest' as const, label: 'Extra guest', amountKobo: 1_000_000, basis: 'per_guest_night' as const, includedGuests: 2, active: true },
  { kind: 'other' as const, label: 'Generator', amountKobo: 500_000, basis: 'per_night' as const, includedGuests: null, active: true },
  { kind: 'other' as const, label: 'Old fee', amountKobo: 999, basis: 'per_stay' as const, includedGuests: null, active: false },
];

describe('quote [BKG-04]', () => {
  it('prices a 3-night stay for 4 guests', () => {
    const r = quote({ nightlyRateKobo: 20_000_000, fees, checkIn: '2026-11-01', checkOut: '2026-11-04', guestCount: 4 });
    expect(r.nights).toBe(3);
    expect(r.lines.map((l) => [l.kind, l.label, l.quantity, l.amountKobo, l.recognition])).toEqual([
      ['accommodation', '3 nights × ₦200,000', 3, 60_000_000, 'per_night'],
      ['fee', 'Cleaning', 1, 1_500_000, 'on_check_in'],
      ['fee', 'Extra guest (2 × 3 nights)', 6, 6_000_000, 'per_night'],
      ['fee', 'Generator', 3, 1_500_000, 'per_night'],
      ['deposit', 'Caution deposit', 1, 10_000_000, 'on_check_in'],
    ]);
    expect(r.computedTotalKobo).toBe(69_000_000);
    expect(r.finalTotalKobo).toBe(69_000_000);
    expect(r.depositKobo).toBe(10_000_000);
  });
  it('omits extra-guest line when within included guests and skips inactive fees', () => {
    const r = quote({ nightlyRateKobo: 20_000_000, fees, checkIn: '2026-11-01', checkOut: '2026-11-02', guestCount: 2 });
    expect(r.lines.some((l) => l.label.startsWith('Extra guest'))).toBe(false);
    expect(r.lines.some((l) => l.label === 'Old fee')).toBe(false);
  });
  it('uses singular night', () => {
    expect(quote({ nightlyRateKobo: 100, fees: [], checkIn: '2026-11-01', checkOut: '2026-11-02', guestCount: 1 }).lines[0]!.label).toBe('1 night × ₦1');
  });
});

describe('applyOverride [BKG-05]', () => {
  const base = quote({ nightlyRateKobo: 20_000_000, fees, checkIn: '2026-11-01', checkOut: '2026-11-04', guestCount: 2 });
  it('adds a negative adjustment for a discount', () => {
    const r = applyOverride(base, 55_000_000);
    expect(r.finalTotalKobo).toBe(55_000_000);
    expect(r.computedTotalKobo).toBe(base.computedTotalKobo);
    expect(r.lines.at(-1)).toMatchObject({ kind: 'adjustment', amountKobo: 55_000_000 - base.computedTotalKobo, recognition: 'per_night' });
    expect(totals(r.lines)).toEqual({ totalKobo: 55_000_000, depositKobo: 10_000_000 });
  });
  it('replaces a previous adjustment rather than stacking', () => {
    const r = applyOverride(applyOverride(base, 50_000_000), 52_000_000);
    expect(r.lines.filter((l) => l.kind === 'adjustment')).toHaveLength(1);
    expect(r.finalTotalKobo).toBe(52_000_000);
  });
  it('allows zero, refuses negative', () => {
    expect(applyOverride(base, 0).finalTotalKobo).toBe(0);
    expect(() => applyOverride(base, -1)).toThrow('Total cannot be negative');
  });
  it('override equal to computed removes the adjustment', () => {
    expect(applyOverride(applyOverride(base, 1), base.computedTotalKobo).lines.some((l) => l.kind === 'adjustment')).toBe(false);
  });
});
```
`packages/shared/src/domain/booking-status.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { canTransition, nextStatuses } from './booking-status';

describe('booking status [BKG-07]', () => {
  it('allows the documented transitions', () => {
    expect(nextStatuses('tentative')).toEqual(['confirmed', 'cancelled']);
    expect(nextStatuses('confirmed')).toEqual(['checked_in', 'cancelled', 'no_show']);
    expect(nextStatuses('checked_in')).toEqual(['checked_out']);
    expect(nextStatuses('checked_out')).toEqual([]);
    expect(nextStatuses('cancelled')).toEqual([]);
    expect(nextStatuses('no_show')).toEqual([]);
  });
  it('refuses skipping steps', () => {
    expect(canTransition('tentative', 'checked_in')).toBe(false);
    expect(canTransition('checked_in', 'cancelled')).toBe(false);
  });
});
```
`packages/shared/src/domain/phone.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { normalizePhone, waDigits } from './phone';

describe('phone', () => {
  it('normalises Nigerian local numbers', () => {
    expect(normalizePhone('0810 754 8559')).toBe('+2348107548559');
    expect(normalizePhone('+234 810 754 8559')).toBe('+2348107548559');
    expect(normalizePhone('2348107548559')).toBe('+2348107548559');
  });
  it('keeps foreign numbers in international format', () => {
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
  });
  it('returns null for junk', () => {
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone('hello')).toBeNull();
  });
  it('wa digits', () => { expect(waDigits('+2348107548559')).toBe('2348107548559'); });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @boogbe/shared add libphonenumber-js && pnpm --filter @boogbe/shared test`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement domain**

`packages/shared/src/domain/pricing.ts`:
```ts
import type { UnitFee, UnitFeeKind } from '../contracts/inventory';
import { nightsBetween, type IsoDate } from './dates';
import { formatNaira, sumKobo } from './money';

export type LineKind = 'accommodation' | 'fee' | 'deposit' | 'adjustment';
export type Recognition = 'per_night' | 'on_check_in';
export interface PriceLine { kind: LineKind; feeKind: UnitFeeKind | null; label: string; quantity: number; unitAmountKobo: number; amountKobo: number; refundable: boolean; recognition: Recognition }
export interface QuoteInput {
  nightlyRateKobo: number;
  fees: Pick<UnitFee, 'kind' | 'label' | 'amountKobo' | 'basis' | 'includedGuests' | 'active'>[];
  checkIn: IsoDate; checkOut: IsoDate; guestCount: number;
}
export interface PriceResult { nights: number; lines: PriceLine[]; computedTotalKobo: number; finalTotalKobo: number; depositKobo: number }

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function totals(lines: PriceLine[]) {
  return {
    totalKobo: sumKobo(lines.filter((l) => l.kind !== 'deposit').map((l) => l.amountKobo)),
    depositKobo: sumKobo(lines.filter((l) => l.kind === 'deposit').map((l) => l.amountKobo)),
  };
}

export function quote(i: QuoteInput): PriceResult {
  const nights = nightsBetween(i.checkIn, i.checkOut);
  const lines: PriceLine[] = [{
    kind: 'accommodation', feeKind: null, label: `${plural(nights, 'night')} × ${formatNaira(i.nightlyRateKobo)}`,
    quantity: nights, unitAmountKobo: i.nightlyRateKobo, amountKobo: i.nightlyRateKobo * nights, refundable: false, recognition: 'per_night',
  }];
  const deposits: PriceLine[] = [];
  for (const f of i.fees.filter((x) => x.active)) {
    if (f.kind === 'caution_deposit') {
      deposits.push({ kind: 'deposit', feeKind: f.kind, label: f.label, quantity: 1, unitAmountKobo: f.amountKobo, amountKobo: f.amountKobo, refundable: true, recognition: 'on_check_in' });
      continue;
    }
    if (f.basis === 'per_stay') {
      lines.push({ kind: 'fee', feeKind: f.kind, label: f.label, quantity: 1, unitAmountKobo: f.amountKobo, amountKobo: f.amountKobo, refundable: false, recognition: 'on_check_in' });
    } else if (f.basis === 'per_night') {
      lines.push({ kind: 'fee', feeKind: f.kind, label: f.label, quantity: nights, unitAmountKobo: f.amountKobo, amountKobo: f.amountKobo * nights, refundable: false, recognition: 'per_night' });
    } else {
      const extra = Math.max(0, i.guestCount - (f.includedGuests ?? 0));
      if (!extra) continue;
      lines.push({ kind: 'fee', feeKind: f.kind, label: `${f.label} (${extra} × ${plural(nights, 'night')})`, quantity: extra * nights, unitAmountKobo: f.amountKobo, amountKobo: f.amountKobo * extra * nights, refundable: false, recognition: 'per_night' });
    }
  }
  const all = [...lines, ...deposits];
  const { totalKobo, depositKobo } = totals(all);
  return { nights, lines: all, computedTotalKobo: totalKobo, finalTotalKobo: totalKobo, depositKobo };
}

export function applyOverride(r: PriceResult, finalTotalKobo: number): PriceResult {
  if (finalTotalKobo < 0) throw new Error('Total cannot be negative');
  const lines = r.lines.filter((l) => l.kind !== 'adjustment');
  const diff = finalTotalKobo - r.computedTotalKobo;
  if (diff !== 0) {
    const deposit = lines.findIndex((l) => l.kind === 'deposit');
    const adj: PriceLine = { kind: 'adjustment', feeKind: null, label: diff < 0 ? 'Discount' : 'Price adjustment', quantity: 1, unitAmountKobo: diff, amountKobo: diff, refundable: false, recognition: 'per_night' };
    if (deposit === -1) lines.push(adj); else lines.splice(deposit, 0, adj);
  }
  return { ...r, lines, finalTotalKobo };
}
```
`packages/shared/src/domain/booking-status.ts`:
```ts
import type { BookingStatus } from '../contracts/calendar';

const NEXT: Record<BookingStatus, BookingStatus[]> = {
  tentative: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['checked_out'],
  checked_out: [], cancelled: [], no_show: [],
};
export const ACTIVE_STATUSES: readonly BookingStatus[] = ['tentative', 'confirmed', 'checked_in'];
export const STATUS_LABELS: Record<BookingStatus, string> = {
  tentative: 'Tentative', confirmed: 'Confirmed', checked_in: 'Checked in', checked_out: 'Checked out', cancelled: 'Cancelled', no_show: 'No-show',
};
export const nextStatuses = (from: BookingStatus) => [...NEXT[from]];
export const canTransition = (from: BookingStatus, to: BookingStatus) => NEXT[from].includes(to);
```
`packages/shared/src/domain/phone.ts`:
```ts
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

export function normalizePhone(input: string, defaultCountry: 'NG' = 'NG'): string | null {
  const raw = input.trim();
  const candidate = /^234\d{10}$/.test(raw.replace(/\D/g, '')) && !raw.startsWith('+') ? `+${raw.replace(/\D/g, '')}` : raw;
  const p = parsePhoneNumberFromString(candidate, defaultCountry);
  return p && p.isValid() ? p.number : null;
}
export const waDigits = (e164: string) => e164.replace(/^\+/, '');
```
Append to `ERROR_CODES` in `errors.ts`: `'ICAL_OVERLAP', 'CAPACITY_EXCEEDED'`.

- [ ] **Step 4: Implement contracts**

`packages/shared/src/contracts/guests.ts`:
```ts
import { z } from 'zod';
import { E164 } from './common';

export const GuestInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  phoneE164: E164,
  email: z.string().email().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type GuestInput = z.infer<typeof GuestInput>;
export const Guest = z.object({
  id: z.string(), fullName: z.string(), phoneE164: z.string(), email: z.string().nullable(), notes: z.string().nullable(),
  bookingCount: z.number().int(), lifetimeValueKobo: z.number().int(), lastStayAt: z.string().nullable(),
});
export type Guest = z.infer<typeof Guest>;
export const GuestListQuery = z.object({ q: z.string().trim().max(100).optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });
export const GuestMatchQuery = z.object({ phone: E164.optional(), email: z.string().email().optional() });
```
`packages/shared/src/contracts/bookings.ts`:
```ts
import { z } from 'zod';
import { BookingStatus } from './calendar';
import { IsoDateSchema, Kobo } from './common';
import { UnitFeeKind } from './inventory';

export const BookingSourceEnum = z.enum(['whatsapp', 'phone', 'walk_in', 'direct', 'airbnb', 'booking_com', 'other']);
export type BookingSourceValue = z.infer<typeof BookingSourceEnum>;
export const SOURCE_LABELS: Record<BookingSourceValue, string> = { whatsapp: 'WhatsApp', phone: 'Phone call', walk_in: 'Walk-in', direct: 'Direct', airbnb: 'Airbnb', booking_com: 'Booking.com', other: 'Other' };

export const PriceLineSchema = z.object({
  kind: z.enum(['accommodation', 'fee', 'deposit', 'adjustment']), feeKind: UnitFeeKind.nullable(), label: z.string(),
  quantity: z.number(), unitAmountKobo: z.number().int(), amountKobo: z.number().int(), refundable: z.boolean(), recognition: z.enum(['per_night', 'on_check_in']),
});

const Stay = z.object({ unitId: z.string(), checkIn: IsoDateSchema, checkOut: IsoDateSchema, guestCount: z.number().int().min(1).max(50) })
  .refine((s) => s.checkOut > s.checkIn, { path: ['checkOut'], message: 'Check-out must be after check-in' });

export const QuoteRequest = Stay;
export type QuoteRequest = z.infer<typeof QuoteRequest>;
export const Warning = z.object({ kind: z.literal('ical_overlap'), blockId: z.string(), summary: z.string() });
export const QuoteResponse = z.object({
  nights: z.number().int(), lines: z.array(PriceLineSchema), computedTotalKobo: z.number().int(), finalTotalKobo: z.number().int(), depositKobo: z.number().int(),
  available: z.boolean(), conflict: z.object({ kind: z.enum(['booking', 'block']), id: z.string() }).nullable(),
  warnings: z.array(Warning), maxGuests: z.number().int(),
});
export type QuoteResponse = z.infer<typeof QuoteResponse>;

export const CreateBookingInput = Stay.and(z.object({
  guestId: z.string(),
  source: BookingSourceEnum,
  status: z.enum(['tentative', 'confirmed']).default('tentative'),
  notes: z.string().max(2000).nullable().optional(),
  finalTotalKobo: Kobo.optional(),
  overrideReason: z.string().trim().min(3).max(300).optional(),
  acknowledgeIcalOverlap: z.boolean().optional(),
  capacityOverrideReason: z.string().trim().min(3).max(300).optional(),
})).refine((b) => b.finalTotalKobo === undefined || !!b.overrideReason, { path: ['overrideReason'], message: 'Give a reason for changing the price' });
export type CreateBookingInput = z.infer<typeof CreateBookingInput>;

export const UpdateBookingInput = z.object({
  unitId: z.string().optional(), checkIn: IsoDateSchema.optional(), checkOut: IsoDateSchema.optional(),
  guestCount: z.number().int().min(1).max(50).optional(), guestId: z.string().optional(), source: BookingSourceEnum.optional(),
  notes: z.string().max(2000).nullable().optional(),
  reprice: z.boolean().optional(),
  finalTotalKobo: Kobo.optional(), overrideReason: z.string().trim().min(3).max(300).optional(),
  acknowledgeIcalOverlap: z.boolean().optional(), capacityOverrideReason: z.string().trim().min(3).max(300).optional(),
}).strict().refine((b) => b.finalTotalKobo === undefined || !!b.overrideReason, { path: ['overrideReason'], message: 'Give a reason for changing the price' });
export type UpdateBookingInput = z.infer<typeof UpdateBookingInput>;

export const TransitionInput = z.object({ to: z.enum(['confirmed', 'checked_in', 'checked_out', 'no_show']), reason: z.string().max(300).optional() });
export type TransitionInput = z.infer<typeof TransitionInput>;
export const CancelBookingInput = z.object({ reason: z.string().trim().min(3).max(300) });
export type CancelBookingInput = z.infer<typeof CancelBookingInput>;

export const Booking = z.object({
  id: z.string(), ref: z.string(),
  unit: z.object({ id: z.string(), name: z.string(), propertyName: z.string(), maxGuests: z.number().int() }),
  guest: z.object({ id: z.string(), fullName: z.string(), phoneE164: z.string(), email: z.string().nullable() }),
  checkIn: z.string(), checkOut: z.string(), nights: z.number().int(), guestCount: z.number().int(),
  source: BookingSourceEnum, status: BookingStatus, holdUntil: z.string().nullable(),
  lines: z.array(PriceLineSchema), computedTotalKobo: z.number().int(), finalTotalKobo: z.number().int(), depositKobo: z.number().int(),
  overrideReason: z.string().nullable(), capacityOverrideReason: z.string().nullable(), priceStale: z.boolean(), icalWarningAck: z.boolean(),
  notes: z.string().nullable(), createdAt: z.string(),
  history: z.array(z.object({ from: BookingStatus.nullable(), to: BookingStatus, at: z.string(), actorName: z.string().nullable(), reason: z.string().nullable() })),
  // Filled by M3 (payments). null until then.
  paidKobo: z.number().int().nullable(), balanceKobo: z.number().int().nullable(), depositHeldKobo: z.number().int().nullable(),
});
export type Booking = z.infer<typeof Booking>;

export const BookingSummary = z.object({
  id: z.string(), ref: z.string(), unitName: z.string(), propertyName: z.string(), guestName: z.string(),
  checkIn: z.string(), checkOut: z.string(), nights: z.number().int(), status: BookingStatus, source: BookingSourceEnum,
  finalTotalKobo: z.number().int(), balanceKobo: z.number().int().nullable(),
});
export type BookingSummary = z.infer<typeof BookingSummary>;

export const BookingListQuery = z.object({
  from: IsoDateSchema.optional(), to: IsoDateSchema.optional(),
  status: BookingStatus.optional(), unitId: z.string().optional(), source: BookingSourceEnum.optional(),
  q: z.string().trim().max(100).optional(),
  balanceDue: z.enum(['true', 'false']).optional(), // honoured from M3
  cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type BookingListQuery = z.infer<typeof BookingListQuery>;
```
`packages/shared/src/contracts/notifications.ts`:
```ts
import { z } from 'zod';
export const NotificationKind = z.enum(['hold_expired', 'ical_conflict', 'ical_feed_failing', 'statements_ready', 'task_issue', 'message_failed']);
export const Notification = z.object({ id: z.string(), kind: NotificationKind, title: z.string(), body: z.string().nullable(), link: z.string().nullable(), readAt: z.string().nullable(), createdAt: z.string() });
export type Notification = z.infer<typeof Notification>;
export const NotificationList = z.object({ items: z.array(Notification), unreadCount: z.number().int() });
```
`packages/shared/src/contracts/audit.ts`:
```ts
import { z } from 'zod';
export const AuditQuery = z.object({ entity: z.string().optional(), entityId: z.string().optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
export const AuditEntry = z.object({ id: z.string(), at: z.string(), actorName: z.string().nullable(), action: z.string(), entity: z.string(), entityId: z.string(), before: z.unknown(), after: z.unknown() });
export type AuditEntry = z.infer<typeof AuditEntry>;
```
Note: the name `BookingSource` is already the calendar-source interface in the API; the source-channel enum is therefore `BookingSourceEnum`.

Add exports to `packages/shared/src/index.ts`:
```ts
export * from './domain/pricing';
export * from './domain/booking-status';
export * from './domain/phone';
export * from './contracts/guests';
export * from './contracts/bookings';
export * from './contracts/notifications';
export * from './contracts/audit';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @boogbe/shared test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat(shared): pricing, booking status, phone helpers and booking contracts [BKG-04 BKG-05 BKG-07 GST-01]"
```

---

### Task 2 (T-M2-02) [schema]: Guests, bookings, lines, status events, notifications

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0004_bookings/migration.sql`
- Test: `apps/api/test/bookings-schema.int.ts`

**Interfaces:** Prisma models `Guest`, `Booking`, `BookingLine`, `BookingStatusEvent`, `Notification`.

- [ ] **Step 1: Schema**

Append to `prisma/schema.prisma` (and add `bookings Booking[]` to `Unit`):
```prisma
model Guest {
  id           String    @id
  orgId        String    @map("org_id")
  fullName     String    @map("full_name")
  phoneE164    String    @map("phone_e164")
  email        String?
  notes        String?
  anonymisedAt DateTime? @map("anonymised_at")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")
  bookings     Booking[]

  @@index([orgId, phoneE164])
  @@map("guest")
}

model Booking {
  id                     String               @id
  orgId                  String               @map("org_id")
  ref                    String
  unitId                 String               @map("unit_id")
  unit                   Unit                 @relation(fields: [unitId], references: [id])
  guestId                String               @map("guest_id")
  guest                  Guest                @relation(fields: [guestId], references: [id])
  checkIn                DateTime             @db.Date @map("check_in")
  checkOut               DateTime             @db.Date @map("check_out")
  guestCount             Int                  @map("guest_count")
  source                 String
  status                 String
  holdUntil              DateTime?            @map("hold_until")
  computedTotalKobo      BigInt               @map("computed_total_kobo")
  finalTotalKobo         BigInt               @map("final_total_kobo")
  depositKobo            BigInt               @default(0) @map("deposit_kobo")
  overrideReason         String?              @map("override_reason")
  capacityOverrideReason String?              @map("capacity_override_reason")
  priceStale             Boolean              @default(false) @map("price_stale")
  icalWarningAck         Boolean              @default(false) @map("ical_warning_ack")
  notes                  String?
  cancelledAt            DateTime?            @map("cancelled_at")
  cancelReason           String?              @map("cancel_reason")
  checkedInAt            DateTime?            @map("checked_in_at")
  checkedOutAt           DateTime?            @map("checked_out_at")
  createdByMemberId      String?              @map("created_by_member_id")
  createdAt              DateTime             @default(now()) @map("created_at")
  updatedAt              DateTime             @updatedAt @map("updated_at")
  lines                  BookingLine[]
  events                 BookingStatusEvent[]

  @@unique([orgId, ref])
  @@index([orgId, unitId, checkIn])
  @@index([orgId, status, holdUntil])
  @@map("booking")
}

model BookingLine {
  id             String  @id
  orgId          String  @map("org_id")
  bookingId      String  @map("booking_id")
  booking        Booking @relation(fields: [bookingId], references: [id])
  position       Int
  kind           String
  feeKind        String? @map("fee_kind")
  label          String
  quantity       Decimal @db.Decimal(10, 2)
  unitAmountKobo BigInt  @map("unit_amount_kobo")
  amountKobo     BigInt  @map("amount_kobo")
  refundable     Boolean
  recognition    String

  @@index([orgId, bookingId])
  @@map("booking_line")
}

model BookingStatusEvent {
  id            String   @id
  orgId         String   @map("org_id")
  bookingId     String   @map("booking_id")
  booking       Booking  @relation(fields: [bookingId], references: [id])
  fromStatus    String?  @map("from_status")
  toStatus      String   @map("to_status")
  actorMemberId String?  @map("actor_member_id")
  reason        String?
  at            DateTime @default(now())

  @@index([orgId, bookingId, at])
  @@map("booking_status_event")
}

model Notification {
  id        String    @id
  orgId     String    @map("org_id")
  userId    String    @map("user_id")
  kind      String
  title     String
  body      String?
  link      String?
  dedupeKey String?   @map("dedupe_key")
  readAt    DateTime? @map("read_at")
  createdAt DateTime  @default(now()) @map("created_at")

  @@unique([orgId, userId, dedupeKey])
  @@index([orgId, userId, createdAt])
  @@map("notification")
}
```

- [ ] **Step 2: Migration SQL**

`pnpm db:migrate -- --name bookings --create-only`, rename to `0004_bookings`, append:
```sql
ALTER TABLE guest                ADD CONSTRAINT guest_org_fk   FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE booking              ADD CONSTRAINT booking_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE booking_line         ADD CONSTRAINT booking_line_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE booking_status_event ADD CONSTRAINT booking_status_event_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE notification         ADD CONSTRAINT notification_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE notification         ADD CONSTRAINT notification_user_fk FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;

ALTER TABLE booking ADD CONSTRAINT booking_range_chk CHECK (check_out > check_in);
ALTER TABLE booking ADD CONSTRAINT booking_status_chk CHECK (status IN ('tentative','confirmed','checked_in','checked_out','cancelled','no_show'));
ALTER TABLE booking ADD CONSTRAINT booking_source_chk CHECK (source IN ('whatsapp','phone','walk_in','direct','airbnb','booking_com','other'));
ALTER TABLE booking ADD CONSTRAINT booking_totals_chk CHECK (final_total_kobo >= 0 AND computed_total_kobo >= 0 AND deposit_kobo >= 0);
ALTER TABLE booking ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (unit_id WITH =, daterange(check_in, check_out, '[)') WITH &&)
  WHERE (status IN ('tentative','confirmed','checked_in'));
ALTER TABLE booking_line ADD CONSTRAINT booking_line_kind_chk CHECK (kind IN ('accommodation','fee','deposit','adjustment'));

CREATE INDEX guest_name_trgm ON guest USING gin (full_name gin_trgm_ops);
CREATE INDEX guest_email_lower ON guest (org_id, lower(email));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['guest','booking','booking_line','booking_status_event','notification'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

-- Status history is append-only.
REVOKE UPDATE, DELETE ON booking_status_event FROM boogbe_app;
```

- [ ] **Step 3: Write failing schema test**

`apps/api/test/bookings-schema.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';
import { OrgDb } from '../src/common/db/org-db.service';
import { newId } from '../src/common/db/ids';

describe('booking exclusion constraint', () => {
  let t: TestApp; let db: OrgDb; let orgId: string; let unitId: string; let guestId: string;
  beforeAll(async () => { t = await createTestApp(); db = t.app.get(OrgDb); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id; unitId = await seedUnit(orgId, await seedProperty(orgId));
    guestId = await db.run(orgId, async (tx) => (await tx.guest.create({ data: { id: newId(), fullName: 'Ada', phoneE164: '+2348000000000' } as never })).id);
  });
  const mk = (ci: string, co: string, status = 'confirmed') => db.run(orgId, (tx) => tx.booking.create({ data: {
    id: newId(), ref: newId(), unitId, guestId, checkIn: new Date(ci), checkOut: new Date(co), guestCount: 2, source: 'whatsapp', status, computedTotalKobo: 1n, finalTotalKobo: 1n,
  } as never }));

  it('refuses overlapping active bookings, allows back-to-back and cancelled overlaps', async () => {
    await mk('2026-11-01', '2026-11-04');
    await mk('2026-11-04', '2026-11-06');
    await mk('2026-11-02', '2026-11-03', 'cancelled');
    await expect(mk('2026-11-03', '2026-11-05')).rejects.toThrow(/booking_no_overlap|23P01|exclusion/);
  });
});
```

- [ ] **Step 4: Apply and run**

Run: `pnpm db:reset && pnpm --filter @boogbe/api prisma:generate && pnpm test:int`
Expected: PASS (RLS coverage includes 5 new tables).

- [ ] **Step 5: Commit**
```bash
git add prisma apps/api/test
git commit -m "feat(db): guests, bookings with no-overlap exclusion, lines, status events, notifications [BKG-02]"
```

---

### Task 3 (T-M2-03) [api]: Guests API

**Files:**
- Create: `apps/api/src/modules/guests/{guests.module.ts,guests.controller.ts,guests.service.ts}`
- Modify: `apps/api/src/app.module.ts`, `apps/api/test/helpers/routes.ts`, `apps/api/test/helpers/inventory.ts` (add `seedGuest`)
- Test: `apps/api/test/guests.int.ts`

**Interfaces:**
- `GET /v1/guests?q&cursor&limit` (`guests.read`) → `Page<Guest>` ordered by `full_name`; `q` matches name (trigram `ILIKE '%q%'`), phone digits, or email prefix.
- `GET /v1/guests/match?phone&email` (`guests.read`) → `{ items: Guest[] }` exact matches on normalised phone or lower(email) (GST-03).
- `GET /v1/guests/:id` → `Guest & { bookings: BookingSummary[] }` (bookings list comes from `BookingsService.listForGuest` in T-M2-04; until then the field is `[]`).
- `POST /v1/guests` (`guests.write`), `PATCH /v1/guests/:id`.
- `GuestsService.get(tx, id)` used by bookings; `seedGuest(orgId, { fullName?, phoneE164? }): Promise<string>`.
- Cursor: base64url of `${fullName}\u0000${id}`; next page `WHERE (full_name, id) > ($name, $id)`.

- [ ] **Step 1: Write failing tests**

`apps/api/test/guests.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';

describe('guests [GST-01..04]', () => {
  let t: TestApp; let fd: Agent; let orgId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await truncateAll(); orgId = (await seedOrg()).id; fd = (await signInAs(t, 'frontdesk', orgId)).agent; });

  it('creates and searches by name, phone and email', async () => {
    await fd.post('/v1/guests').send({ fullName: 'Adaeze Okafor', phoneE164: '+2348031234567', email: 'ada@example.ng' }).expect(201);
    await fd.post('/v1/guests').send({ fullName: 'Tunde Bakare', phoneE164: '+2348099999999' }).expect(201);
    expect((await fd.get('/v1/guests?q=adae').expect(200)).body.items.map((g: { fullName: string }) => g.fullName)).toEqual(['Adaeze Okafor']);
    expect((await fd.get('/v1/guests?q=0809999').expect(200)).body.items.map((g: { fullName: string }) => g.fullName)).toEqual(['Tunde Bakare']);
    expect((await fd.get('/v1/guests?q=ada@').expect(200)).body.items).toHaveLength(1);
  });

  it('rejects non-E.164 phones', async () => {
    await fd.post('/v1/guests').send({ fullName: 'X Y', phoneE164: '08031234567' }).expect(400);
  });

  it('match finds duplicates by phone or email [GST-03]', async () => {
    await fd.post('/v1/guests').send({ fullName: 'Adaeze Okafor', phoneE164: '+2348031234567', email: 'Ada@Example.ng' }).expect(201);
    expect((await fd.get('/v1/guests/match?phone=%2B2348031234567').expect(200)).body.items).toHaveLength(1);
    expect((await fd.get('/v1/guests/match?email=ada@example.ng').expect(200)).body.items).toHaveLength(1);
    expect((await fd.get('/v1/guests/match?email=other@example.ng').expect(200)).body.items).toHaveLength(0);
  });

  it('paginates with a cursor', async () => {
    for (let i = 0; i < 5; i++) await fd.post('/v1/guests').send({ fullName: `Guest ${i}`, phoneE164: `+23480300000${i}0` }).expect(201);
    const p1 = (await fd.get('/v1/guests?limit=2').expect(200)).body;
    const p2 = (await fd.get(`/v1/guests?limit=2&cursor=${p1.nextCursor}`).expect(200)).body;
    expect(p1.items.map((g: { fullName: string }) => g.fullName)).toEqual(['Guest 0', 'Guest 1']);
    expect(p2.items.map((g: { fullName: string }) => g.fullName)).toEqual(['Guest 2', 'Guest 3']);
  });

  it('housekeeper and landlord cannot read guests', async () => {
    await (await signInAs(t, 'housekeeper', orgId)).agent.get('/v1/guests').expect(403);
    await (await signInAs(t, 'landlord', orgId)).agent.get('/v1/guests').expect(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:int -- guests`
Expected: FAIL — 404.

- [ ] **Step 3: Implement**

`apps/api/src/modules/guests/guests.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Guest, GuestInput } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';

const enc = (name: string, id: string) => Buffer.from(`${name}\u0000${id}`).toString('base64url');
const dec = (c: string) => { const [name, id] = Buffer.from(c, 'base64url').toString().split('\u0000'); return { name: name!, id: id! }; };

interface Row { id: string; full_name: string; phone_e164: string; email: string | null; notes: string | null; booking_count: number; ltv: bigint | null; last_stay: Date | null }
const toGuest = (r: Row): Guest => ({ id: r.id, fullName: r.full_name, phoneE164: r.phone_e164, email: r.email, notes: r.notes, bookingCount: Number(r.booking_count), lifetimeValueKobo: Number(r.ltv ?? 0n), lastStayAt: r.last_stay ? r.last_stay.toISOString().slice(0, 10) : null });

const SELECT = Prisma.sql`
  SELECT g.id, g.full_name, g.phone_e164, g.email, g.notes,
         count(b.id) FILTER (WHERE b.status NOT IN ('cancelled')) AS booking_count,
         sum(b.final_total_kobo) FILTER (WHERE b.status IN ('confirmed','checked_in','checked_out')) AS ltv,
         max(b.check_in) FILTER (WHERE b.status IN ('checked_in','checked_out')) AS last_stay
  FROM guest g LEFT JOIN booking b ON b.guest_id = g.id`;

@Injectable()
export class GuestsService {
  constructor(private readonly orgDb: OrgDb, private readonly audit: AuditService) {}

  list(ctx: OrgCtx, q: { q?: string; cursor?: string; limit: number }) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const conds: Prisma.Sql[] = [Prisma.sql`g.anonymised_at IS NULL`];
      if (q.q) {
        const digits = q.q.replace(/\D/g, '');
        const like = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        const ors = [Prisma.sql`g.full_name ILIKE ${like}`, Prisma.sql`lower(g.email) LIKE ${q.q.toLowerCase() + '%'}`];
        if (digits.length >= 4) ors.push(Prisma.sql`g.phone_e164 LIKE ${'%' + digits.replace(/^0/, '') + '%'}`);
        conds.push(Prisma.sql`(${Prisma.join(ors, ' OR ')})`);
      }
      if (q.cursor) { const c = dec(q.cursor); conds.push(Prisma.sql`(g.full_name, g.id) > (${c.name}, ${c.id})`); }
      const rows = await tx.$queryRaw<Row[]>`${SELECT} WHERE ${Prisma.join(conds, ' AND ')} GROUP BY g.id ORDER BY g.full_name, g.id LIMIT ${q.limit + 1}`;
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page.map(toGuest), nextCursor: rows.length > q.limit && last ? enc(last.full_name, last.id) : null };
    });
  }

  match(ctx: OrgCtx, q: { phone?: string; email?: string }) {
    if (!q.phone && !q.email) return Promise.resolve({ items: [] });
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const ors: Prisma.Sql[] = [];
      if (q.phone) ors.push(Prisma.sql`g.phone_e164 = ${q.phone}`);
      if (q.email) ors.push(Prisma.sql`lower(g.email) = ${q.email.toLowerCase()}`);
      const rows = await tx.$queryRaw<Row[]>`${SELECT} WHERE g.anonymised_at IS NULL AND (${Prisma.join(ors, ' OR ')}) GROUP BY g.id ORDER BY g.full_name LIMIT 5`;
      return { items: rows.map(toGuest) };
    });
  }

  async getIn(tx: OrgTx, id: string): Promise<Guest> {
    const rows = await tx.$queryRaw<Row[]>`${SELECT} WHERE g.id = ${id} GROUP BY g.id`;
    if (!rows[0]) throw notFound('Guest');
    return toGuest(rows[0]);
  }

  get(ctx: OrgCtx, id: string) { return this.orgDb.run(ctx.orgId, (tx) => this.getIn(tx, id)); }

  create(ctx: OrgCtx, input: GuestInput) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const id = newId();
      await tx.guest.create({ data: { id, fullName: input.fullName, phoneE164: input.phoneE164, email: input.email?.toLowerCase() ?? null, notes: input.notes ?? null } as never });
      await this.audit.record(tx, { actor: ctx, action: 'guest.create', entity: 'guest', entityId: id, after: { fullName: input.fullName } });
      return this.getIn(tx, id);
    });
  }

  update(ctx: OrgCtx, id: string, input: Partial<GuestInput>) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.guest.updateMany({ where: { id, anonymisedAt: null }, data: { ...input, ...(input.email !== undefined && { email: input.email?.toLowerCase() ?? null }) } });
      if (!r.count) throw notFound('Guest');
      await this.audit.record(tx, { actor: ctx, action: 'guest.update', entity: 'guest', entityId: id, after: input });
      return this.getIn(tx, id);
    });
  }
}
```
`guests.controller.ts`:
```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { GuestInput, GuestListQuery, GuestMatchQuery } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { GuestsService } from './guests.service';

class GuestDto extends createZodDto(GuestInput) {}
class GuestPatchDto extends createZodDto(GuestInput.partial()) {}
class ListQ extends createZodDto(GuestListQuery) {}
class MatchQ extends createZodDto(GuestMatchQuery) {}

@Controller('guests')
export class GuestsController {
  constructor(private readonly svc: GuestsService) {}
  @Get() @Permission('guests.read') list(@Ctx() c: RequestCtx, @Query() q: ListQ) { return this.svc.list(requireOrg(c), q); }
  @Get('match') @Permission('guests.read') match(@Ctx() c: RequestCtx, @Query() q: MatchQ) { return this.svc.match(requireOrg(c), q); }
  @Get(':id') @Permission('guests.read') get(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.get(requireOrg(c), id); }
  @Post() @Permission('guests.write') create(@Ctx() c: RequestCtx, @Body() b: GuestDto) { return this.svc.create(requireOrg(c), b); }
  @Patch(':id') @Permission('guests.write') update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: GuestPatchDto) { return this.svc.update(requireOrg(c), id, b); }
}
```
`guests.module.ts`: `@Module({ controllers: [GuestsController], providers: [GuestsService], exports: [GuestsService] })`. Register in `AppModule`.

`seedGuest` in `test/helpers/inventory.ts`:
```ts
export async function seedGuest(orgId: string, g: Partial<{ fullName: string; phoneE164: string }> = {}) {
  const m = await migratorClient(); const id = newId();
  await m.query(`insert into guest(id, org_id, full_name, phone_e164, updated_at) values ($1,$2,$3,$4,now())`, [id, orgId, g.fullName ?? 'Ada Guest', g.phoneE164 ?? '+2348030000000']);
  await m.end(); return id;
}
```
Routes: `ISOLATION_FIXTURES.guest = (orgId) => seedGuest(orgId); ROUTE_FIXTURE.push({ match: /^\/v1\/guests\//, fixture: 'guest' });`

- [ ] **Step 4: Run tests**

Run: `pnpm test:int`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/api
git commit -m "feat(guests): guest CRUD, search, duplicate match and pagination [GST-01..04]"
```

---

### Task 4 (T-M2-04) [api]: Quote, create, get, list bookings; BookingSource

**Files:**
- Create: `apps/api/src/modules/bookings/{bookings.module.ts,bookings.controller.ts,bookings.service.ts,booking.mapper.ts,booking-source.ts,pricing.loader.ts}`
- Modify: `apps/api/src/modules/guests/guests.controller.ts` (guest bookings), `apps/api/src/app.module.ts`, `apps/api/test/helpers/routes.ts`, `apps/api/test/helpers/inventory.ts` (`seedBooking`)
- Test: `apps/api/test/bookings.int.ts`, `apps/api/test/bookings-race.int.ts`

**Interfaces:**
- `POST /v1/bookings/quote` (`bookings.read`) body `QuoteRequest` → `QuoteResponse` (never 409; reports `available`/`conflict`/`warnings`).
- `POST /v1/bookings` (`bookings.write`) body `CreateBookingInput` → `Booking` 201. Errors: 409 `DATES_UNAVAILABLE` (details `{ kind, id }`), 409 `ICAL_OVERLAP` (details `{ warnings }`) unless `acknowledgeIcalOverlap`, 422 `CAPACITY_EXCEEDED` unless admin + `capacityOverrideReason`, 403 when `finalTotalKobo` given without `bookings.override`.
- `GET /v1/bookings/:id` (`bookings.read`) → `Booking`; `GET /v1/bookings` (`bookings.read`) → `Page<BookingSummary>` ordered by `check_in desc, id`.
- `GET /v1/guests/:id/bookings` (`bookings.read`) → `{ items: BookingSummary[] }`.
- `BookingsService.getIn(tx: OrgTx, id: string): Promise<Booking>` (used by M3, M5); `BookingsService.loadPricingInputs(tx, unitId)`; `BookingSourceImpl` implements `CalendarSource` (items include `guestName`, `ref`, `status`, `balanceKobo: null`, `hasConflict: false`; conflicts check active bookings with `ignore.bookingId`).
- `BookingRefs.next(tx, ctx): Promise<string>`.
- Extension point for M3: `BookingsService` emits `this.hooks.afterCreate(tx, booking)` via `BookingHooks` registry (`register({ afterCreate?, afterTransition?, afterCancel?, decorate? })`) — `decorate(tx, bookings: Booking[])` lets M3 fill `paidKobo/balanceKobo/depositHeldKobo`; M5 uses `afterTransition` to queue emails; M6 uses `afterTransition` for turnover tasks.
- Test helper `seedBooking(orgId, unitId, guestId, { checkIn, checkOut, status?, totalKobo? })`.

- [ ] **Step 1: Write failing tests**

`apps/api/test/bookings.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';

async function settings(orgId: string) {
  const m = await migratorClient();
  await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'TAN','TAN','TAN',now())`, [orgId]);
  await m.end();
}

describe('bookings [BKG-01..06 BKG-12 BKG-13]', () => {
  let t: TestApp; let fd: Agent; let orgId: string; let unitId: string; let guestId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id; await settings(orgId);
    unitId = await seedUnit(orgId, await seedProperty(orgId), { name: 'Kairo', rateKobo: 20_000_000, maxGuests: 4 });
    guestId = await seedGuest(orgId, { fullName: 'Adaeze Okafor' });
    fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    await fd.post(`/v1/units/${unitId}/fees`).send({ kind: 'caution_deposit', label: 'Caution deposit', amountKobo: 10_000_000, basis: 'per_stay' }).expect(403); // frontdesk can't add fees
    const admin = (await signInAs(t, 'admin', orgId)).agent;
    await admin.post(`/v1/units/${unitId}/fees`).send({ kind: 'caution_deposit', label: 'Caution deposit', amountKobo: 10_000_000, basis: 'per_stay' }).expect(201);
    await admin.post(`/v1/units/${unitId}/fees`).send({ kind: 'cleaning', label: 'Cleaning', amountKobo: 1_500_000, basis: 'per_stay' }).expect(201);
  });
  const body = (o: Record<string, unknown> = {}) => ({ unitId, guestId, checkIn: '2026-11-01', checkOut: '2026-11-04', guestCount: 2, source: 'whatsapp', ...o });

  it('quotes then creates a tentative booking with a ref and snapshot lines', async () => {
    const q = (await fd.post('/v1/bookings/quote').send({ unitId, checkIn: '2026-11-01', checkOut: '2026-11-04', guestCount: 2 }).expect(200)).body;
    expect(q).toMatchObject({ nights: 3, computedTotalKobo: 61_500_000, depositKobo: 10_000_000, available: true, conflict: null, warnings: [] });
    const b = (await fd.post('/v1/bookings').send(body()).expect(201)).body;
    expect(b.ref).toMatch(/^TAN-\d{4}-0001$/);
    expect(b).toMatchObject({ status: 'tentative', nights: 3, finalTotalKobo: 61_500_000, depositKobo: 10_000_000, guest: { fullName: 'Adaeze Okafor' } });
    expect(b.holdUntil).not.toBeNull();
    expect(b.history).toEqual([expect.objectContaining({ from: null, to: 'tentative' })]);
  });

  it('price snapshot survives a later rate change [BKG-06]', async () => {
    const b = (await fd.post('/v1/bookings').send(body()).expect(201)).body;
    const admin = (await signInAs(t, 'admin', orgId)).agent;
    await admin.patch(`/v1/units/${unitId}`).send({ nightlyRateKobo: 30_000_000 }).expect(200);
    expect((await fd.get(`/v1/bookings/${b.id}`).expect(200)).body.finalTotalKobo).toBe(61_500_000);
  });

  it('refuses overlapping dates with 409 and the conflicting booking', async () => {
    const a = (await fd.post('/v1/bookings').send(body()).expect(201)).body;
    const r = await fd.post('/v1/bookings').send(body({ checkIn: '2026-11-03', checkOut: '2026-11-05' }));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'DATES_UNAVAILABLE', details: { kind: 'booking', id: a.id } });
    await fd.post('/v1/bookings').send(body({ checkIn: '2026-11-04', checkOut: '2026-11-05' })).expect(201); // same-day turnover
  });

  it('refuses dates covered by a manual block', async () => {
    await fd.post('/v1/blocks').send({ unitId, start: '2026-11-02', end: '2026-11-03', reason: 'maintenance' }).expect(201);
    const r = await fd.post('/v1/bookings').send(body());
    expect(r.status).toBe(409);
    expect(r.body.error.details.kind).toBe('block');
  });

  it('iCal overlap needs acknowledgement [BKG-03]', async () => {
    const m = await migratorClient();
    await m.query(`insert into block(id, org_id, unit_id, start, "end", source, reason, external_summary, feed_id, external_uid, updated_at) values ($1,$2,$3,'2026-11-02','2026-11-03','ical','external','Airbnb (Not available)','f1','u1',now())`, [newId(), orgId, unitId]);
    await m.end();
    const r = await fd.post('/v1/bookings').send(body());
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ICAL_OVERLAP');
    const b = (await fd.post('/v1/bookings').send(body({ acknowledgeIcalOverlap: true })).expect(201)).body;
    expect(b.icalWarningAck).toBe(true);
  });

  it('override needs a reason and records computed vs final [BKG-05]', async () => {
    await fd.post('/v1/bookings').send(body({ finalTotalKobo: 55_000_000 })).expect(400);
    const b = (await fd.post('/v1/bookings').send(body({ finalTotalKobo: 55_000_000, overrideReason: 'Returning guest' })).expect(201)).body;
    expect(b).toMatchObject({ computedTotalKobo: 61_500_000, finalTotalKobo: 55_000_000, overrideReason: 'Returning guest' });
    expect(b.lines.find((l: { kind: string }) => l.kind === 'adjustment').amountKobo).toBe(-6_500_000);
  });

  it('override cannot go negative', async () => {
    await fd.post('/v1/bookings').send(body({ finalTotalKobo: -1, overrideReason: 'x x x' })).expect(400);
  });

  it('capacity: frontdesk refused, admin with reason allowed [BKG-01]', async () => {
    const r = await fd.post('/v1/bookings').send(body({ guestCount: 6 }));
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('CAPACITY_EXCEEDED');
    const admin = (await signInAs(t, 'admin', orgId)).agent;
    await admin.post('/v1/bookings').send(body({ guestCount: 6, capacityOverrideReason: 'Two toddlers' })).expect(201);
  });

  it('lists with filters and search; refs increment', async () => {
    await fd.post('/v1/bookings').send(body()).expect(201);
    await fd.post('/v1/bookings').send(body({ checkIn: '2026-12-01', checkOut: '2026-12-02', status: 'confirmed', source: 'airbnb' })).expect(201);
    const all = (await fd.get('/v1/bookings').expect(200)).body.items;
    expect(all.map((b: { ref: string }) => b.ref.slice(-4))).toEqual(['0002', '0001']);
    expect((await fd.get('/v1/bookings?status=confirmed').expect(200)).body.items).toHaveLength(1);
    expect((await fd.get('/v1/bookings?source=whatsapp').expect(200)).body.items).toHaveLength(1);
    expect((await fd.get('/v1/bookings?from=2026-11-30&to=2026-12-31').expect(200)).body.items).toHaveLength(1);
    expect((await fd.get('/v1/bookings?q=adaeze').expect(200)).body.items).toHaveLength(2);
  });

  it('bookings appear on the calendar with guest name', async () => {
    const b = (await fd.post('/v1/bookings').send(body()).expect(201)).body;
    const cal = (await fd.get('/v1/calendar?from=2026-11-01&to=2026-11-10').expect(200)).body;
    expect(cal.items).toEqual([expect.objectContaining({ kind: 'booking', id: b.id, guestName: 'Adaeze Okafor', status: 'tentative', ref: b.ref })]);
  });

  it('manual blocks are refused over a booking', async () => {
    await fd.post('/v1/bookings').send(body()).expect(201);
    await fd.post('/v1/blocks').send({ unitId, start: '2026-11-02', end: '2026-11-03', reason: 'maintenance' }).expect(409);
  });
});
```
`apps/api/test/bookings-race.int.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { seedGuest, seedProperty, seedUnit } from './helpers/inventory';

describe('double-booking race [BKG-02]', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); await truncateAll(); });
  afterAll(async () => { await t.close(); });

  it('20 concurrent overlapping creates → exactly one succeeds', async () => {
    const orgId = (await seedOrg()).id;
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'R','R','R',now())`, [orgId]);
    await m.end();
    const unitId = await seedUnit(orgId, await seedProperty(orgId));
    const guestId = await seedGuest(orgId);
    const { agent } = await signInAs(t, 'frontdesk', orgId);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      agent.post('/v1/bookings').send({ unitId, guestId, checkIn: '2026-11-01', checkOut: `2026-11-0${2 + (i % 5)}`, guestCount: 1, source: 'phone' })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(19);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:int -- bookings`
Expected: FAIL — 404.

- [ ] **Step 3: Implement hooks registry, refs and mapper**

`apps/api/src/modules/bookings/booking-hooks.ts`:
```ts
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

@Injectable()
export class BookingHooks {
  private readonly hooks: BookingHook[] = [];
  register(h: BookingHook) { this.hooks.push(h); }
  async run<K extends keyof BookingHook>(name: K, ...args: Parameters<NonNullable<BookingHook[K]>>) {
    for (const h of this.hooks) { const fn = h[name] as ((...a: unknown[]) => Promise<void>) | undefined; if (fn) await fn.apply(h, args); }
  }
}
```
`apps/api/src/modules/bookings/booking.mapper.ts`:
```ts
import { nightsBetween, type Booking, type BookingSummary, type PriceLine } from '@boogbe/shared';
import type { Prisma } from '@prisma/client';
import { kobo } from '../inventory/mappers';

export const BOOKING_INCLUDE = {
  unit: { include: { property: true } },
  guest: true,
  lines: { orderBy: { position: 'asc' } },
  events: { orderBy: { at: 'asc' } },
} satisfies Prisma.BookingInclude;
export type BookingRow = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function toBooking(r: BookingRow, actorNames: Map<string, string>): Booking {
  return {
    id: r.id, ref: r.ref,
    unit: { id: r.unit.id, name: r.unit.name, propertyName: r.unit.property.name, maxGuests: r.unit.maxGuests },
    guest: { id: r.guest.id, fullName: r.guest.fullName, phoneE164: r.guest.phoneE164, email: r.guest.email },
    checkIn: iso(r.checkIn), checkOut: iso(r.checkOut), nights: nightsBetween(iso(r.checkIn), iso(r.checkOut)), guestCount: r.guestCount,
    source: r.source as Booking['source'], status: r.status as Booking['status'], holdUntil: r.holdUntil?.toISOString() ?? null,
    lines: r.lines.map((l): PriceLine => ({ kind: l.kind as PriceLine['kind'], feeKind: l.feeKind as PriceLine['feeKind'], label: l.label, quantity: Number(l.quantity), unitAmountKobo: Number(l.unitAmountKobo), amountKobo: Number(l.amountKobo), refundable: l.refundable, recognition: l.recognition as PriceLine['recognition'] })),
    computedTotalKobo: kobo(r.computedTotalKobo), finalTotalKobo: kobo(r.finalTotalKobo), depositKobo: kobo(r.depositKobo),
    overrideReason: r.overrideReason, capacityOverrideReason: r.capacityOverrideReason, priceStale: r.priceStale, icalWarningAck: r.icalWarningAck,
    notes: r.notes, createdAt: r.createdAt.toISOString(),
    history: r.events.map((e) => ({ from: (e.fromStatus as Booking['status']) ?? null, to: e.toStatus as Booking['status'], at: e.at.toISOString(), actorName: e.actorMemberId ? actorNames.get(e.actorMemberId) ?? null : null, reason: e.reason })),
    paidKobo: null, balanceKobo: null, depositHeldKobo: null,
  };
}

export function toSummary(b: Booking): BookingSummary {
  return { id: b.id, ref: b.ref, unitName: b.unit.name, propertyName: b.unit.propertyName, guestName: b.guest.fullName, checkIn: b.checkIn, checkOut: b.checkOut, nights: b.nights, status: b.status, source: b.source, finalTotalKobo: b.finalTotalKobo, balanceKobo: b.balanceKobo };
}
```
Actor names: member → user name lookup lives in the global `member`/`user` tables. Add `apps/api/src/common/db/member-names.ts` (in `common/db`, allowed to use `PrismaService`):
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
@Injectable()
export class MemberNames {
  constructor(private readonly prisma: PrismaService) {}
  async forMembers(orgId: string, memberIds: string[]): Promise<Map<string, string>> {
    if (!memberIds.length) return new Map();
    const rows = await this.prisma.member.findMany({ where: { organizationId: orgId, id: { in: [...new Set(memberIds)] } }, include: { user: { select: { name: true } } } });
    return new Map(rows.map((r) => [r.id, r.user.name]));
  }
}
```
Add `MemberNames` to `DbModule` providers/exports.

- [ ] **Step 4: Implement service**

`apps/api/src/modules/bookings/bookings.service.ts`:
```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACTIVE_STATUSES, applyOverride, can, quote, rangesOverlap, todayIn,
  type Booking, type CreateBookingInput, type IsoDate, type PriceResult, type QuoteRequest, type QuoteResponse, type UnitFee,
} from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { MemberNames } from '../../common/db/member-names';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, forbidden, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { BlocksService } from '../inventory/blocks.service';
import { kobo } from '../inventory/mappers';
import { BOOKING_INCLUDE, toBooking, toSummary, type BookingRow } from './booking.mapper';
import { BookingHooks } from './booking-hooks';

const day = (s: IsoDate) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class BookingsService {
  constructor(
    private readonly orgDb: OrgDb, private readonly audit: AuditService, private readonly blocks: BlocksService,
    private readonly names: MemberNames, readonly hooks: BookingHooks,
  ) {}

  async loadPricingInputs(tx: OrgTx, unitId: string) {
    const unit = await tx.unit.findFirst({ where: { id: unitId, active: true } });
    if (!unit) throw new AppError('VALIDATION_FAILED', 400, 'Unit not found or archived');
    const fees = await tx.unitFee.findMany({ where: { unitId, active: true }, orderBy: { createdAt: 'asc' } });
    return {
      unit,
      fees: fees.map((f) => ({ kind: f.kind as UnitFee['kind'], label: f.label, amountKobo: kobo(f.amountKobo), basis: f.basis as UnitFee['basis'], includedGuests: f.includedGuests, active: f.active })),
    };
  }

  async icalWarnings(tx: OrgTx, unitId: string, checkIn: IsoDate, checkOut: IsoDate) {
    const rows = await tx.block.findMany({ where: { unitId, source: 'ical', start: { lt: day(checkOut) }, end: { gt: day(checkIn) } } });
    return rows.map((b) => ({ kind: 'ical_overlap' as const, blockId: b.id, summary: b.externalSummary ?? 'External booking' }));
  }

  async conflictFor(tx: OrgTx, unitId: string, checkIn: IsoDate, checkOut: IsoDate, ignoreBookingId?: string) {
    const b = await tx.booking.findFirst({ where: { unitId, status: { in: [...ACTIVE_STATUSES] }, checkIn: { lt: day(checkOut) }, checkOut: { gt: day(checkIn) }, ...(ignoreBookingId && { id: { not: ignoreBookingId } }) } });
    if (b) return { kind: 'booking' as const, id: b.id };
    return this.blocks.conflicts(tx, unitId, checkIn, checkOut);
  }

  quote(ctx: OrgCtx, q: QuoteRequest): Promise<QuoteResponse> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const { unit, fees } = await this.loadPricingInputs(tx, q.unitId);
      const r = quote({ nightlyRateKobo: kobo(unit.nightlyRateKobo), fees, checkIn: q.checkIn, checkOut: q.checkOut, guestCount: q.guestCount });
      const conflict = await this.conflictFor(tx, q.unitId, q.checkIn, q.checkOut);
      return { ...r, available: !conflict, conflict, warnings: await this.icalWarnings(tx, q.unitId, q.checkIn, q.checkOut), maxGuests: unit.maxGuests };
    });
  }

  async writeLines(tx: OrgTx, bookingId: string, r: PriceResult) {
    await tx.bookingLine.deleteMany({ where: { bookingId } });
    await tx.bookingLine.createMany({ data: r.lines.map((l, i) => ({
      id: newId(), bookingId, position: i, kind: l.kind, feeKind: l.feeKind, label: l.label, quantity: new Prisma.Decimal(l.quantity),
      unitAmountKobo: BigInt(l.unitAmountKobo), amountKobo: BigInt(l.amountKobo), refundable: l.refundable, recognition: l.recognition,
    })) as never });
  }

  async nextRef(tx: OrgTx, ctx: OrgCtx): Promise<string> {
    const s = await tx.orgSettings.findFirstOrThrow();
    const n = await this.orgDb.nextNumber(tx, 'booking');
    const yymm = todayIn(ctx.timezone).slice(2, 7).replace('-', '');
    return `${s.bookingPrefix}-${yymm}-${String(n).padStart(4, '0')}`;
  }

  checkCapacity(ctx: OrgCtx, guestCount: number, maxGuests: number, reason?: string) {
    if (guestCount <= maxGuests) return;
    if (ctx.role === 'admin' && reason) return;
    throw new AppError('CAPACITY_EXCEEDED', 422, `This unit sleeps ${maxGuests}. An admin can allow more with a reason.`);
  }

  create(ctx: OrgCtx, input: CreateBookingInput): Promise<Booking> {
    if (input.finalTotalKobo !== undefined && !can(ctx.role, 'bookings.override')) throw forbidden('You cannot change prices');
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const { unit, fees } = await this.loadPricingInputs(tx, input.unitId);
      if (!(await tx.guest.findFirst({ where: { id: input.guestId, anonymisedAt: null } }))) throw new AppError('VALIDATION_FAILED', 400, 'Guest not found');
      this.checkCapacity(ctx, input.guestCount, unit.maxGuests, input.capacityOverrideReason);
      await this.blocks.assertUnitFree(tx, input.unitId, input.checkIn, input.checkOut); // locks unit, checks blocks + bookings (BookingSourceImpl)
      const warnings = await this.icalWarnings(tx, input.unitId, input.checkIn, input.checkOut);
      if (warnings.length && !input.acknowledgeIcalOverlap) throw new AppError('ICAL_OVERLAP', 409, 'These dates overlap a booking on another channel', { warnings });

      let price = quote({ nightlyRateKobo: kobo(unit.nightlyRateKobo), fees, checkIn: input.checkIn, checkOut: input.checkOut, guestCount: input.guestCount });
      if (input.finalTotalKobo !== undefined) price = applyOverride(price, input.finalTotalKobo);

      const s = await tx.orgSettings.findFirstOrThrow();
      const id = newId();
      const ref = await this.nextRef(tx, ctx);
      await tx.booking.create({ data: {
        id, ref, unitId: input.unitId, guestId: input.guestId, checkIn: day(input.checkIn), checkOut: day(input.checkOut), guestCount: input.guestCount,
        source: input.source, status: input.status, holdUntil: input.status === 'tentative' ? new Date(Date.now() + s.holdHours * 3_600_000) : null,
        computedTotalKobo: BigInt(price.computedTotalKobo), finalTotalKobo: BigInt(price.finalTotalKobo), depositKobo: BigInt(price.depositKobo),
        overrideReason: input.finalTotalKobo !== undefined ? input.overrideReason : null, capacityOverrideReason: input.guestCount > unit.maxGuests ? input.capacityOverrideReason : null,
        icalWarningAck: warnings.length > 0, notes: input.notes ?? null, createdByMemberId: ctx.memberId,
      } as never });
      await this.writeLines(tx, id, price);
      await tx.bookingStatusEvent.create({ data: { id: newId(), bookingId: id, fromStatus: null, toStatus: input.status, actorMemberId: ctx.memberId } as never });
      const booking = await this.getIn(tx, ctx.orgId, id);
      await this.audit.record(tx, { actor: ctx, action: 'booking.create', entity: 'booking', entityId: id, after: { ref, unitId: input.unitId, checkIn: input.checkIn, checkOut: input.checkOut, finalTotalKobo: price.finalTotalKobo, overrideReason: input.overrideReason } });
      await this.hooks.run('afterCreate', tx, ctx, booking);
      return booking;
    });
  }

  async hydrate(tx: OrgTx, orgId: string, rows: BookingRow[]): Promise<Booking[]> {
    const names = await this.names.forMembers(orgId, rows.flatMap((r) => r.events.map((e) => e.actorMemberId).filter((x): x is string => !!x)));
    const out = rows.map((r) => toBooking(r, names));
    await this.hooks.run('decorate', tx, out);
    return out;
  }

  async getIn(tx: OrgTx, orgId: string, id: string): Promise<Booking> {
    const r = await tx.booking.findFirst({ where: { id }, include: BOOKING_INCLUDE });
    if (!r) throw notFound('Booking');
    return (await this.hydrate(tx, orgId, [r]))[0]!;
  }

  get(ctx: OrgCtx, id: string) { return this.orgDb.run(ctx.orgId, (tx) => this.getIn(tx, ctx.orgId, id)); }

  list(ctx: OrgCtx, q: { from?: IsoDate; to?: IsoDate; status?: string; unitId?: string; source?: string; q?: string; balanceDue?: string; cursor?: string; limit: number; guestId?: string }) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const where: Prisma.BookingWhereInput = {
        ...(q.status && { status: q.status }), ...(q.unitId && { unitId: q.unitId }), ...(q.source && { source: q.source }), ...(q.guestId && { guestId: q.guestId }),
        ...(q.from && { checkOut: { gt: day(q.from) } }), ...(q.to && { checkIn: { lt: day(q.to) } }),
        ...(q.q && { OR: [{ ref: { contains: q.q, mode: 'insensitive' } }, { guest: { fullName: { contains: q.q, mode: 'insensitive' } } }, { guest: { phoneE164: { contains: q.q.replace(/\D/g, '').replace(/^0/, '') || '∅' } } }] }),
      };
      const cursor = q.cursor ? JSON.parse(Buffer.from(q.cursor, 'base64url').toString()) as { c: string; id: string } : null;
      const rows = await tx.booking.findMany({
        where: cursor ? { AND: [where, { OR: [{ checkIn: { lt: day(cursor.c) } }, { checkIn: day(cursor.c), id: { lt: cursor.id } }] }] } : where,
        include: BOOKING_INCLUDE, orderBy: [{ checkIn: 'desc' }, { id: 'desc' }], take: q.limit + 1,
      });
      const page = rows.slice(0, q.limit);
      let items = (await this.hydrate(tx, ctx.orgId, page)).map(toSummary);
      if (q.balanceDue === 'true') items = items.filter((b) => (b.balanceKobo ?? 0) > 0);
      const last = page.at(-1);
      return { items, nextCursor: rows.length > q.limit && last ? Buffer.from(JSON.stringify({ c: iso(last.checkIn), id: last.id })).toString('base64url') : null };
    });
  }
}
```
(`balanceDue` filtering after pagination is acceptable for v1 page sizes; M3 replaces it with a SQL filter on the ledger view — see M3 Task 3.)

`apps/api/src/modules/bookings/booking-source.ts`:
```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ACTIVE_STATUSES, type CalendarItem, type IsoDate } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { CalendarSources, type CalendarSource, type Ignore } from '../calendar/calendar-sources';

const day = (s: IsoDate) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class BookingSourceImpl implements CalendarSource, OnModuleInit {
  constructor(private readonly sources: CalendarSources) {}
  onModuleInit() { this.sources.register(this); }

  async items(tx: OrgTx, unitIds: string[], from: IsoDate, to: IsoDate, _ctx: OrgCtx): Promise<CalendarItem[]> {
    const rows = await tx.booking.findMany({
      where: { unitId: { in: unitIds }, status: { in: [...ACTIVE_STATUSES, 'checked_out'] }, checkIn: { lt: day(to) }, checkOut: { gt: day(from) } },
      include: { guest: { select: { fullName: true } } },
    });
    return rows.map((b) => ({ kind: 'booking', id: b.id, unitId: b.unitId, start: iso(b.checkIn), end: iso(b.checkOut), status: b.status as never, ref: b.ref, guestName: b.guest.fullName, balanceKobo: null, hasConflict: false }));
  }

  async conflicts(tx: OrgTx, unitId: string, start: IsoDate, end: IsoDate, ignore?: Ignore) {
    const b = await tx.booking.findFirst({ where: { unitId, status: { in: [...ACTIVE_STATUSES] }, checkIn: { lt: day(end) }, checkOut: { gt: day(start) }, ...(ignore?.bookingId && { id: { not: ignore.bookingId } }) } });
    return b ? { kind: 'booking' as const, id: b.id } : null;
  }
}
```
(The landlord portal in M7 uses its own endpoint; the operator calendar always shows guest names to `calendar.read` holders.)

`bookings.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { BookingListQuery, CreateBookingInput, QuoteRequest } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { BookingsService } from './bookings.service';

class QuoteDto extends createZodDto(QuoteRequest) {}
class CreateDto extends createZodDto(CreateBookingInput) {}
class ListQ extends createZodDto(BookingListQuery) {}

@Controller()
export class BookingsController {
  constructor(private readonly svc: BookingsService) {}
  @Post('bookings/quote') @HttpCode(200) @Permission('bookings.read') quote(@Ctx() c: RequestCtx, @Body() b: QuoteDto) { return this.svc.quote(requireOrg(c), b); }
  @Post('bookings') @Permission('bookings.write') create(@Ctx() c: RequestCtx, @Body() b: CreateDto) { return this.svc.create(requireOrg(c), b); }
  @Get('bookings') @Permission('bookings.read') list(@Ctx() c: RequestCtx, @Query() q: ListQ) { return this.svc.list(requireOrg(c), q); }
  @Get('bookings/:id') @Permission('bookings.read') get(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.get(requireOrg(c), id); }
  @Get('guests/:id/bookings') @Permission('bookings.read') async forGuest(@Ctx() c: RequestCtx, @Param('id') id: string) { return { items: (await this.svc.list(requireOrg(c), { guestId: id, limit: 100 })).items }; }
}
```
`bookings.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingHooks } from './booking-hooks';
import { BookingSourceImpl } from './booking-source';

@Global()
@Module({ imports: [InventoryModule], controllers: [BookingsController], providers: [BookingsService, BookingHooks, BookingSourceImpl], exports: [BookingsService, BookingHooks] })
export class BookingsModule {}
```
Register in `AppModule`. `InventoryModule` must export `BlocksService` (done in M1 T5).

Test helper:
```ts
export async function seedBooking(orgId: string, unitId: string, guestId: string, b: { checkIn: string; checkOut: string; status?: string; totalKobo?: number; depositKobo?: number }) {
  const m = await migratorClient(); const id = newId();
  await m.query(`insert into booking(id, org_id, ref, unit_id, guest_id, check_in, check_out, guest_count, source, status, computed_total_kobo, final_total_kobo, deposit_kobo, updated_at)
                 values ($1,$2,$3,$4,$5,$6,$7,2,'phone',$8,$9,$9,$10,now())`,
    [id, orgId, `T-${id.slice(-6)}`, unitId, guestId, b.checkIn, b.checkOut, b.status ?? 'confirmed', b.totalKobo ?? 10_000_000, b.depositKobo ?? 0]);
  await m.query(`insert into booking_line(id, org_id, booking_id, position, kind, label, quantity, unit_amount_kobo, amount_kobo, refundable, recognition) values ($1,$2,$3,0,'accommodation','Stay',1,$4,$4,false,'per_night')`,
    [newId(), orgId, id, b.totalKobo ?? 10_000_000]);
  await m.end(); return id;
}
```
Routes: `ISOLATION_FIXTURES.booking = async (orgId) => { const u = await seedUnit(orgId, await seedProperty(orgId)); return seedBooking(orgId, u, await seedGuest(orgId), { checkIn: '2030-01-01', checkOut: '2030-01-03' }); }; ROUTE_FIXTURE.push({ match: /^\/v1\/bookings\//, fixture: 'booking' });` — keep `/v1/guests/` mapped to `guest`.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: PASS (bookings 11, race 1).

- [ ] **Step 6: Commit**
```bash
git add apps/api
git commit -m "feat(bookings): quote, create with lock + exclusion, refs, list, calendar source [BKG-01..06 BKG-12 BKG-13]"
```

---

### Task 5 (T-M2-05) [api]: Edit/move/reprice, status transitions, cancel, holds job, notifications

**Files:**
- Modify: `apps/api/src/modules/bookings/{bookings.service.ts,bookings.controller.ts,bookings.module.ts}`
- Create: `apps/api/src/modules/bookings/booking-holds.job.ts`
- Create: `apps/api/src/modules/notifications/{notifications.module.ts,notifications.controller.ts,notifications.service.ts}`
- Modify: `apps/api/src/worker.module.ts` (BookingHoldsJob + modules), `apps/api/src/app.module.ts`
- Test: `apps/api/test/booking-lifecycle.int.ts`, `apps/api/test/notifications.int.ts`

**Interfaces:**
- `PATCH /v1/bookings/:id` (`bookings.write`) body `UpdateBookingInput` → `Booking`. Only `tentative`/`confirmed` bookings can change dates/unit; `checked_in` can change `checkOut` (extend/shorten) and notes; finished/cancelled → 422 `INVALID_TRANSITION`. If dates/unit/guestCount change and `reprice !== true`, lines are kept and `priceStale = true`; `reprice: true` recomputes (applying `finalTotalKobo` override if given) and clears `priceStale`.
- `POST /v1/bookings/:id/transition` (`bookings.write`) body `TransitionInput`; `POST /v1/bookings/:id/cancel` (`bookings.write`) body `CancelBookingInput`.
- `BookingsService.transitionIn(tx, ctx: OrgCtx | null, id, to, reason?)` (used by M3 auto-confirm and the holds job).
- `NotificationsService.notifyRoles(tx: OrgTx, orgId: string, roles: OrgRole[], n: { kind; title; body?; link?; dedupeKey? }): Promise<void>`; `notifyMember(tx, orgId, memberId, n)`; endpoints `GET /v1/notifications` (`notifications.read`) → `NotificationList` (latest 50 + unread count), `POST /v1/notifications/:id/read`, `POST /v1/notifications/read-all`.
- `BookingHoldsJob.run(now?: Date)` — cron every 10 minutes in the worker: for each active org, cancel `tentative` bookings with `hold_until < now` using `UPDATE … WHERE status = 'tentative' AND hold_until < now RETURNING id` (so a booking confirmed meanwhile is skipped), write status event (`reason: 'hold_expired'`), notify the creator.

- [ ] **Step 1: Write failing tests**

`apps/api/test/booking-lifecycle.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { WorkerModule } from '../src/worker.module';
import { BookingHoldsJob } from '../src/modules/bookings/booking-holds.job';

describe('booking lifecycle [BKG-07 BKG-08 BKG-10 BKG-11]', () => {
  let t: TestApp; let fd: Agent; let orgId: string; let unitId: string; let unit2: string; let guestId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id;
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, hold_hours, updated_at) values ($1,'T','T','T',24,now())`, [orgId]);
    await m.end();
    const p = await seedProperty(orgId);
    unitId = await seedUnit(orgId, p, { name: 'A', rateKobo: 10_000_000 }); unit2 = await seedUnit(orgId, p, { name: 'B', rateKobo: 12_000_000 });
    guestId = await seedGuest(orgId); fd = (await signInAs(t, 'frontdesk', orgId)).agent;
  });
  const create = (o: Record<string, unknown> = {}) => fd.post('/v1/bookings').send({ unitId, guestId, checkIn: '2026-11-01', checkOut: '2026-11-03', guestCount: 1, source: 'phone', ...o }).expect(201).then((r) => r.body);

  it('walks the happy path and refuses skipping steps', async () => {
    const b = await create();
    await fd.post(`/v1/bookings/${b.id}/transition`).send({ to: 'checked_in' }).expect(422);
    await fd.post(`/v1/bookings/${b.id}/transition`).send({ to: 'confirmed' }).expect(200);
    await fd.post(`/v1/bookings/${b.id}/transition`).send({ to: 'checked_in' }).expect(200);
    const done = (await fd.post(`/v1/bookings/${b.id}/transition`).send({ to: 'checked_out' }).expect(200)).body;
    expect(done.status).toBe('checked_out');
    expect(done.holdUntil).toBeNull();
    expect(done.history.map((h: { to: string }) => h.to)).toEqual(['tentative', 'confirmed', 'checked_in', 'checked_out']);
  });

  it('extending a stay ignores itself; moving keeps price and flags stale', async () => {
    const b = await create();
    const ext = (await fd.patch(`/v1/bookings/${b.id}`).send({ checkOut: '2026-11-05' }).expect(200)).body;
    expect(ext).toMatchObject({ checkOut: '2026-11-05', nights: 4, finalTotalKobo: 20_000_000, priceStale: true });
    const rep = (await fd.patch(`/v1/bookings/${b.id}`).send({ reprice: true }).expect(200)).body;
    expect(rep).toMatchObject({ finalTotalKobo: 40_000_000, priceStale: false });
    const moved = (await fd.patch(`/v1/bookings/${b.id}`).send({ unitId: unit2, reprice: true }).expect(200)).body;
    expect(moved).toMatchObject({ unit: { id: unit2 }, finalTotalKobo: 48_000_000 });
  });

  it('moving onto an occupied unit is refused', async () => {
    await create({ unitId: unit2 });
    const b = await create();
    await fd.patch(`/v1/bookings/${b.id}`).send({ unitId: unit2 }).expect(409);
  });

  it('cancel frees dates and is final', async () => {
    const b = await create();
    await fd.post(`/v1/bookings/${b.id}/cancel`).send({ reason: 'Guest changed plans' }).expect(200);
    await create();
    await fd.post(`/v1/bookings/${b.id}/transition`).send({ to: 'confirmed' }).expect(422);
    await fd.patch(`/v1/bookings/${b.id}`).send({ notes: 'x' }).expect(422);
  });

  it('hold job cancels expired tentatives and notifies; skips bookings confirmed meanwhile', async () => {
    const expired = await create();
    const confirmed = await create({ checkIn: '2026-11-10', checkOut: '2026-11-11' });
    const m = await migratorClient();
    await m.query(`update booking set hold_until = now() - interval '1 minute' where id = any($1)`, [[expired.id, confirmed.id]]);
    await m.end();
    await fd.post(`/v1/bookings/${confirmed.id}/transition`).send({ to: 'confirmed' }).expect(200);

    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const mod = await Test.createTestingModule({ imports: [WorkerModule] }).compile(); await mod.init();
    await mod.get(BookingHoldsJob).run();
    await mod.close();

    expect((await fd.get(`/v1/bookings/${expired.id}`).expect(200)).body.status).toBe('cancelled');
    expect((await fd.get(`/v1/bookings/${confirmed.id}`).expect(200)).body.status).toBe('confirmed');
    const n = (await fd.get('/v1/notifications').expect(200)).body;
    expect(n.unreadCount).toBe(1);
    expect(n.items[0]).toMatchObject({ kind: 'hold_expired', link: `/bookings/${expired.id}` });
  });
});
```
`apps/api/test/notifications.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { OrgDb } from '../src/common/db/org-db.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

describe('notifications [NTF-01]', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await truncateAll(); });

  it('notifies admins only, dedupes, marks read', async () => {
    const orgId = (await seedOrg()).id;
    const admin = await signInAs(t, 'admin', orgId); const fd = await signInAs(t, 'frontdesk', orgId);
    const svc = t.app.get(NotificationsService); const db = t.app.get(OrgDb);
    await db.run(orgId, (tx) => svc.notifyRoles(tx, orgId, ['admin'], { kind: 'ical_feed_failing', title: 'Feed failing', dedupeKey: 'feed-1' }));
    await db.run(orgId, (tx) => svc.notifyRoles(tx, orgId, ['admin'], { kind: 'ical_feed_failing', title: 'Feed failing', dedupeKey: 'feed-1' }));
    const a = (await admin.agent.get('/v1/notifications').expect(200)).body;
    expect(a.unreadCount).toBe(1);
    expect((await fd.agent.get('/v1/notifications').expect(200)).body.unreadCount).toBe(0);
    await admin.agent.post(`/v1/notifications/${a.items[0].id}/read`).expect(200);
    expect((await admin.agent.get('/v1/notifications').expect(200)).body.unreadCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:int -- booking-lifecycle notifications`
Expected: FAIL.

- [ ] **Step 3: Notifications module**

`apps/api/src/modules/notifications/notifications.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { Notification, OrgRole } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { PrismaService } from '../../common/db/prisma.service';
import { newId } from '../../common/db/ids';
import { notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';

export interface NewNotification { kind: Notification['kind']; title: string; body?: string; link?: string; dedupeKey?: string }

@Injectable()
export class NotificationsService {
  constructor(private readonly orgDb: OrgDb, private readonly prisma: PrismaService) {}

  private async insert(tx: OrgTx, userIds: string[], n: NewNotification) {
    if (!userIds.length) return;
    await tx.notification.createMany({ data: userIds.map((userId) => ({ id: newId(), userId, kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: n.dedupeKey ?? null })) as never, skipDuplicates: true });
  }

  async notifyRoles(tx: OrgTx, orgId: string, roles: OrgRole[], n: NewNotification) {
    const members = await this.prisma.member.findMany({ where: { organizationId: orgId, role: { in: roles } }, select: { userId: true } });
    await this.insert(tx, members.map((m) => m.userId), n);
  }

  async notifyMember(tx: OrgTx, orgId: string, memberId: string, n: NewNotification) {
    const m = await this.prisma.member.findFirst({ where: { organizationId: orgId, id: memberId }, select: { userId: true } });
    if (m) await this.insert(tx, [m.userId], n);
  }

  list(ctx: OrgCtx) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const [items, unreadCount] = await Promise.all([
        tx.notification.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
        tx.notification.count({ where: { userId: ctx.userId, readAt: null } }),
      ]);
      return { unreadCount, items: items.map((n) => ({ id: n.id, kind: n.kind as Notification['kind'], title: n.title, body: n.body, link: n.link, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })) };
    });
  }

  markRead(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.notification.updateMany({ where: { id, userId: ctx.userId }, data: { readAt: new Date() } });
      if (!r.count) throw notFound('Notification');
      return { ok: true };
    });
  }

  markAllRead(ctx: OrgCtx) {
    return this.orgDb.run(ctx.orgId, async (tx) => { await tx.notification.updateMany({ where: { userId: ctx.userId, readAt: null }, data: { readAt: new Date() } }); return { ok: true }; });
  }
}
```
(Reads the global `member` table → add `'modules/notifications/'` to `PRISMA_ALLOWED`.)

`notifications.controller.ts`:
```ts
import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}
  @Get() @Permission('notifications.read') list(@Ctx() c: RequestCtx) { return this.svc.list(requireOrg(c)); }
  @Post('read-all') @HttpCode(200) @Permission('notifications.read') all(@Ctx() c: RequestCtx) { return this.svc.markAllRead(requireOrg(c)); }
  @Post(':id/read') @HttpCode(200) @Permission('notifications.read') read(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.markRead(requireOrg(c), id); }
}
```
`notifications.module.ts`: `@Global() @Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })`. Import in `AppModule` and `WorkerModule` (the worker also needs `BookingsModule`, `InventoryModule`, `CalendarModule`, `NotificationsModule`; controllers are harmless in an application context).

- [ ] **Step 4: Update, transition, cancel**

Add to `BookingsService`:
```ts
  async transitionIn(tx: OrgTx, ctx: OrgCtx | null, orgId: string, id: string, to: BookingStatus, reason?: string): Promise<Booking> {
    const b = await tx.booking.findFirst({ where: { id } });
    if (!b) throw notFound('Booking');
    const from = b.status as BookingStatus;
    if (!canTransition(from, to)) throw new AppError('INVALID_TRANSITION', 422, `A ${STATUS_LABELS[from].toLowerCase()} booking cannot become ${STATUS_LABELS[to].toLowerCase()}`);
    const now = new Date();
    const r = await tx.booking.updateMany({ where: { id, status: from }, data: {
      status: to, holdUntil: null,
      ...(to === 'checked_in' && { checkedInAt: now }), ...(to === 'checked_out' && { checkedOutAt: now }),
      ...(to === 'cancelled' && { cancelledAt: now, cancelReason: reason ?? null }),
    } });
    if (!r.count) throw new AppError('CONFLICT', 409, 'The booking changed — refresh and try again');
    await tx.bookingStatusEvent.create({ data: { id: newId(), bookingId: id, fromStatus: from, toStatus: to, actorMemberId: ctx?.memberId ?? null, reason: reason ?? null } as never });
    if (ctx) await this.audit.record(tx, { actor: ctx, action: `booking.${to}`, entity: 'booking', entityId: id, before: { status: from }, after: { status: to, reason } });
    const booking = await this.getIn(tx, orgId, id);
    await this.hooks.run('afterTransition', tx, ctx, booking, from);
    return booking;
  }

  transition(ctx: OrgCtx, id: string, input: TransitionInput) {
    return this.orgDb.run(ctx.orgId, (tx) => this.transitionIn(tx, ctx, ctx.orgId, id, input.to, input.reason));
  }

  cancel(ctx: OrgCtx, id: string, input: CancelBookingInput) {
    return this.orgDb.run(ctx.orgId, (tx) => this.transitionIn(tx, ctx, ctx.orgId, id, 'cancelled', input.reason));
  }

  update(ctx: OrgCtx, id: string, input: UpdateBookingInput): Promise<Booking> {
    if (input.finalTotalKobo !== undefined && !can(ctx.role, 'bookings.override')) throw forbidden('You cannot change prices');
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const before = await this.getIn(tx, ctx.orgId, id);
      const editable = before.status === 'tentative' || before.status === 'confirmed';
      const datesChanging = input.unitId !== undefined || input.checkIn !== undefined || input.checkOut !== undefined;
      if (!editable && before.status !== 'checked_in') throw new AppError('INVALID_TRANSITION', 422, 'This booking can no longer be changed');
      if (before.status === 'checked_in' && (input.unitId !== undefined || input.checkIn !== undefined)) throw new AppError('INVALID_TRANSITION', 422, 'Only the check-out date can change after check-in');

      const next = {
        unitId: input.unitId ?? before.unit.id, checkIn: input.checkIn ?? before.checkIn, checkOut: input.checkOut ?? before.checkOut,
        guestCount: input.guestCount ?? before.guestCount,
      };
      if (next.checkOut <= next.checkIn) throw new AppError('VALIDATION_FAILED', 400, 'Check-out must be after check-in');
      const { unit, fees } = await this.loadPricingInputs(tx, next.unitId);
      if (input.guestCount !== undefined || input.unitId !== undefined) this.checkCapacity(ctx, next.guestCount, unit.maxGuests, input.capacityOverrideReason);
      let icalAck = before.icalWarningAck;
      if (datesChanging) {
        await this.blocks.assertUnitFree(tx, next.unitId, next.checkIn, next.checkOut, { bookingId: id });
        const warnings = await this.icalWarnings(tx, next.unitId, next.checkIn, next.checkOut);
        if (warnings.length && !input.acknowledgeIcalOverlap) throw new AppError('ICAL_OVERLAP', 409, 'These dates overlap a booking on another channel', { warnings });
        icalAck = warnings.length > 0;
      }
      if (input.guestId && !(await tx.guest.findFirst({ where: { id: input.guestId, anonymisedAt: null } }))) throw new AppError('VALIDATION_FAILED', 400, 'Guest not found');

      const pricingChanged = datesChanging || input.guestCount !== undefined;
      const data: Record<string, unknown> = {
        unitId: next.unitId, checkIn: day(next.checkIn), checkOut: day(next.checkOut), guestCount: next.guestCount, icalWarningAck: icalAck,
        ...(input.guestId && { guestId: input.guestId }), ...(input.source && { source: input.source }), ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.capacityOverrideReason && { capacityOverrideReason: input.capacityOverrideReason }),
      };
      if (input.reprice || input.finalTotalKobo !== undefined) {
        let price = input.reprice
          ? quote({ nightlyRateKobo: kobo(unit.nightlyRateKobo), fees, checkIn: next.checkIn, checkOut: next.checkOut, guestCount: next.guestCount })
          : { nights: 0, lines: before.lines, computedTotalKobo: before.computedTotalKobo, finalTotalKobo: before.finalTotalKobo, depositKobo: before.depositKobo };
        if (input.finalTotalKobo !== undefined) price = applyOverride(price, input.finalTotalKobo);
        await this.writeLines(tx, id, price);
        Object.assign(data, {
          computedTotalKobo: BigInt(price.computedTotalKobo), finalTotalKobo: BigInt(price.finalTotalKobo), depositKobo: BigInt(price.depositKobo),
          overrideReason: input.finalTotalKobo !== undefined ? input.overrideReason : input.reprice ? null : before.overrideReason,
          priceStale: input.reprice ? false : before.priceStale || pricingChanged,
        });
      } else if (pricingChanged) {
        data.priceStale = true;
      }
      await tx.booking.updateMany({ where: { id }, data });
      const after = await this.getIn(tx, ctx.orgId, id);
      await this.audit.record(tx, { actor: ctx, action: 'booking.update', entity: 'booking', entityId: id, before: { unitId: before.unit.id, checkIn: before.checkIn, checkOut: before.checkOut, finalTotalKobo: before.finalTotalKobo }, after: input });
      await this.hooks.run('afterUpdate', tx, ctx, before, after);
      return after;
    });
  }
```
Imports to add: `canTransition, STATUS_LABELS, type BookingStatus, type CancelBookingInput, type TransitionInput, type UpdateBookingInput`.

The `PriceResult`-shaped literal passed to `applyOverride` when not repricing reuses the stored lines; `applyOverride` only reads `lines` and `computedTotalKobo` — correct.

Controller additions:
```ts
class UpdateDto extends createZodDto(UpdateBookingInput) {}
class TransitionDto extends createZodDto(TransitionInput) {}
class CancelDto extends createZodDto(CancelBookingInput) {}
  @Patch('bookings/:id') @Permission('bookings.write') update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: UpdateDto) { return this.svc.update(requireOrg(c), id, b); }
  @Post('bookings/:id/transition') @HttpCode(200) @Permission('bookings.write') transition(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: TransitionDto) { return this.svc.transition(requireOrg(c), id, b); }
  @Post('bookings/:id/cancel') @HttpCode(200) @Permission('bookings.write') cancel(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: CancelDto) { return this.svc.cancel(requireOrg(c), id, b); }
```

- [ ] **Step 5: Holds job**

`apps/api/src/modules/bookings/booking-holds.job.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrgDb } from '../../common/db/org-db.service';
import { JobRunner } from '../../common/jobs/job-runner';
import { newId } from '../../common/db/ids';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingHooks } from './booking-hooks';
import { BookingsService } from './bookings.service';

@Injectable()
export class BookingHoldsJob {
  constructor(private readonly runner: JobRunner, private readonly orgDb: OrgDb, private readonly notifications: NotificationsService, private readonly bookings: BookingsService, private readonly hooks: BookingHooks) {}

  @Cron('*/10 * * * *')
  async tick() { await this.run(); }

  async run(now = new Date()) {
    return this.runner.forEachActiveOrg('bookings.expireHolds', (org) => this.orgDb.run(org.id, async (tx) => {
      const expired = await tx.$queryRaw<{ id: string; ref: string; created_by_member_id: string | null }[]>`
        UPDATE booking SET status = 'cancelled', hold_until = NULL, cancelled_at = ${now}, cancel_reason = 'hold_expired', updated_at = ${now}
        WHERE status = 'tentative' AND hold_until < ${now}
        RETURNING id, ref, created_by_member_id`;
      for (const b of expired) {
        await tx.bookingStatusEvent.create({ data: { id: newId(), bookingId: b.id, fromStatus: 'tentative', toStatus: 'cancelled', reason: 'hold_expired' } as never });
        if (b.created_by_member_id) await this.notifications.notifyMember(tx, org.id, b.created_by_member_id, { kind: 'hold_expired', title: `Hold expired: ${b.ref}`, body: 'The tentative booking was released because it was not confirmed in time.', link: `/bookings/${b.id}` });
        await this.hooks.run('afterTransition', tx, null, await this.bookings.getIn(tx, org.id, b.id), 'tentative');
      }
    }));
  }
}
```
Add `BookingHoldsJob` to `WorkerModule.providers` and import `BookingsModule`, `InventoryModule`, `CalendarModule`, `NotificationsModule` into `WorkerModule`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add apps/api
git commit -m "feat(bookings): edit/move/reprice, status transitions, cancel, hold expiry job, notifications [BKG-07 BKG-08 BKG-10 BKG-11 NTF-01]"
```

---

### Task 6 (T-M2-06) [api]: Audit viewer API

**Files:**
- Create: `apps/api/src/modules/audit/{audit-http.module.ts,audit.controller.ts,audit-query.service.ts}`
- Test: `apps/api/test/audit.int.ts`

**Interfaces:** `GET /v1/audit?entity&entityId&cursor&limit` (`audit.read`) → `{ items: AuditEntry[]; nextCursor }` newest first; `actorName` from `MemberNames` (falls back to the user name via `actor_user_id` for platform actions — use `PrismaService` in a small `UserNames` helper in `common/db`).

- [ ] **Step 1: Failing test**

`apps/api/test/audit.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';

describe('audit viewer [AUD-02]', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await truncateAll(); });

  it('admin sees entries with actor names; frontdesk cannot', async () => {
    const orgId = (await seedOrg()).id;
    const admin = await signInAs(t, 'admin', orgId);
    await admin.agent.post('/v1/owners').send({ name: 'Mrs A' }).expect(201);
    const r = (await admin.agent.get('/v1/audit?entity=owner').expect(200)).body;
    expect(r.items[0]).toMatchObject({ action: 'owner.create', entity: 'owner', actorName: 'Test User' });
    await (await signInAs(t, 'frontdesk', orgId)).agent.get('/v1/audit').expect(403);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test:int -- audit` → FAIL (404).

- [ ] **Step 3: Implement**

`apps/api/src/common/db/user-names.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
@Injectable()
export class UserNames {
  constructor(private readonly prisma: PrismaService) {}
  async forUsers(ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    return new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  }
}
```
(Add to `DbModule`.)

`apps/api/src/modules/audit/audit-query.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { AuditEntry } from '@boogbe/shared';
import { OrgDb } from '../../common/db/org-db.service';
import { UserNames } from '../../common/db/user-names';
import type { OrgCtx } from '../../common/auth/request-ctx';

@Injectable()
export class AuditQueryService {
  constructor(private readonly orgDb: OrgDb, private readonly users: UserNames) {}
  list(ctx: OrgCtx, q: { entity?: string; entityId?: string; cursor?: string; limit: number }) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: { ...(q.entity && { entity: q.entity }), ...(q.entityId && { entityId: q.entityId }), ...(q.cursor && { id: { lt: q.cursor } }) },
        orderBy: { id: 'desc' }, take: q.limit + 1, // UUIDv7 ids sort by time
      });
      const page = rows.slice(0, q.limit);
      const names = await this.users.forUsers(page.map((r) => r.actorUserId));
      const items: AuditEntry[] = page.map((r) => ({ id: r.id, at: r.at.toISOString(), actorName: names.get(r.actorUserId) ?? null, action: r.action, entity: r.entity, entityId: r.entityId, before: r.before, after: r.after }));
      return { items, nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
    });
  }
}
```
Note: `AuditLog.id` values written in M0 hooks use `randomUUID()` (v4) — change those two writers (`auth.ts writeAudit`, and any `randomUUID()` audit ids) to `newId()` (UUIDv7) in this task so ordering by id is time order.

`audit.controller.ts`:
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { AuditQuery } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { AuditQueryService } from './audit-query.service';

class Q extends createZodDto(AuditQuery) {}
@Controller('audit')
export class AuditController {
  constructor(private readonly svc: AuditQueryService) {}
  @Get() @Permission('audit.read') list(@Ctx() c: RequestCtx, @Query() q: Q) { return this.svc.list(requireOrg(c), q); }
}
```
`audit-http.module.ts`: `@Module({ controllers: [AuditController], providers: [AuditQueryService] })`; register in `AppModule`.

- [ ] **Step 4: Run tests** — `pnpm test:int` → PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/api
git commit -m "feat(audit): admin audit viewer API [AUD-02]"
```

---

### Task 7 (T-M2-07) [ui]: Guests pages and guest picker

**Files:**
- Create: `apps/app/src/features/guests/{GuestsPage.tsx,GuestDetail.tsx,GuestForm.tsx,GuestPicker.tsx,hooks.ts}`
- Create: `apps/app/src/components/PhoneInput.tsx`
- Modify: `apps/app/src/router.tsx` (routes `/guests`, `/guests/:id`; nav "Guests" `guests.read`)
- Test: `apps/app/src/features/guests/GuestPicker.test.tsx`, `apps/app/src/components/PhoneInput.test.tsx`

**Interfaces:**
- `<PhoneInput value: string | null onChange: (e164: string | null, raw: string) => void />` — accepts local Nigerian formats, shows the normalised number under the field, error text "Enter a valid phone number" when `normalizePhone` returns null.
- `<GuestPicker value: Guest | null onChange: (g: Guest) => void />` — search box (debounced 250 ms) over `/v1/guests?q=`; "New guest" inline form; on phone/email blur calls `/v1/guests/match` and shows "This looks like {name} — use existing?" (GST-03).
- Hooks: `useGuests(q)`, `useGuest(id)`, `useGuestBookings(id)`.

- [ ] **Step 1: Failing tests**

`apps/app/src/components/PhoneInput.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhoneInput } from './PhoneInput';

describe('PhoneInput', () => {
  it('normalises local numbers and reports E.164', async () => {
    const onChange = vi.fn();
    render(<PhoneInput aria-label="Phone" value={null} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Phone'), '08107548559');
    expect(onChange).toHaveBeenLastCalledWith('+2348107548559', '08107548559');
    expect(screen.getByText('+234 810 754 8559')).toBeInTheDocument();
  });
  it('reports null for incomplete numbers', async () => {
    const onChange = vi.fn();
    render(<PhoneInput aria-label="Phone" value={null} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Phone'), '0810');
    expect(onChange).toHaveBeenLastCalledWith(null, '0810');
  });
});
```
`apps/app/src/features/guests/GuestPicker.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { GuestPicker } from './GuestPicker';

const ada = { id: 'g1', fullName: 'Adaeze Okafor', phoneE164: '+2348031234567', email: null, notes: null, bookingCount: 2, lifetimeValueKobo: 0, lastStayAt: null };
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api: vi.fn(async (path: string) => path.startsWith('/v1/guests/match') ? { items: [ada] } : path.startsWith('/v1/guests?') ? { items: [ada], nextCursor: null } : ada),
}));

describe('GuestPicker', () => {
  it('finds an existing guest by search', async () => {
    const onChange = vi.fn();
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><GuestPicker value={null} onChange={onChange} /></SWRConfig>);
    await userEvent.type(screen.getByLabelText(/find guest/i), 'ada');
    await userEvent.click(await screen.findByRole('option', { name: /Adaeze Okafor/ }));
    expect(onChange).toHaveBeenCalledWith(ada);
  });
  it('suggests an existing guest when the new phone matches [GST-03]', async () => {
    render(<SWRConfig value={{ provider: () => new Map() }}><GuestPicker value={null} onChange={vi.fn()} /></SWRConfig>);
    await userEvent.click(screen.getByRole('button', { name: /new guest/i }));
    await userEvent.type(screen.getByLabelText(/^phone/i), '08031234567');
    await userEvent.tab();
    expect(await screen.findByText(/This looks like Adaeze Okafor/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @boogbe/app test` → FAIL.

- [ ] **Step 3: Implement**

`apps/app/src/components/PhoneInput.tsx`:
```tsx
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { useState, type InputHTMLAttributes } from 'react';
import { normalizePhone } from '@boogbe/shared';
import { Input } from '@boogbe/ui';

export function PhoneInput({ value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string | null; onChange: (e164: string | null, raw: string) => void }) {
  const [raw, setRaw] = useState(value ?? '');
  const e164 = normalizePhone(raw);
  return (
    <div>
      <Input {...rest} type="tel" inputMode="tel" autoComplete="tel" value={raw} onChange={(e) => { setRaw(e.target.value); onChange(normalizePhone(e.target.value), e.target.value); }} />
      {e164 && <p className="mt-1 text-xs text-ink-muted">{parsePhoneNumberFromString(e164)!.formatInternational()}</p>}
    </div>
  );
}
```
(`libphonenumber-js` is a dependency of `@boogbe/shared`; add it to `@boogbe/app` too since the component imports it directly.)

`apps/app/src/features/guests/hooks.ts`:
```ts
import { z } from 'zod';
import { BookingSummary, Guest, Page } from '@boogbe/shared';
import { useApi } from '../../lib/api';
export const useGuests = (q: string) => useApi(`/v1/guests?limit=30${q ? `&q=${encodeURIComponent(q)}` : ''}`, Page(Guest));
export const useGuest = (id: string) => useApi(`/v1/guests/${id}`, Guest);
export const useGuestBookings = (id: string) => useApi(`/v1/guests/${id}/bookings`, z.object({ items: z.array(BookingSummary) }));
```
`apps/app/src/features/guests/GuestForm.tsx`:
```tsx
import { useState } from 'react';
import { z } from 'zod';
import { Guest, GuestInput } from '@boogbe/shared';
import { Button, Field, Input } from '@boogbe/ui';
import { PhoneInput } from '../../components/PhoneInput';
import { api } from '../../lib/api';

export function GuestForm({ initial, onSaved, onMatch }: { initial?: Guest; onSaved: (g: Guest) => void; onMatch?: (g: Guest) => void }) {
  const [v, setV] = useState({ fullName: initial?.fullName ?? '', phoneE164: initial?.phoneE164 ?? null as string | null, email: initial?.email ?? '', notes: initial?.notes ?? '' });
  const [match, setMatch] = useState<Guest | null>(null); const [err, setErr] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const check = async () => {
    if (initial || (!v.phoneE164 && !v.email)) return;
    const qs = new URLSearchParams({ ...(v.phoneE164 && { phone: v.phoneE164 }), ...(v.email && { email: v.email }) });
    const r = await api(`/v1/guests/match?${qs}`, { schema: z.object({ items: z.array(Guest) }) });
    setMatch(r.items[0] ?? null);
  };
  return (
    <form noValidate className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const parsed = GuestInput.safeParse({ fullName: v.fullName, phoneE164: v.phoneE164 ?? '', email: v.email || null, notes: v.notes || null });
      if (!parsed.success) return setErr(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      setBusy(true);
      try { onSaved(await api(initial ? `/v1/guests/${initial.id}` : '/v1/guests', { method: initial ? 'PATCH' : 'POST', body: parsed.data, schema: Guest })); }
      finally { setBusy(false); }
    }}>
      <Field label="Full name" error={err.fullName}><Input value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} /></Field>
      <Field label="Phone (WhatsApp)" error={err.phoneE164 && 'Enter a valid phone number'}><PhoneInput value={v.phoneE164} onChange={(p) => setV({ ...v, phoneE164: p })} onBlur={check} /></Field>
      <Field label="Email (optional)" error={err.email}><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} onBlur={check} /></Field>
      {match && onMatch && (
        <div role="status" className="rounded-lg border border-warning bg-warning/10 p-3 text-sm">
          This looks like {match.fullName} ({match.bookingCount} bookings). <button type="button" className="font-medium underline" onClick={() => onMatch(match)}>Use existing guest</button>
        </div>
      )}
      <Field label="Notes"><Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      <Button type="submit" loading={busy}>{initial ? 'Save guest' : 'Add guest'}</Button>
    </form>
  );
}
```
`apps/app/src/features/guests/GuestPicker.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { Guest } from '@boogbe/shared';
import { Button, Input } from '@boogbe/ui';
import { useGuests } from './hooks';
import { GuestForm } from './GuestForm';

export function GuestPicker({ value, onChange }: { value: Guest | null; onChange: (g: Guest) => void }) {
  const [q, setQ] = useState(''); const [debounced, setDebounced] = useState(''); const [creating, setCreating] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  const { data } = useGuests(debounced);
  if (value) return (
    <div className="flex items-center justify-between rounded-lg border border-line p-3">
      <span><span className="font-medium">{value.fullName}</span> <span className="text-sm text-ink-muted">{value.phoneE164}</span></span>
      <Button variant="ghost" onClick={() => onChange(null as never)}>Change</Button>
    </div>
  );
  if (creating) return <GuestForm onSaved={(g) => { setCreating(false); onChange(g); }} onMatch={(g) => { setCreating(false); onChange(g); }} />;
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor="guest-q">Find guest</label>
      <Input id="guest-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or email" autoComplete="off" />
      {debounced && (
        <ul role="listbox" aria-label="Guests" className="max-h-60 overflow-y-auto rounded-lg border border-line">
          {data?.items.map((g) => (
            <li key={g.id} role="option" aria-selected={false} tabIndex={0} onClick={() => onChange(g)} onKeyDown={(e) => e.key === 'Enter' && onChange(g)}
              className="cursor-pointer px-3 py-2 hover:bg-surface-2">{g.fullName} <span className="text-sm text-ink-muted">{g.phoneE164}</span></li>
          ))}
          {data && data.items.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">No match</li>}
        </ul>
      )}
      <Button variant="secondary" onClick={() => setCreating(true)}>New guest</Button>
    </div>
  );
}
```
(`value` nullability: change the prop type to `onChange: (g: Guest | null) => void` and update callers; the `as never` cast above is replaced by `onChange(null)` with that signature.)

`apps/app/src/features/guests/GuestsPage.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog, EmptyState, Input, Spinner, Table } from '@boogbe/ui';
import { formatDate, formatNaira } from '../../lib/format';
import { GuestForm } from './GuestForm';
import { useGuests } from './hooks';

export function GuestsPage() {
  const [q, setQ] = useState(''); const { data, mutate } = useGuests(q); const nav = useNavigate(); const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Guests</h1><Input aria-label="Search guests" placeholder="Search name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" /><Button onClick={() => setOpen(true)}>Add guest</Button></div>
      {!data ? <Spinner /> : data.items.length === 0 ? <EmptyState title="No guests found" /> : (
        <Table rows={data.items} onRowClick={(g) => nav(`/guests/${g.id}`)} columns={[
          { key: 'n', header: 'Name', cell: (g) => g.fullName },
          { key: 'p', header: 'Phone', cell: (g) => g.phoneE164 },
          { key: 'b', header: 'Stays', cell: (g) => g.bookingCount },
          { key: 'v', header: 'Lifetime value', cell: (g) => formatNaira(g.lifetimeValueKobo) },
          { key: 'l', header: 'Last stay', cell: (g) => (g.lastStayAt ? formatDate(g.lastStayAt) : '—') },
        ]} />
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Add guest"><GuestForm onSaved={async (g) => { setOpen(false); await mutate(); nav(`/guests/${g.id}`); }} /></Dialog>
    </div>
  );
}
```
`apps/app/src/features/guests/GuestDetail.tsx`:
```tsx
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { STATUS_LABELS, waDigits } from '@boogbe/shared';
import { Badge, Button, Card, Dialog, Spinner } from '@boogbe/ui';
import { formatDate, formatNaira } from '../../lib/format';
import { GuestForm } from './GuestForm';
import { useGuest, useGuestBookings } from './hooks';

export function GuestDetail() {
  const { id = '' } = useParams(); const { data: g, mutate } = useGuest(id); const { data: b } = useGuestBookings(id); const [edit, setEdit] = useState(false);
  if (!g) return <Spinner />;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-xl font-semibold">{g.fullName}</h1><p className="text-sm text-ink-muted">{g.phoneE164}{g.email && ` · ${g.email}`}</p><p className="text-sm">{g.bookingCount} stays · {formatNaira(g.lifetimeValueKobo)} lifetime</p>{g.notes && <p className="mt-2 text-sm">{g.notes}</p>}</div>
        <div className="flex gap-2"><a href={`https://wa.me/${waDigits(g.phoneE164)}`} target="_blank" rel="noreferrer"><Button variant="secondary">WhatsApp</Button></a><Button variant="secondary" onClick={() => setEdit(true)}>Edit</Button></div>
      </Card>
      <h2 className="font-semibold">Bookings</h2>
      {b?.items.map((x) => (
        <Link key={x.id} to={`/bookings/${x.id}`}><Card className="flex items-center justify-between"><span>{x.ref} · {x.unitName} · {formatDate(x.checkIn)} → {formatDate(x.checkOut)}</span><Badge>{STATUS_LABELS[x.status]}</Badge></Card></Link>
      ))}
      <Dialog open={edit} onClose={() => setEdit(false)} title="Edit guest"><GuestForm initial={g} onSaved={async () => { setEdit(false); await mutate(); }} /></Dialog>
    </div>
  );
}
```
Routes + nav: `{ path: '/guests', element: operator(<GuestsPage />) }`, `{ path: '/guests/:id', element: operator(<GuestDetail />) }`; `OPERATOR_NAV` add `{ to: '/guests', label: 'Guests', icon: Contact, permission: 'guests.read' }`.

- [ ] **Step 4: Run tests and build** — `pnpm --filter @boogbe/app test && pnpm --filter @boogbe/app build` → PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/app
git commit -m "feat(app): guests list, detail, form with duplicate hint and picker [GST-01..04]"
```

---

### Task 8 (T-M2-08) [ui]: Booking form, booking detail, bookings list

**Files:**
- Create: `apps/app/src/features/bookings/{BookingForm.tsx,PriceBreakdown.tsx,BookingDetail.tsx,BookingsPage.tsx,StatusActions.tsx,EditBookingDialog.tsx,hooks.ts,errors.ts}`
- Modify: `apps/app/src/features/calendar/CalendarPage.tsx` (empty selection → booking form with "Block instead" link; booking click → navigate to detail), `apps/app/src/router.tsx` (`/bookings`, `/bookings/:id`; nav "Bookings" `bookings.read`)
- Test: `apps/app/src/features/bookings/BookingForm.test.tsx`, `apps/app/src/features/bookings/errors.test.ts`

**Interfaces:**
- `<BookingForm unitId? checkIn? checkOut? onCreated={(b: Booking) => void} />`: unit select (from `/v1/calendar` units or `/v1/units`), dates, guests, source, guest picker; live quote via `POST /v1/bookings/quote` (debounced 300 ms) → `<PriceBreakdown quote />`; "Change total" toggle (only if `can(role,'bookings.override')`) with `MoneyInput` + reason; status radio Tentative/Confirmed; handles `ICAL_OVERLAP` by showing the warnings and a checkbox "I've checked — this booking is not on the other channel" then resubmits with `acknowledgeIcalOverlap`; handles `CAPACITY_EXCEEDED` by showing an admin reason field.
- `bookingErrorMessage(e: ApiError): string` in `errors.ts`.
- Booking detail shows: header (ref, status badge, guest, unit, dates, nights, source), price breakdown (stale banner when `priceStale` with "Reprice" button), notes, history timeline, `<StatusActions booking />` (buttons from `nextStatuses`, Cancel with reason dialog), "Edit" dialog (dates/unit/guests/notes/total). The payments panel slot `<div data-slot="payments" />` is filled in M3; the messages slot in M5.

- [ ] **Step 1: Failing tests**

`apps/app/src/features/bookings/errors.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { bookingErrorMessage } from './errors';

describe('bookingErrorMessage', () => {
  it('explains conflicts in plain words', () => {
    expect(bookingErrorMessage(new ApiError('DATES_UNAVAILABLE', 'x', 409, { kind: 'booking', id: 'b' }))).toBe('Those dates are already booked for this unit.');
    expect(bookingErrorMessage(new ApiError('DATES_UNAVAILABLE', 'x', 409, { kind: 'block', id: 'b' }))).toBe('Those dates are blocked for this unit.');
    expect(bookingErrorMessage(new ApiError('CAPACITY_EXCEEDED', 'This unit sleeps 4.', 422))).toBe('This unit sleeps 4.');
    expect(bookingErrorMessage(new ApiError('INVALID_TRANSITION', 'A cancelled booking cannot become confirmed', 422))).toBe('A cancelled booking cannot become confirmed');
  });
});
```
`apps/app/src/features/bookings/BookingForm.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { BookingForm } from './BookingForm';

const quote = { nights: 3, lines: [{ kind: 'accommodation', feeKind: null, label: '3 nights × ₦200,000', quantity: 3, unitAmountKobo: 20_000_000, amountKobo: 60_000_000, refundable: false, recognition: 'per_night' }, { kind: 'deposit', feeKind: 'caution_deposit', label: 'Caution deposit', quantity: 1, unitAmountKobo: 10_000_000, amountKobo: 10_000_000, refundable: true, recognition: 'on_check_in' }], computedTotalKobo: 60_000_000, finalTotalKobo: 60_000_000, depositKobo: 10_000_000, available: true, conflict: null, warnings: [], maxGuests: 4 };
const guest = { id: 'g1', fullName: 'Adaeze Okafor', phoneE164: '+2348031234567', email: null, notes: null, bookingCount: 0, lifetimeValueKobo: 0, lastStayAt: null };
const calls: { path: string; body?: unknown }[] = [];
let createAttempts = 0;
vi.mock('../../lib/api', async (orig) => {
  const real = await orig<typeof import('../../lib/api')>();
  return {
    ...real,
    api: vi.fn(async (path: string, init?: { body?: unknown }) => {
      calls.push({ path, body: init?.body });
      if (path === '/v1/bookings/quote') return quote;
      if (path.startsWith('/v1/units')) return { items: [{ id: 'u1', name: 'Kairo', propertyId: 'p', maxGuests: 4, active: true }] };
      if (path.startsWith('/v1/guests?')) return { items: [guest], nextCursor: null };
      if (path === '/v1/bookings') {
        createAttempts++;
        if (createAttempts === 1) throw new real.ApiError('ICAL_OVERLAP', 'overlap', 409, { warnings: [{ kind: 'ical_overlap', blockId: 'x', summary: 'Airbnb (Not available)' }] });
        return { id: 'b1', ref: 'TAN-2610-0001' };
      }
      return {};
    }),
  };
});
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'frontdesk', timezone: 'Africa/Lagos' } } }) }));

describe('BookingForm', () => {
  it('shows the live quote and acknowledges an iCal overlap', async () => {
    const onCreated = vi.fn();
    render(<SWRConfig value={{ provider: () => new Map() }}><BookingForm unitId="u1" checkIn="2026-11-01" checkOut="2026-11-04" onCreated={onCreated} /></SWRConfig>);
    expect(await screen.findByText('3 nights × ₦200,000')).toBeInTheDocument();
    expect(screen.getByText('₦600,000')).toBeInTheDocument();          // total excl. deposit
    expect(screen.getByText(/Caution deposit.*refundable/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/find guest/i), 'ada');
    await userEvent.click(await screen.findByRole('option', { name: /Adaeze/ }));
    await userEvent.click(screen.getByRole('button', { name: /save booking/i }));
    expect(await screen.findByText(/Airbnb \(Not available\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/not on the other channel/i));
    await userEvent.click(screen.getByRole('button', { name: /save booking/i }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls.filter((c) => c.path === '/v1/bookings').at(-1)!.body).toMatchObject({ acknowledgeIcalOverlap: true, guestId: 'g1', unitId: 'u1' });
  });
});
```
(`ApiError` import in the test file is used by the mock; keep it.)

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**

`apps/app/src/features/bookings/errors.ts`:
```ts
import type { ApiError } from '../../lib/api';
export function bookingErrorMessage(e: ApiError): string {
  if (e.code === 'DATES_UNAVAILABLE') return (e.details as { kind?: string } | undefined)?.kind === 'block' ? 'Those dates are blocked for this unit.' : 'Those dates are already booked for this unit.';
  return e.message;
}
```
`apps/app/src/features/bookings/hooks.ts`:
```ts
import { Booking, BookingSummary, Page } from '@boogbe/shared';
import { useApi } from '../../lib/api';
export const useBooking = (id: string) => useApi(`/v1/bookings/${id}`, Booking);
export const useBookings = (qs: string) => useApi(`/v1/bookings?${qs}`, Page(BookingSummary));
```
`apps/app/src/features/bookings/PriceBreakdown.tsx`:
```tsx
import type { PriceLine } from '@boogbe/shared';
import { formatNaira } from '../../lib/format';

export function PriceBreakdown({ lines, totalKobo, depositKobo }: { lines: PriceLine[]; totalKobo: number; depositKobo: number }) {
  const charges = lines.filter((l) => l.kind !== 'deposit');
  const deposits = lines.filter((l) => l.kind === 'deposit');
  return (
    <dl className="flex flex-col gap-1 text-sm">
      {charges.map((l, i) => <div key={i} className="flex justify-between"><dt>{l.label}</dt><dd className={l.amountKobo < 0 ? 'text-success' : ''}>{formatNaira(l.amountKobo)}</dd></div>)}
      <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold"><dt>Total</dt><dd>{formatNaira(totalKobo)}</dd></div>
      {deposits.map((l, i) => <div key={`d${i}`} className="flex justify-between text-ink-muted"><dt>{l.label} (refundable)</dt><dd>{formatNaira(l.amountKobo)}</dd></div>)}
      {depositKobo > 0 && <div className="flex justify-between text-ink-muted"><dt>Guest pays now</dt><dd>{formatNaira(totalKobo + depositKobo)}</dd></div>}
    </dl>
  );
}
```
`apps/app/src/features/bookings/BookingForm.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Booking, BookingSourceEnum, can, QuoteResponse, SOURCE_LABELS, Unit, type Guest } from '@boogbe/shared';
import { Button, Field, Input, Select, Spinner } from '@boogbe/ui';
import { api, ApiError, useApi } from '../../lib/api';
import { useMe } from '../../lib/use-me';
import { MoneyInput } from '../inventory/money-input';
import { GuestPicker } from '../guests/GuestPicker';
import { PriceBreakdown } from './PriceBreakdown';
import { bookingErrorMessage } from './errors';

export function BookingForm({ unitId, checkIn, checkOut, onCreated }: { unitId?: string; checkIn?: string; checkOut?: string; onCreated: (b: Booking) => void }) {
  const { me } = useMe(); const role = me?.activeOrg?.role;
  const { data: units } = useApi('/v1/units', z.object({ items: z.array(Unit.pick({ id: true, name: true, maxGuests: true })) }));
  const [v, setV] = useState({ unitId: unitId ?? '', checkIn: checkIn ?? '', checkOut: checkOut ?? '', guestCount: 2, source: 'whatsapp' as z.infer<typeof BookingSourceEnum>, status: 'tentative' as 'tentative' | 'confirmed', notes: '' });
  const [guest, setGuest] = useState<Guest | null>(null);
  const [q, setQ] = useState<QuoteResponse | null>(null);
  const [override, setOverride] = useState<{ on: boolean; totalKobo: number; reason: string }>({ on: false, totalKobo: 0, reason: '' });
  const [warnings, setWarnings] = useState<{ summary: string }[] | null>(null); const [ack, setAck] = useState(false);
  const [capReason, setCapReason] = useState<string | null>(null);
  const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!v.unitId || !v.checkIn || !v.checkOut || v.checkOut <= v.checkIn) { setQ(null); return; }
    const t = setTimeout(() => { api('/v1/bookings/quote', { method: 'POST', body: { unitId: v.unitId, checkIn: v.checkIn, checkOut: v.checkOut, guestCount: v.guestCount }, schema: QuoteResponse }).then((r) => { setQ(r); setOverride((o) => (o.on ? o : { ...o, totalKobo: r.finalTotalKobo })); }).catch(() => setQ(null)); }, 300);
    return () => clearTimeout(t);
  }, [v.unitId, v.checkIn, v.checkOut, v.guestCount]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(undefined);
    if (!guest) return setErr('Choose or add a guest');
    if (override.on && override.reason.trim().length < 3) return setErr('Give a reason for changing the price');
    setBusy(true);
    try {
      const b = await api('/v1/bookings', { method: 'POST', schema: Booking, body: {
        unitId: v.unitId, checkIn: v.checkIn, checkOut: v.checkOut, guestCount: v.guestCount, guestId: guest.id, source: v.source, status: v.status, notes: v.notes || null,
        ...(override.on && { finalTotalKobo: override.totalKobo, overrideReason: override.reason }),
        ...(ack && { acknowledgeIcalOverlap: true }), ...(capReason && { capacityOverrideReason: capReason }),
      } });
      onCreated(b);
    } catch (x) {
      if (x instanceof ApiError && x.code === 'ICAL_OVERLAP') setWarnings((x.details as { warnings: { summary: string }[] }).warnings);
      else if (x instanceof ApiError && x.code === 'CAPACITY_EXCEEDED' && role === 'admin') { setCapReason(''); setErr(x.message); }
      else setErr(x instanceof ApiError ? bookingErrorMessage(x) : (x as Error).message);
    } finally { setBusy(false); }
  };

  if (!units) return <Spinner />;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Unit"><Select value={v.unitId} onChange={(e) => setV({ ...v, unitId: e.target.value })}><option value="">Choose…</option>{units.items.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
        <Field label="Guests"><Input type="number" min={1} value={v.guestCount} onChange={(e) => setV({ ...v, guestCount: Number(e.target.value) })} /></Field>
        <Field label="Check-in"><Input type="date" value={v.checkIn} onChange={(e) => setV({ ...v, checkIn: e.target.value })} /></Field>
        <Field label="Check-out"><Input type="date" value={v.checkOut} onChange={(e) => setV({ ...v, checkOut: e.target.value })} /></Field>
        <Field label="Booked via"><Select value={v.source} onChange={(e) => setV({ ...v, source: e.target.value as typeof v.source })}>{BookingSourceEnum.options.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}</Select></Field>
        <fieldset className="flex items-end gap-4 text-sm"><legend className="sr-only">Status</legend>
          <label className="flex items-center gap-1"><input type="radio" checked={v.status === 'tentative'} onChange={() => setV({ ...v, status: 'tentative' })} />Tentative (hold)</label>
          <label className="flex items-center gap-1"><input type="radio" checked={v.status === 'confirmed'} onChange={() => setV({ ...v, status: 'confirmed' })} />Confirmed</label>
        </fieldset>
      </div>
      {q && !q.available && <p role="alert" className="text-sm text-danger">{q.conflict?.kind === 'block' ? 'Those dates are blocked for this unit.' : 'Those dates are already booked for this unit.'}</p>}
      {q && q.available && (
        <div className="rounded-lg bg-surface-2 p-3">
          <PriceBreakdown lines={q.lines} totalKobo={override.on ? override.totalKobo : q.finalTotalKobo} depositKobo={q.depositKobo} />
          {role && can(role, 'bookings.override') && (
            <div className="mt-3 flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={override.on} onChange={(e) => setOverride({ ...override, on: e.target.checked, totalKobo: q.finalTotalKobo })} />Change total (agreed price)</label>
              {override.on && <div className="grid gap-2 md:grid-cols-2">
                <Field label="Agreed total"><MoneyInput value={override.totalKobo} onChange={(k) => setOverride({ ...override, totalKobo: k })} /></Field>
                <Field label="Reason"><Input value={override.reason} onChange={(e) => setOverride({ ...override, reason: e.target.value })} placeholder="e.g. Returning guest" /></Field>
              </div>}
            </div>
          )}
        </div>
      )}
      {v.guestCount > (units.items.find((u) => u.id === v.unitId)?.maxGuests ?? 99) && <p className="text-sm text-warning">More guests than this unit sleeps.</p>}
      <GuestPicker value={guest} onChange={setGuest} />
      <Field label="Notes"><Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      {warnings && (
        <div role="alert" className="rounded-lg border border-warning bg-warning/10 p-3 text-sm">
          <p className="font-medium">Another channel shows these dates as taken:</p>
          <ul className="ml-4 list-disc">{warnings.map((w, i) => <li key={i}>{w.summary}</li>)}</ul>
          <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I've checked — this booking is not on the other channel</label>
        </div>
      )}
      {capReason !== null && <Field label="Why allow more guests?"><Input value={capReason} onChange={(e) => setCapReason(e.target.value)} /></Field>}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button type="submit" loading={busy} disabled={!!q && !q.available}>Save booking</Button>
    </form>
  );
}
```
`apps/app/src/features/bookings/StatusActions.tsx`:
```tsx
import { useState } from 'react';
import { nextStatuses, STATUS_LABELS, type Booking } from '@boogbe/shared';
import { Button, Dialog, Field, Input } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { bookingErrorMessage } from './errors';

const VERB: Record<string, string> = { confirmed: 'Confirm', checked_in: 'Check in', checked_out: 'Check out', no_show: 'Mark no-show' };

export function StatusActions({ booking, onChanged }: { booking: Booking; onChanged: () => void }) {
  const [cancel, setCancel] = useState(false); const [reason, setReason] = useState(''); const [err, setErr] = useState<string>();
  const run = async (p: Promise<unknown>) => { setErr(undefined); try { await p; onChanged(); } catch (x) { setErr(x instanceof ApiError ? bookingErrorMessage(x) : String(x)); } };
  const next = nextStatuses(booking.status);
  return (
    <div className="flex flex-wrap gap-2">
      {next.filter((s) => s !== 'cancelled').map((s) => <Button key={s} variant={s === 'no_show' ? 'secondary' : 'primary'} onClick={() => run(api(`/v1/bookings/${booking.id}/transition`, { method: 'POST', body: { to: s } }))}>{VERB[s]}</Button>)}
      {next.includes('cancelled') && <Button variant="danger" onClick={() => setCancel(true)}>Cancel booking</Button>}
      {err && <p role="alert" className="w-full text-sm text-danger">{err}</p>}
      <Dialog open={cancel} onClose={() => setCancel(false)} title={`Cancel ${booking.ref}?`}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void run(api(`/v1/bookings/${booking.id}/cancel`, { method: 'POST', body: { reason } })).then(() => setCancel(false)); }}>
          <p className="text-sm">The dates become free immediately. Refunds are recorded on the payments panel.</p>
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} /></Field>
          <Button type="submit" variant="danger">Cancel booking</Button>
        </form>
      </Dialog>
      <span className="sr-only">Current status {STATUS_LABELS[booking.status]}</span>
    </div>
  );
}
```
`apps/app/src/features/bookings/EditBookingDialog.tsx`:
```tsx
import { useState } from 'react';
import { can, type Booking } from '@boogbe/shared';
import { Button, Field, Input } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/use-me';
import { MoneyInput } from '../inventory/money-input';
import { bookingErrorMessage } from './errors';

export function EditBookingForm({ booking, onSaved }: { booking: Booking; onSaved: () => void }) {
  const { me } = useMe();
  const [v, setV] = useState({ checkIn: booking.checkIn, checkOut: booking.checkOut, guestCount: booking.guestCount, notes: booking.notes ?? '', reprice: false, total: booking.finalTotalKobo, reason: '' });
  const [err, setErr] = useState<string>(); const [ack, setAck] = useState(false); const [busy, setBusy] = useState(false);
  const canOverride = !!me?.activeOrg && can(me.activeOrg.role, 'bookings.override');
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault(); setErr(undefined); setBusy(true);
      const body: Record<string, unknown> = { notes: v.notes || null };
      if (v.checkIn !== booking.checkIn) body.checkIn = v.checkIn;
      if (v.checkOut !== booking.checkOut) body.checkOut = v.checkOut;
      if (v.guestCount !== booking.guestCount) body.guestCount = v.guestCount;
      if (v.reprice) body.reprice = true;
      if (v.total !== booking.finalTotalKobo) Object.assign(body, { finalTotalKobo: v.total, overrideReason: v.reason });
      if (ack) body.acknowledgeIcalOverlap = true;
      try { await api(`/v1/bookings/${booking.id}`, { method: 'PATCH', body }); onSaved(); }
      catch (x) { if (x instanceof ApiError && x.code === 'ICAL_OVERLAP') setErr('These dates overlap another channel. Tick the box to confirm.'); else setErr(x instanceof ApiError ? bookingErrorMessage(x) : String(x)); }
      finally { setBusy(false); }
    }}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Check-in"><Input type="date" value={v.checkIn} disabled={booking.status === 'checked_in'} onChange={(e) => setV({ ...v, checkIn: e.target.value })} /></Field>
        <Field label="Check-out"><Input type="date" value={v.checkOut} onChange={(e) => setV({ ...v, checkOut: e.target.value })} /></Field>
      </div>
      <Field label="Guests"><Input type="number" min={1} value={v.guestCount} onChange={(e) => setV({ ...v, guestCount: Number(e.target.value) })} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.reprice} onChange={(e) => setV({ ...v, reprice: e.target.checked })} />Recalculate price from current rates</label>
      {canOverride && <div className="grid grid-cols-2 gap-2"><Field label="Total"><MoneyInput value={v.total} onChange={(k) => setV({ ...v, total: k })} /></Field><Field label="Reason (if total changed)"><Input value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field></div>}
      <Field label="Notes"><Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      {err?.startsWith('These dates overlap') && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I've checked the other channel</label>}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button type="submit" loading={busy}>Save changes</Button>
    </form>
  );
}
```
`apps/app/src/features/bookings/BookingDetail.tsx`:
```tsx
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SOURCE_LABELS, STATUS_LABELS } from '@boogbe/shared';
import { Badge, Button, Card, Dialog, Spinner } from '@boogbe/ui';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { EditBookingForm } from './EditBookingDialog';
import { useBooking } from './hooks';
import { PriceBreakdown } from './PriceBreakdown';
import { StatusActions } from './StatusActions';

const TONE = { tentative: 'warning', confirmed: 'info', checked_in: 'success', checked_out: 'neutral', cancelled: 'danger', no_show: 'danger' } as const;

/** Slots let later milestones add panels without editing this file's layout: M3 payments, M5 messages. */
export const BOOKING_PANELS: Array<(p: { booking: NonNullable<ReturnType<typeof useBooking>['data']>; refresh: () => void }) => JSX.Element | null> = [];

export function BookingDetail() {
  const { id = '' } = useParams(); const { data: b, mutate } = useBooking(id); const [edit, setEdit] = useState(false);
  if (!b) return <Spinner />;
  const editable = ['tentative', 'confirmed', 'checked_in'].includes(b.status);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{b.ref}</h1><Badge tone={TONE[b.status]}>{STATUS_LABELS[b.status]}</Badge>{b.holdUntil && <span className="text-xs text-ink-muted">Held until {new Date(b.holdUntil).toLocaleString('en-NG')}</span>}</div>
          <p><Link to={`/guests/${b.guest.id}`} className="font-medium text-brand">{b.guest.fullName}</Link> · {b.guest.phoneE164}</p>
          <p className="text-sm">{b.unit.name} ({b.unit.propertyName}) · {formatDate(b.checkIn)} → {formatDate(b.checkOut)} · {b.nights} night{b.nights === 1 ? '' : 's'} · {b.guestCount} guests · via {SOURCE_LABELS[b.source]}</p>
          {b.notes && <p className="text-sm text-ink-muted">{b.notes}</p>}
          <div className="flex flex-wrap gap-2 pt-2"><StatusActions booking={b} onChanged={() => mutate()} />{editable && <Button variant="secondary" onClick={() => setEdit(true)}>Edit</Button>}</div>
        </Card>
        {BOOKING_PANELS.map((Panel, i) => <Panel key={i} booking={b} refresh={() => mutate()} />)}
        <Card>
          <h2 className="mb-2 font-semibold">History</h2>
          <ol className="flex flex-col gap-1 text-sm">{b.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString('en-NG')} — {STATUS_LABELS[h.to]}{h.actorName && ` by ${h.actorName}`}{h.reason && ` (${h.reason === 'hold_expired' ? 'hold expired' : h.reason})`}</li>)}</ol>
        </Card>
      </div>
      <Card className="h-fit">
        <h2 className="mb-2 font-semibold">Price</h2>
        {b.priceStale && <div role="status" className="mb-2 rounded bg-warning/10 p-2 text-sm text-warning">Dates or guests changed since this price was set. <Button variant="ghost" onClick={async () => { await api(`/v1/bookings/${b.id}`, { method: 'PATCH', body: { reprice: true } }); await mutate(); }}>Reprice</Button></div>}
        <PriceBreakdown lines={b.lines} totalKobo={b.finalTotalKobo} depositKobo={b.depositKobo} />
        {b.overrideReason && <p className="mt-2 text-xs text-ink-muted">Price changed: {b.overrideReason}</p>}
      </Card>
      <Dialog open={edit} onClose={() => setEdit(false)} title={`Edit ${b.ref}`}><EditBookingForm booking={b} onSaved={async () => { setEdit(false); await mutate(); }} /></Dialog>
    </div>
  );
}
```
`apps/app/src/features/bookings/BookingsPage.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookingSourceEnum, SOURCE_LABELS, STATUS_LABELS } from '@boogbe/shared';
import { Badge, EmptyState, Input, Select, Spinner, Table } from '@boogbe/ui';
import { formatDate, formatNaira } from '../../lib/format';
import { useBookings } from './hooks';

export function BookingsPage() {
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', status: '', source: '', from: '', to: '' });
  const [cursor, setCursor] = useState<string | null>(null);
  const qs = new URLSearchParams(Object.entries({ ...f, ...(cursor && { cursor }) }).filter(([, v]) => v) as [string, string][]).toString();
  const { data } = useBookings(qs);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Bookings</h1>
      <div className="grid gap-2 md:grid-cols-5">
        <Input aria-label="Search" placeholder="Ref, guest or phone" value={f.q} onChange={(e) => { setCursor(null); setF({ ...f, q: e.target.value }); }} />
        <Select aria-label="Status" value={f.status} onChange={(e) => { setCursor(null); setF({ ...f, status: e.target.value }); }}><option value="">All statuses</option>{Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select aria-label="Source" value={f.source} onChange={(e) => { setCursor(null); setF({ ...f, source: e.target.value }); }}><option value="">All channels</option>{BookingSourceEnum.options.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}</Select>
        <Input aria-label="From" type="date" value={f.from} onChange={(e) => { setCursor(null); setF({ ...f, from: e.target.value }); }} />
        <Input aria-label="To" type="date" value={f.to} onChange={(e) => { setCursor(null); setF({ ...f, to: e.target.value }); }} />
      </div>
      {!data ? <Spinner /> : data.items.length === 0 ? <EmptyState title="No bookings match" /> : (
        <Table rows={data.items} onRowClick={(b) => nav(`/bookings/${b.id}`)} columns={[
          { key: 'ref', header: 'Ref', cell: (b) => b.ref },
          { key: 'g', header: 'Guest', cell: (b) => b.guestName },
          { key: 'u', header: 'Unit', cell: (b) => b.unitName },
          { key: 'd', header: 'Dates', cell: (b) => `${formatDate(b.checkIn)} → ${formatDate(b.checkOut)}` },
          { key: 's', header: 'Status', cell: (b) => <Badge>{STATUS_LABELS[b.status]}</Badge> },
          { key: 't', header: 'Total', cell: (b) => formatNaira(b.finalTotalKobo), className: 'text-right' },
          { key: 'bal', header: 'Balance', cell: (b) => (b.balanceKobo === null ? '—' : formatNaira(b.balanceKobo)), className: 'text-right' },
        ]} />
      )}
      {data?.nextCursor && <button className="self-center text-sm text-brand" onClick={() => setCursor(data.nextCursor)}>Load more</button>}
    </div>
  );
}
```
(“Load more” replaces the page; acceptable for v1 — append-mode can come later.)

`apps/app/src/features/bookings/NewBookingPage.tsx` (full-page form; used by deep links, the day list on mobile, and E2E):
```tsx
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '@boogbe/ui';
import { BookingForm } from './BookingForm';

export function NewBookingPage() {
  const [p] = useSearchParams(); const nav = useNavigate();
  return (
    <Card className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">New booking</h1>
      <BookingForm unitId={p.get('unitId') ?? undefined} checkIn={p.get('checkIn') ?? undefined} checkOut={p.get('checkOut') ?? undefined} onCreated={(b) => nav(`/bookings/${b.id}`)} />
    </Card>
  );
}
```

`CalendarPage.tsx` changes:
- Replace the block dialog trigger: empty selection opens a dialog titled "New booking" rendering `<BookingForm unitId start end onCreated={(b) => nav(`/bookings/${b.id}`)} />` plus a link button "Block these dates instead" that switches the dialog content to `<BlockForm …>`.
- `onItemClick`: if `item.kind === 'booking'` → `nav(`/bookings/${item.id}`)`; blocks keep the existing dialog.
- Day list "Block / book" button opens the same dialog.

Routes and nav: `/bookings` → `operator(<BookingsPage />)`, `/bookings/new` → `operator(<NewBookingPage />)` (declare **before** `/bookings/:id`), `/bookings/:id` → `operator(<BookingDetail />)`; nav `{ to: '/bookings', label: 'Bookings', icon: BookOpen, permission: 'bookings.read' }` after Calendar.

- [ ] **Step 4: Run tests and build** — PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/app
git commit -m "feat(app): booking form with live quote, detail with status actions, bookings list [BKG-01..07 BKG-10..12 CAL-03]"
```

---

### Task 9 (T-M2-09) [ui][e2e]: Notifications bell, audit page, E2E-02 and E2E-03

**Files:**
- Create: `apps/app/src/components/shell/NotificationBell.tsx`, `apps/app/src/routes/settings/AuditLog.tsx`
- Modify: `apps/app/src/components/shell/AppShell.tsx` (bell in header/sidebar), `apps/app/src/router.tsx` (`/settings/audit`, nav "Audit log" `audit.read`)
- Create: `e2e/helpers.ts`, `e2e/e02-book-from-calendar.spec.ts`, `e2e/e03-overlap-refused.spec.ts`
- Test: `apps/app/src/components/shell/NotificationBell.test.tsx`

**Interfaces:**
- `<NotificationBell />` polls `/v1/notifications` every 60 s (SWR `refreshInterval`), shows unread count badge, dropdown list with links; "Mark all read".
- `e2e/helpers.ts`: `onboardOperator(page, browser): Promise<{ adminPage: Page }>` (reuses E2E-01 flow), `createUnit(page, { property, unit, rate })`.

- [ ] **Step 1: Failing unit test**

`apps/app/src/components/shell/NotificationBell.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';

vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api: vi.fn(async () => ({ unreadCount: 2, items: [{ id: 'n1', kind: 'hold_expired', title: 'Hold expired: TAN-2610-0001', body: null, link: '/bookings/b1', readAt: null, createdAt: new Date().toISOString() }] })),
}));

describe('NotificationBell', () => {
  it('shows unread count and items', async () => {
    render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter><NotificationBell /></MemoryRouter></SWRConfig>);
    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByRole('link', { name: /Hold expired: TAN-2610-0001/ })).toHaveAttribute('href', '/bookings/b1');
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**

`apps/app/src/components/shell/NotificationBell.tsx`:
```tsx
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { NotificationList } from '@boogbe/shared';
import { api } from '../../lib/api';

export function NotificationBell() {
  const { data, mutate } = useSWR('/v1/notifications', (p: string) => api(p, { schema: NotificationList }), { refreshInterval: 60_000 });
  const [open, setOpen] = useState(false);
  const unread = data?.unreadCount ?? 0;
  return (
    <div className="relative">
      <button aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={() => setOpen(!open)} className="relative grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-surface-2">
        <Bell size={20} aria-hidden />
        {unread > 0 && <span className="absolute right-1 top-1 rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-[var(--radius-card)] border border-line bg-surface p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 pb-2"><span className="font-semibold">Notifications</span><button className="text-xs text-brand" onClick={async () => { await api('/v1/notifications/read-all', { method: 'POST' }); await mutate(); }}>Mark all read</button></div>
          {data?.items.length ? data.items.map((n) => (
            <Link key={n.id} to={n.link ?? '#'} onClick={async () => { setOpen(false); if (!n.readAt) { await api(`/v1/notifications/${n.id}/read`, { method: 'POST' }); await mutate(); } }}
              className={`block rounded-lg px-2 py-2 text-sm hover:bg-surface-2 ${n.readAt ? 'text-ink-muted' : 'font-medium'}`}>{n.title}{n.body && <span className="block text-xs font-normal text-ink-muted">{n.body}</span>}</Link>
          )) : <p className="px-2 py-4 text-sm text-ink-muted">Nothing new</p>}
        </div>
      )}
    </div>
  );
}
```
Place `<NotificationBell />` next to `OrgSwitcher` in both the desktop sidebar header and the mobile header of `AppShell`.

`apps/app/src/routes/settings/AuditLog.tsx`:
```tsx
import { useState } from 'react';
import { z } from 'zod';
import { AuditEntry } from '@boogbe/shared';
import { Input, Spinner, Table } from '@boogbe/ui';
import { useApi } from '../../lib/api';

export function AuditLog() {
  const [entity, setEntity] = useState(''); const [cursor, setCursor] = useState<string | null>(null);
  const qs = new URLSearchParams({ ...(entity && { entity }), ...(cursor && { cursor }) }).toString();
  const { data } = useApi(`/v1/audit?${qs}`, z.object({ items: z.array(AuditEntry), nextCursor: z.string().nullable() }));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Audit log</h1><Input aria-label="Filter by type" placeholder="e.g. booking, payment" value={entity} onChange={(e) => { setCursor(null); setEntity(e.target.value); }} className="w-56" /></div>
      {!data ? <Spinner /> : <Table rows={data.items} columns={[
        { key: 'at', header: 'When', cell: (r) => new Date(r.at).toLocaleString('en-NG') },
        { key: 'who', header: 'Who', cell: (r) => r.actorName ?? 'System' },
        { key: 'what', header: 'Action', cell: (r) => r.action },
        { key: 'id', header: 'Record', cell: (r) => `${r.entity} ${r.entityId.slice(-6)}` },
        { key: 'chg', header: 'Change', cell: (r) => <details><summary className="cursor-pointer text-brand">View</summary><pre className="max-w-md overflow-x-auto text-xs">{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre></details> },
      ]} />}
      {data?.nextCursor && <button className="self-center text-sm text-brand" onClick={() => setCursor(data.nextCursor)}>Older</button>}
    </div>
  );
}
```
Route `/settings/audit` → `operator(<AuditLog />)`; nav `{ to: '/settings/audit', label: 'Audit log', icon: ScrollText, permission: 'audit.read' }`.

- [ ] **Step 4: E2E specs**

`e2e/helpers.ts`:
```ts
import { expect, type Browser, type Page } from '@playwright/test';
import { lastEmailTo, platformAdmin } from './fixtures';

export async function onboardOperator(page: Page, browser: Browser, slug = 'tanuhomes') {
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(platformAdmin.email);
  await page.getByLabel('Password').fill(platformAdmin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'New operator' }).click();
  await page.getByLabel('Business name').fill('Tanuhomes');
  await page.getByLabel('Slug').fill(slug);
  await page.getByRole('button', { name: 'Create operator' }).click();
  await page.getByLabel('Email').fill(`admin@${slug}.test`);
  await page.getByRole('button', { name: 'Send' }).click();
  const url = /(http\S+\/auth\/accept-invite\/\S+)/.exec((await lastEmailTo(`admin@${slug}.test`))!.text)![1]!;
  const ctx = await browser.newContext(); const admin = await ctx.newPage();
  await admin.goto(url);
  await admin.getByLabel('Your name').fill('Tanu Admin');
  await admin.getByLabel('Password').fill('correct-horse-battery');
  await admin.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(admin).toHaveURL(/\/calendar$/);
  return admin;
}

export async function createUnit(page: Page, o: { property: string; unit: string; rateNaira: string }) {
  await page.goto('/settings/properties');
  await page.getByRole('button', { name: 'Add property' }).click();
  await page.getByLabel('Name').fill(o.property);
  await page.getByLabel('Address').fill('Lekki Phase 1, Lagos');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Add unit' }).click();
  await page.getByLabel('Unit name').fill(o.unit);
  await page.getByLabel('Nightly rate').fill(o.rateNaira);
  await page.getByLabel('Max guests').fill('4');
  await page.getByRole('button', { name: 'Save unit' }).click();
  await expect(page.getByText(o.unit)).toBeVisible();
}
```
`e2e/e02-book-from-calendar.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { resetDb } from './fixtures';
import { createUnit, onboardOperator } from './helpers';

test.beforeAll(() => resetDb());

test('E2E-02 admin adds a unit and books it from the calendar', async ({ page, browser }) => {
  const admin = await onboardOperator(page, browser);
  await createUnit(admin, { property: 'The Rock', unit: 'Kairo', rateNaira: '200000' });
  await admin.goto('/calendar');
  const cells = admin.locator('[data-testid^="cell-"]');
  const first = cells.nth(3); const last = cells.nth(5);
  await first.hover(); await admin.mouse.down(); await last.hover(); await admin.mouse.up();
  await expect(admin.getByRole('heading', { name: 'New booking' })).toBeVisible();
  await expect(admin.getByText('3 nights × ₦200,000')).toBeVisible();
  await admin.getByRole('button', { name: 'New guest' }).click();
  await admin.getByLabel('Full name').fill('Adaeze Okafor');
  await admin.getByLabel(/^Phone/).fill('08031234567');
  await admin.getByRole('button', { name: 'Add guest' }).click();
  await admin.getByRole('button', { name: 'Save booking' }).click();
  await expect(admin).toHaveURL(/\/bookings\//);
  await expect(admin.getByText('₦600,000').first()).toBeVisible();
  await expect(admin.getByText('Tentative')).toBeVisible();
});
```
`e2e/e03-overlap-refused.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { resetDb } from './fixtures';
import { createUnit, onboardOperator } from './helpers';

test.beforeAll(() => resetDb());

test('E2E-03 overlapping booking is refused with a clear message', async ({ page, browser }) => {
  const admin = await onboardOperator(page, browser, 'tanu-overlap');
  await createUnit(admin, { property: 'The Rock', unit: 'Kairo', rateNaira: '200000' });
  const units = await (await admin.request.get('/v1/units')).json();
  const unitId = units.items[0].id as string;
  const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  await admin.goto(`/bookings/new?unitId=${unitId}&checkIn=${d(2)}&checkOut=${d(5)}`);
  await admin.getByRole('button', { name: 'New guest' }).click();
  await admin.getByLabel('Full name').fill('First Guest');
  await admin.getByLabel(/^Phone/).fill('08030000001');
  await admin.getByRole('button', { name: 'Add guest' }).click();
  await admin.getByRole('button', { name: 'Save booking' }).click();
  await expect(admin).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);

  await admin.goto(`/bookings/new?unitId=${unitId}&checkIn=${d(3)}&checkOut=${d(6)}`);
  await expect(admin.getByRole('alert')).toHaveText('Those dates are already booked for this unit.');
  await expect(admin.getByRole('button', { name: 'Save booking' })).toBeDisabled();
});
```
(`admin.request` shares the page's cookies; the Vite dev server proxies `/v1` to the API.)

- [ ] **Step 5: Run**

Run: `pnpm --filter @boogbe/app test && pnpm test:e2e --project=desktop`
Expected: unit PASS; E2E-01..03 pass.

- [ ] **Step 6: Commit**
```bash
git add apps/app e2e
git commit -m "feat(app): notification bell, audit log page; E2E-02 and E2E-03 [NTF-01 AUD-02]"
```

---

## Self-review notes (completed)
- Coverage: GST-01..04 (T3, T7), BKG-01 (T4 capacity/source), BKG-02 (T2 constraint, T4 lock + race), BKG-03 (T4, T8), BKG-04/05/06 (T1, T4), BKG-07 (T1, T5), BKG-08 (T5 job), BKG-10 (T5, T8), BKG-11 cancel (T5; refund in M3), BKG-12 (T4, T8), BKG-13 (T4), NTF-01 in-app (T5, T9; email copies in M4), AUD-02 (T6, T9). BKG-09 auto-confirm → M3.
- Hooks for later milestones: `BookingHooks.register({ afterCreate, afterTransition, afterUpdate, decorate })`, `BOOKING_PANELS` (UI), `BookingsService.getIn/transitionIn/conflictFor`, `NotificationsService.notifyRoles/notifyMember`.
- Name clash avoided: channel enum is `BookingSourceEnum`; calendar source class is `BookingSourceImpl`.
- E2E-03 uses the deterministic `/bookings/new?unitId&checkIn&checkOut` route rather than grid dragging; E2E-02 covers drag-select.
