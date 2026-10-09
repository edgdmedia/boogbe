# M1 — Inventory & Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Claim each task in `docs/COORDINATION.md` before starting.

**Goal:** Operators configure properties, units, owners (effective-dated, per unit with property default), management-fee config, unit fees, manual blocks and a logo, and see a units × dates calendar (desktop grid + mobile day list). Exit: Tanuhomes' 6 apartments configured on staging.

**Architecture:** New tenant tables with RLS (M0 pattern). Contracts in `packages/shared/src/contracts/inventory.ts` and `calendar.ts` are written first (T-M1-01) so API and UI tracks run in parallel. File uploads go browser → R2 via presigned URLs issued by a `FilesService` behind a `Storage` interface (fake in tests).

**Tech Stack:** as M0, plus `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `libphonenumber-js`.

**Spec:** `docs/superpowers/specs/2026-10-09-boogbe-v1-design.md` · FRD: INV-01..07, CAL-01..03, CAL-05, ORG-01

**Depends on:** M0 complete.

## Global Constraints

- Every tenant table: `org_id` first column after `id`, RLS enabled + forced, `org_isolation` policy, FK to `organization` in SQL, **no** Prisma relation to `Organization`.
- Tenant data only through `OrgDb.run`; creates use scalar FKs (unchecked input).
- Money integer kobo; percentages integer bps 0–10000.
- Stay/range dates are `YYYY-MM-DD`, half-open `[start, end)`.
- Every route has `@Permission(...)`; reads `inventory.read`/`calendar.read`, writes `inventory.write`; owners `owners.read|write`.
- Every new `:param` route registers an isolation fixture in `apps/api/test/helpers/routes.ts`.
- Nigerian bank account numbers (NUBAN) are exactly 10 digits.

## Review Focus

1. **Ownership change on the same day it was last changed** — must replace that period, not create a zero-length one (T-M1-04 test `same-day change replaces the period`).
2. **Changing a property's default owner** must move only units that follow the property, from the effective date, and leave units with their own owner alone (T-M1-04 test `property default change skips overridden units`).
3. **Overlapping manual blocks** on the same unit → 409 `DATES_UNAVAILABLE`; adjacent blocks (end = start) allowed (T-M1-05 tests).
4. **Calendar range abuse** — `to` before `from`, or more than 62 days → 400 (T-M1-05 test `rejects invalid ranges`).
5. **Archived unit/property** must disappear from the calendar but keep its history (T-M1-05 test `archived units are hidden`).

## Parallel split

| Task | Track | Suggested agent | Depends on |
|---|---|---|---|
| T-M1-01 Contracts + domain helpers | domain | Claude Code | M0 |
| T-M1-02 Schema + migration | schema | Claude Code | T-M1-01 |
| T-M1-03 Files service + logo | api | Claude Code | T-M1-02 |
| T-M1-04 Owners, properties, units, ownership, fee config API | api | Claude Code | T-M1-02 |
| T-M1-05 Unit fees, blocks, calendar API | api | Claude Code | T-M1-04 |
| T-M1-06 Inventory settings UI | ui | OpenCode | T-M1-01 (stub), merges after T-M1-04 |
| T-M1-07 Calendar UI | ui | OpenCode | T-M1-01 (stub), merges after T-M1-05 |
| T-M1-08 Logo upload UI + Tanuhomes seed script | ui/infra | OpenCode | T-M1-03, T-M1-06 |

---

### Task 1 (T-M1-01) [domain]: Inventory and calendar contracts, ownership and fee helpers

**Files:**
- Create: `packages/shared/src/contracts/common.ts`, `packages/shared/src/contracts/inventory.ts`, `packages/shared/src/contracts/calendar.ts`, `packages/shared/src/contracts/files.ts`
- Create: `packages/shared/src/domain/ownership.ts`, `packages/shared/src/domain/fees.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/contracts/org.ts` (add `logoFileId`), `packages/shared/src/contracts/platform.ts` (move `E164` to common and re-export)
- Test: `packages/shared/src/domain/ownership.test.ts`, `packages/shared/src/domain/fees.test.ts`, `packages/shared/src/contracts/inventory.test.ts`

**Interfaces (produced — all later M1+ tasks use these exact names):**
```ts
// common.ts
export const IsoDateSchema: z.ZodString            // refine(isIsoDate)
export const Kobo: z.ZodNumber                     // int, >= 0, <= MAX_SAFE_INTEGER
export const Bps: z.ZodNumber                      // int 0..10000
export const E164: z.ZodString
export const Page = <T>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() })
// inventory.ts
FeeType = 'pct_gross'|'pct_net'|'none'; FeeConfig { feeType; feeBps; feeFixedMonthlyKobo }
OwnerInput, Owner { id; …OwnerInput; userId: string|null; portalStatus: 'none'|'invited'|'active'; active: boolean }
PropertyInput, Property { id; …; active; unitCount }
UnitInput, Unit { id; …; active; ownerFollowsProperty; currentOwner: { id; name } | null; currentOwnerSource: 'unit'|'property'|'operator' }
SetUnitOwnerInput = { mode: 'property' } | { mode: 'owner'; ownerId: string } | { mode: 'operator' }  & { effectiveFrom: IsoDate }
SetPropertyOwnerInput { defaultOwnerId: string | null; effectiveFrom: IsoDate }
UnitFeeKind = 'caution_deposit'|'cleaning'|'extra_guest'|'other'; FeeBasis = 'per_stay'|'per_night'|'per_guest_night'
UnitFeeInput, UnitFee { id; unitId; …; refundable }
BlockReason = 'maintenance'|'owner_stay'|'other'; BlockInput, Block
// calendar.ts
CalendarQuery { from; to }; CalendarUnit; CalendarProperty; CalendarItem (discriminated 'booking'|'block'); CalendarResponse
// files.ts
FileKind = 'logo'|'receipt_image'|'task_photo'|'statement_pdf'|'receipt_pdf'; FILE_LIMITS; PresignInput; PresignResponse { fileId; uploadUrl; headers }; FileUrlResponse { url; expiresAt }
// domain/ownership.ts
interface OwnershipPeriod { ownerId: string | null; from: IsoDate; to: IsoDate | null }
ownerOn(periods: OwnershipPeriod[], date: IsoDate): { found: boolean; ownerId: string | null }
planOwnerChange(periods: OwnershipPeriod[], ownerId: string | null, effectiveFrom: IsoDate): OwnershipPlan
type OwnershipPlan = { kind: 'noop' } | { kind: 'replace'; from: IsoDate } | { kind: 'split'; closeFrom: IsoDate; insertFrom: IsoDate } | { kind: 'insert'; insertFrom: IsoDate }
// domain/fees.ts
effectiveFeeConfig(property: FeeConfig, unit: FeeConfig & { feeOverride: boolean }): FeeConfig
```

- [ ] **Step 1: Write failing tests**

`packages/shared/src/domain/ownership.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ownerOn, planOwnerChange, type OwnershipPeriod } from './ownership';

const P = (ownerId: string | null, from: string, to: string | null = null): OwnershipPeriod => ({ ownerId, from, to });

describe('ownerOn', () => {
  const periods = [P('o1', '2026-01-01', '2026-06-01'), P('o2', '2026-06-01')];
  it('finds the owner covering a date (half-open)', () => {
    expect(ownerOn(periods, '2026-05-31')).toEqual({ found: true, ownerId: 'o1' });
    expect(ownerOn(periods, '2026-06-01')).toEqual({ found: true, ownerId: 'o2' });
  });
  it('reports not found before the first period', () => {
    expect(ownerOn(periods, '2025-12-31')).toEqual({ found: false, ownerId: null });
  });
  it('operator-owned is ownerId null but found', () => {
    expect(ownerOn([P(null, '2026-01-01')], '2026-03-01')).toEqual({ found: true, ownerId: null });
  });
});

describe('planOwnerChange', () => {
  it('first assignment inserts', () => {
    expect(planOwnerChange([], 'o1', '2026-10-10')).toEqual({ kind: 'insert', insertFrom: '2026-10-10' });
  });
  it('same owner is a noop', () => {
    expect(planOwnerChange([P('o1', '2026-01-01')], 'o1', '2026-10-10')).toEqual({ kind: 'noop' });
  });
  it('same-day change replaces the period', () => {
    expect(planOwnerChange([P('o1', '2026-10-10')], 'o2', '2026-10-10')).toEqual({ kind: 'replace', from: '2026-10-10' });
  });
  it('later change splits the open period', () => {
    expect(planOwnerChange([P('o1', '2026-01-01')], 'o2', '2026-10-10')).toEqual({ kind: 'split', closeFrom: '2026-01-01', insertFrom: '2026-10-10' });
  });
  it('refuses backdating before the current period start', () => {
    expect(() => planOwnerChange([P('o1', '2026-10-10')], 'o2', '2026-10-01')).toThrow('Ownership can only change on or after 2026-10-10');
  });
});
```
`packages/shared/src/domain/fees.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { effectiveFeeConfig } from './fees';

const prop = { feeType: 'pct_gross' as const, feeBps: 2000, feeFixedMonthlyKobo: 0 };
describe('effectiveFeeConfig', () => {
  it('uses the property config unless the unit overrides', () => {
    expect(effectiveFeeConfig(prop, { feeOverride: false, feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 0 })).toEqual(prop);
    expect(effectiveFeeConfig(prop, { feeOverride: true, feeType: 'pct_net', feeBps: 1500, feeFixedMonthlyKobo: 5_000_000 }))
      .toEqual({ feeType: 'pct_net', feeBps: 1500, feeFixedMonthlyKobo: 5_000_000 });
  });
});
```
`packages/shared/src/contracts/inventory.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { BlockInput, OwnerInput, UnitFeeInput, UnitInput } from './inventory';

describe('inventory contracts', () => {
  it('owner account number must be a 10-digit NUBAN', () => {
    expect(OwnerInput.safeParse({ name: 'Mrs A', accountNumber: '0123456789' }).success).toBe(true);
    expect(OwnerInput.safeParse({ name: 'Mrs A', accountNumber: '12345' }).success).toBe(false);
  });
  it('unit rate must be positive kobo', () => {
    const base = { propertyId: 'p', name: 'Kairo', bedrooms: 2, maxGuests: 4, nightlyRateKobo: 20_000_000, feeOverride: false, feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 0, defaultAssigneeMemberId: null };
    expect(UnitInput.safeParse(base).success).toBe(true);
    expect(UnitInput.safeParse({ ...base, nightlyRateKobo: 0 }).success).toBe(false);
    expect(UnitInput.safeParse({ ...base, nightlyRateKobo: 1.5 }).success).toBe(false);
  });
  it('extra_guest fee needs includedGuests and per_guest_night; only caution deposit is refundable', () => {
    expect(UnitFeeInput.safeParse({ kind: 'extra_guest', label: 'Extra guest', amountKobo: 1_000_000, basis: 'per_guest_night' }).success).toBe(false);
    expect(UnitFeeInput.safeParse({ kind: 'extra_guest', label: 'Extra guest', amountKobo: 1_000_000, basis: 'per_guest_night', includedGuests: 2 }).success).toBe(true);
    expect(UnitFeeInput.safeParse({ kind: 'caution_deposit', label: 'Caution', amountKobo: 5_000_000, basis: 'per_night' }).success).toBe(false);
  });
  it('block end must be after start', () => {
    expect(BlockInput.safeParse({ unitId: 'u', start: '2026-10-10', end: '2026-10-10', reason: 'maintenance' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @boogbe/shared test`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`packages/shared/src/contracts/common.ts`:
```ts
import { z } from 'zod';
import { isIsoDate } from '../domain/dates';

export const IsoDateSchema = z.string().refine(isIsoDate, 'Use YYYY-MM-DD');
export const Kobo = z.number().int('Must be whole kobo').min(0).max(Number.MAX_SAFE_INTEGER);
export const Bps = z.number().int().min(0).max(10_000);
export const E164 = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +2348012345678');
export const Page = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() });
export const CursorQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
```
In `platform.ts` replace the local `E164` definition with `import { E164 } from './common'; export { E164 };`.

`packages/shared/src/contracts/inventory.ts`:
```ts
import { z } from 'zod';
import { Bps, E164, IsoDateSchema, Kobo } from './common';

export const FeeType = z.enum(['pct_gross', 'pct_net', 'none']);
export const FeeConfig = z.object({ feeType: FeeType, feeBps: Bps, feeFixedMonthlyKobo: Kobo });
export type FeeConfig = z.infer<typeof FeeConfig>;

const opt = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();

export const OwnerInput = z.object({
  name: z.string().trim().min(2).max(120),
  phone: opt(E164),
  email: opt(z.string().email()),
  bankName: opt(z.string().max(80)),
  accountNumber: opt(z.string().regex(/^\d{10}$/, 'Account number must be 10 digits')),
  accountName: opt(z.string().max(120)),
  notes: opt(z.string().max(2000)),
});
export type OwnerInput = z.infer<typeof OwnerInput>;
export const Owner = OwnerInput.extend({
  id: z.string(), userId: z.string().nullable(), portalStatus: z.enum(['none', 'invited', 'active']), active: z.boolean(),
});
export type Owner = z.infer<typeof Owner>;

export const PropertyInput = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(3).max(300),
  area: opt(z.string().max(120)),
  notes: opt(z.string().max(2000)),
  sortOrder: z.number().int().min(0).default(0),
}).merge(FeeConfig);
export type PropertyInput = z.infer<typeof PropertyInput>;
export const Property = PropertyInput.extend({
  id: z.string(), active: z.boolean(), unitCount: z.number().int(), defaultOwnerId: z.string().nullable(), defaultOwnerName: z.string().nullable(),
});
export type Property = z.infer<typeof Property>;
export const SetPropertyOwnerInput = z.object({ defaultOwnerId: z.string().nullable(), effectiveFrom: IsoDateSchema });
export type SetPropertyOwnerInput = z.infer<typeof SetPropertyOwnerInput>;

export const UnitInput = z.object({
  propertyId: z.string(),
  name: z.string().trim().min(1).max(80),
  bedrooms: z.number().int().min(0).max(20),
  maxGuests: z.number().int().min(1).max(50),
  nightlyRateKobo: Kobo.refine((v) => v > 0, 'Rate must be more than ₦0'),
  defaultAssigneeMemberId: z.string().nullable(),
  checkInInstructions: opt(z.string().max(5000)),
  feeOverride: z.boolean(),
  sortOrder: z.number().int().min(0).default(0),
}).merge(FeeConfig);
export type UnitInput = z.infer<typeof UnitInput>;
export const Unit = UnitInput.extend({
  id: z.string(), active: z.boolean(), ownerFollowsProperty: z.boolean(),
  currentOwner: z.object({ id: z.string(), name: z.string() }).nullable(),
  currentOwnerSource: z.enum(['unit', 'property', 'operator']),
});
export type Unit = z.infer<typeof Unit>;
export const SetUnitOwnerInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('property'), effectiveFrom: IsoDateSchema }),
  z.object({ mode: z.literal('owner'), ownerId: z.string(), effectiveFrom: IsoDateSchema }),
  z.object({ mode: z.literal('operator'), effectiveFrom: IsoDateSchema }),
]);
export type SetUnitOwnerInput = z.infer<typeof SetUnitOwnerInput>;

export const UnitFeeKind = z.enum(['caution_deposit', 'cleaning', 'extra_guest', 'other']);
export const FeeBasis = z.enum(['per_stay', 'per_night', 'per_guest_night']);
export const UnitFeeInput = z.object({
  kind: UnitFeeKind,
  label: z.string().trim().min(2).max(60),
  amountKobo: Kobo.refine((v) => v > 0, 'Amount must be more than ₦0'),
  basis: FeeBasis,
  includedGuests: z.number().int().min(0).max(50).optional(),
  active: z.boolean().default(true),
}).superRefine((f, ctx) => {
  if (f.kind === 'extra_guest' && (f.basis !== 'per_guest_night' || f.includedGuests === undefined))
    ctx.addIssue({ code: 'custom', path: ['includedGuests'], message: 'Extra-guest fees are per guest per night and need the number of included guests' });
  if (f.kind === 'caution_deposit' && f.basis !== 'per_stay')
    ctx.addIssue({ code: 'custom', path: ['basis'], message: 'Caution deposits are charged once per stay' });
});
export type UnitFeeInput = z.infer<typeof UnitFeeInput>;
export const UnitFee = z.object({
  id: z.string(), unitId: z.string(), kind: UnitFeeKind, label: z.string(), amountKobo: Kobo, basis: FeeBasis,
  includedGuests: z.number().int().nullable(), refundable: z.boolean(), active: z.boolean(),
});
export type UnitFee = z.infer<typeof UnitFee>;

export const BlockReason = z.enum(['maintenance', 'owner_stay', 'other']);
export const BlockInput = z.object({
  unitId: z.string(), start: IsoDateSchema, end: IsoDateSchema, reason: BlockReason, note: opt(z.string().max(500)),
}).refine((b) => b.end > b.start, { path: ['end'], message: 'End must be after start' });
export type BlockInput = z.infer<typeof BlockInput>;
export const Block = z.object({
  id: z.string(), unitId: z.string(), start: z.string(), end: z.string(),
  source: z.enum(['manual', 'ical']), reason: z.enum(['maintenance', 'owner_stay', 'other', 'external']),
  note: z.string().nullable(), feedId: z.string().nullable(), externalSummary: z.string().nullable(),
});
export type Block = z.infer<typeof Block>;
```

`packages/shared/src/contracts/calendar.ts`:
```ts
import { z } from 'zod';
import { IsoDateSchema } from './common';
import { addDays } from '../domain/dates';

export const CalendarQuery = z.object({ from: IsoDateSchema, to: IsoDateSchema })
  .refine((q) => q.to > q.from, { path: ['to'], message: 'to must be after from' })
  .refine((q) => q.to <= addDays(q.from, 62), { path: ['to'], message: 'At most 62 days' });
export type CalendarQuery = z.infer<typeof CalendarQuery>;

export const CalendarUnit = z.object({ id: z.string(), name: z.string(), bedrooms: z.number().int(), maxGuests: z.number().int(), nightlyRateKobo: z.number().int() });
export const CalendarProperty = z.object({ id: z.string(), name: z.string(), units: z.array(CalendarUnit) });
export const BookingStatus = z.enum(['tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show']);
export type BookingStatus = z.infer<typeof BookingStatus>;
export const CalendarItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('booking'), id: z.string(), unitId: z.string(), start: z.string(), end: z.string(), status: BookingStatus, ref: z.string(), guestName: z.string().nullable(), balanceKobo: z.number().int().nullable(), hasConflict: z.boolean() }),
  z.object({ kind: z.literal('block'), id: z.string(), unitId: z.string(), start: z.string(), end: z.string(), source: z.enum(['manual', 'ical']), reason: z.string(), label: z.string() }),
]);
export type CalendarItem = z.infer<typeof CalendarItem>;
export const CalendarResponse = z.object({ from: z.string(), to: z.string(), today: z.string(), properties: z.array(CalendarProperty), items: z.array(CalendarItem) });
export type CalendarResponse = z.infer<typeof CalendarResponse>;
```

`packages/shared/src/contracts/files.ts`:
```ts
import { z } from 'zod';
export const FileKind = z.enum(['logo', 'receipt_image', 'task_photo', 'statement_pdf', 'receipt_pdf']);
export type FileKind = z.infer<typeof FileKind>;
export const FILE_LIMITS: Record<FileKind, { maxBytes: number; types: readonly string[]; uploadable: boolean }> = {
  logo: { maxBytes: 2 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'], uploadable: true },
  receipt_image: { maxBytes: 8 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'], uploadable: true },
  task_photo: { maxBytes: 1024 * 1024, types: ['image/jpeg', 'image/webp'], uploadable: true },
  statement_pdf: { maxBytes: 10 * 1024 * 1024, types: ['application/pdf'], uploadable: false },
  receipt_pdf: { maxBytes: 2 * 1024 * 1024, types: ['application/pdf'], uploadable: false },
};
export const PresignInput = z.object({ kind: FileKind, contentType: z.string(), sizeBytes: z.number().int().positive() })
  .superRefine((p, ctx) => {
    const lim = FILE_LIMITS[p.kind];
    if (!lim.uploadable) ctx.addIssue({ code: 'custom', path: ['kind'], message: 'This file type is generated by Boogbe' });
    if (!lim.types.includes(p.contentType)) ctx.addIssue({ code: 'custom', path: ['contentType'], message: `Allowed: ${lim.types.join(', ')}` });
    if (p.sizeBytes > lim.maxBytes) ctx.addIssue({ code: 'custom', path: ['sizeBytes'], message: `Max ${Math.round(lim.maxBytes / 1024)} KB` });
  });
export type PresignInput = z.infer<typeof PresignInput>;
export const PresignResponse = z.object({ fileId: z.string(), uploadUrl: z.string().url(), headers: z.record(z.string(), z.string()) });
export type PresignResponse = z.infer<typeof PresignResponse>;
export const FileUrlResponse = z.object({ url: z.string().url(), expiresAt: z.string() });
export type FileUrlResponse = z.infer<typeof FileUrlResponse>;
```

`packages/shared/src/domain/ownership.ts`:
```ts
import type { IsoDate } from './dates';
export interface OwnershipPeriod { ownerId: string | null; from: IsoDate; to: IsoDate | null }
export type OwnershipPlan =
  | { kind: 'noop' }
  | { kind: 'replace'; from: IsoDate }
  | { kind: 'split'; closeFrom: IsoDate; insertFrom: IsoDate }
  | { kind: 'insert'; insertFrom: IsoDate };

export function ownerOn(periods: OwnershipPeriod[], date: IsoDate) {
  const p = periods.find((x) => x.from <= date && (x.to === null || date < x.to));
  return p ? { found: true, ownerId: p.ownerId } : { found: false, ownerId: null };
}

/** periods: all periods for one unit. Only the open (to === null) period can change. */
export function planOwnerChange(periods: OwnershipPeriod[], ownerId: string | null, effectiveFrom: IsoDate): OwnershipPlan {
  const open = periods.find((p) => p.to === null);
  if (!open) return { kind: 'insert', insertFrom: effectiveFrom };
  if (open.ownerId === ownerId) return { kind: 'noop' };
  if (effectiveFrom < open.from) throw new Error(`Ownership can only change on or after ${open.from}`);
  if (effectiveFrom === open.from) return { kind: 'replace', from: open.from };
  return { kind: 'split', closeFrom: open.from, insertFrom: effectiveFrom };
}
```
`packages/shared/src/domain/fees.ts`:
```ts
import type { FeeConfig } from '../contracts/inventory';
export function effectiveFeeConfig(property: FeeConfig, unit: FeeConfig & { feeOverride: boolean }): FeeConfig {
  return unit.feeOverride ? { feeType: unit.feeType, feeBps: unit.feeBps, feeFixedMonthlyKobo: unit.feeFixedMonthlyKobo } : { ...property };
}
```
`org.ts` — add to `UpdateOrgSettingsInput`: `logoFileId: z.string().nullable().optional(),` and to `OrgSettingsResponse.settings`: `logoUrl: z.string().url().nullable()`.

`packages/shared/src/index.ts` — add:
```ts
export * from './contracts/common';
export * from './contracts/inventory';
export * from './contracts/calendar';
export * from './contracts/files';
export * from './domain/ownership';
export * from './domain/fees';
```
Remove the duplicate `E164` export collision by exporting `platform.ts` without `E164` (it re-exports from common; keep a single `export * from './contracts/common'` and in `platform.ts` use `import { E164 } from './common'` without re-exporting).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @boogbe/shared test && pnpm typecheck`
Expected: PASS. (`apps/api` OrgService must now return `logoUrl: null` until T-M1-03 — add `logoUrl: null` in `OrgService.get` so typecheck passes.)

- [ ] **Step 5: Commit**
```bash
git add packages/shared apps/api/src/modules/org
git commit -m "feat(shared): inventory, calendar and file contracts; ownership and fee helpers [INV-01..07 CAL-01]"
```

---

### Task 2 (T-M1-02) [schema]: Inventory tables, RLS, exclusion constraints

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0003_inventory/migration.sql`
- Modify: `docs/DATA_MODEL.md` (add `unit.owner_follows_property`)
- Test: `apps/api/test/rls.int.ts` (coverage test now includes new tables — no edit needed), `apps/api/test/inventory-schema.int.ts`

**Interfaces:** Prisma models `Owner`, `Property`, `Unit`, `UnitOwnership`, `UnitFee`, `Block`, `File` with the fields below (camelCase in Prisma, snake_case columns).

- [ ] **Step 1: Schema**

Append to `prisma/schema.prisma`:
```prisma
model Owner {
  id            String   @id
  orgId         String   @map("org_id")
  name          String
  phone         String?
  email         String?
  bankName      String?  @map("bank_name")
  accountNumber String?  @map("account_number")
  accountName   String?  @map("account_name")
  notes         String?
  userId        String?  @map("user_id")
  active        Boolean  @default(true)
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@index([orgId, name])
  @@map("owner")
}

model Property {
  id                 String   @id
  orgId              String   @map("org_id")
  name               String
  address            String
  area               String?
  defaultOwnerId     String?  @map("default_owner_id")
  feeType            String   @default("none") @map("fee_type")
  feeBps             Int      @default(0) @map("fee_bps")
  feeFixedMonthlyKobo BigInt  @default(0) @map("fee_fixed_monthly_kobo")
  notes              String?
  active             Boolean  @default(true)
  sortOrder          Int      @default(0) @map("sort_order")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")
  units              Unit[]

  @@index([orgId, sortOrder])
  @@map("property")
}

model Unit {
  id                      String          @id
  orgId                   String          @map("org_id")
  propertyId              String          @map("property_id")
  property                Property        @relation(fields: [propertyId], references: [id])
  name                    String
  bedrooms                Int
  maxGuests               Int             @map("max_guests")
  nightlyRateKobo         BigInt          @map("nightly_rate_kobo")
  defaultAssigneeMemberId String?         @map("default_assignee_member_id")
  checkInInstructions     String?         @map("check_in_instructions")
  ownerFollowsProperty    Boolean         @default(true) @map("owner_follows_property")
  feeOverride             Boolean         @default(false) @map("fee_override")
  feeType                 String          @default("none") @map("fee_type")
  feeBps                  Int             @default(0) @map("fee_bps")
  feeFixedMonthlyKobo     BigInt          @default(0) @map("fee_fixed_monthly_kobo")
  active                  Boolean         @default(true)
  sortOrder               Int             @default(0) @map("sort_order")
  createdAt               DateTime        @default(now()) @map("created_at")
  updatedAt               DateTime        @updatedAt @map("updated_at")
  ownerships              UnitOwnership[]
  fees                    UnitFee[]
  blocks                  Block[]

  @@unique([orgId, propertyId, name])
  @@map("unit")
}

model UnitOwnership {
  id            String    @id
  orgId         String    @map("org_id")
  unitId        String    @map("unit_id")
  unit          Unit      @relation(fields: [unitId], references: [id])
  ownerId       String?   @map("owner_id")
  effectiveFrom DateTime  @db.Date @map("effective_from")
  effectiveTo   DateTime? @db.Date @map("effective_to")
  createdAt     DateTime  @default(now()) @map("created_at")

  @@index([orgId, unitId])
  @@map("unit_ownership")
}

model UnitFee {
  id             String   @id
  orgId          String   @map("org_id")
  unitId         String   @map("unit_id")
  unit           Unit     @relation(fields: [unitId], references: [id])
  kind           String
  label          String
  amountKobo     BigInt   @map("amount_kobo")
  basis          String
  includedGuests Int?     @map("included_guests")
  refundable     Boolean  @default(false)
  active         Boolean  @default(true)
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@index([orgId, unitId])
  @@map("unit_fee")
}

model Block {
  id              String   @id
  orgId           String   @map("org_id")
  unitId          String   @map("unit_id")
  unit            Unit     @relation(fields: [unitId], references: [id])
  start           DateTime @db.Date
  end             DateTime @db.Date
  source          String
  reason          String
  note            String?
  feedId          String?  @map("feed_id")
  externalUid     String?  @map("external_uid")
  externalSummary String?  @map("external_summary")
  createdByMemberId String? @map("created_by_member_id")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([orgId, unitId, start])
  @@map("block")
}

model File {
  id                 String   @id
  orgId              String   @map("org_id")
  key                String   @unique
  kind               String
  contentType        String   @map("content_type")
  sizeBytes          Int      @map("size_bytes")
  uploadedByMemberId String?  @map("uploaded_by_member_id")
  confirmed          Boolean  @default(false)
  createdAt          DateTime @default(now()) @map("created_at")

  @@index([orgId, kind])
  @@map("file")
}
```
Note: relations between tenant models (e.g. `Unit.property`) are allowed; only relations to `Organization` are forbidden. Creates must still use scalar FKs (`propertyId`), never `connect`.

- [ ] **Step 2: Migration SQL**

Run: `pnpm db:migrate -- --name inventory --create-only`, rename folder to `0003_inventory`, append:
```sql
-- FKs to organization
ALTER TABLE owner          ADD CONSTRAINT owner_org_fk          FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE property       ADD CONSTRAINT property_org_fk       FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE unit           ADD CONSTRAINT unit_org_fk           FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE unit_ownership ADD CONSTRAINT unit_ownership_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE unit_fee       ADD CONSTRAINT unit_fee_org_fk       FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE block          ADD CONSTRAINT block_org_fk          FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE file           ADD CONSTRAINT file_org_fk           FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE property       ADD CONSTRAINT property_default_owner_fk FOREIGN KEY (default_owner_id) REFERENCES owner(id);
ALTER TABLE unit_ownership ADD CONSTRAINT unit_ownership_owner_fk   FOREIGN KEY (owner_id) REFERENCES owner(id);

-- Domain checks
ALTER TABLE property ADD CONSTRAINT property_fee_type_chk CHECK (fee_type IN ('pct_gross','pct_net','none'));
ALTER TABLE property ADD CONSTRAINT property_fee_bps_chk  CHECK (fee_bps BETWEEN 0 AND 10000);
ALTER TABLE unit     ADD CONSTRAINT unit_fee_type_chk     CHECK (fee_type IN ('pct_gross','pct_net','none'));
ALTER TABLE unit     ADD CONSTRAINT unit_fee_bps_chk      CHECK (fee_bps BETWEEN 0 AND 10000);
ALTER TABLE unit     ADD CONSTRAINT unit_rate_chk         CHECK (nightly_rate_kobo > 0);
ALTER TABLE unit_fee ADD CONSTRAINT unit_fee_kind_chk     CHECK (kind IN ('caution_deposit','cleaning','extra_guest','other'));
ALTER TABLE unit_fee ADD CONSTRAINT unit_fee_basis_chk    CHECK (basis IN ('per_stay','per_night','per_guest_night'));
ALTER TABLE block    ADD CONSTRAINT block_range_chk       CHECK ("end" > start);
ALTER TABLE block    ADD CONSTRAINT block_source_chk      CHECK (source IN ('manual','ical'));
ALTER TABLE unit_ownership ADD CONSTRAINT unit_ownership_range_chk CHECK (effective_to IS NULL OR effective_to > effective_from);

-- No overlapping ownership periods per unit; no overlapping manual blocks per unit.
ALTER TABLE unit_ownership ADD CONSTRAINT unit_ownership_no_overlap
  EXCLUDE USING gist (unit_id WITH =, daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&);
ALTER TABLE block ADD CONSTRAINT block_manual_no_overlap
  EXCLUDE USING gist (unit_id WITH =, daterange(start, "end", '[)') WITH &&) WHERE (source = 'manual');
CREATE UNIQUE INDEX block_ical_uid ON block (feed_id, external_uid) WHERE source = 'ical';

-- RLS
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['owner','property','unit','unit_ownership','unit_fee','block','file'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;
```

- [ ] **Step 3: Write failing schema test**

`apps/api/test/inventory-schema.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';
import { OrgDb } from '../src/common/db/org-db.service';
import { newId } from '../src/common/db/ids';

describe('inventory schema constraints', () => {
  let t: TestApp; let db: OrgDb; let org: { id: string };
  beforeAll(async () => { t = await createTestApp(); db = t.app.get(OrgDb); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await truncateAll(); org = await seedOrg(); });

  async function unit() {
    return db.run(org.id, async (tx) => {
      const p = await tx.property.create({ data: { id: newId(), name: 'Rock', address: 'Lekki' } as never });
      return tx.unit.create({ data: { id: newId(), propertyId: p.id, name: 'Kairo', bedrooms: 2, maxGuests: 4, nightlyRateKobo: 20_000_000n } as never });
    });
  }

  it('rejects overlapping manual blocks but allows adjacent ones', async () => {
    const u = await unit();
    const mk = (s: string, e: string) => db.run(org.id, (tx) => tx.block.create({ data: { id: newId(), unitId: u.id, start: new Date(s), end: new Date(e), source: 'manual', reason: 'maintenance' } as never }));
    await mk('2026-10-10', '2026-10-12');
    await mk('2026-10-12', '2026-10-13');
    await expect(mk('2026-10-11', '2026-10-14')).rejects.toThrow(/block_manual_no_overlap|23P01|exclusion/);
  });

  it('rejects overlapping ownership periods', async () => {
    const u = await unit();
    const mk = (f: string, to: string | null) => db.run(org.id, (tx) => tx.unitOwnership.create({ data: { id: newId(), unitId: u.id, ownerId: null, effectiveFrom: new Date(f), effectiveTo: to ? new Date(to) : null } as never }));
    await mk('2026-01-01', '2026-06-01');
    await mk('2026-06-01', null);
    await expect(mk('2026-07-01', null)).rejects.toThrow();
  });

  it('rejects a zero rate', async () => {
    await expect(db.run(org.id, async (tx) => {
      const p = await tx.property.create({ data: { id: newId(), name: 'P', address: 'A' } as never });
      return tx.unit.create({ data: { id: newId(), propertyId: p.id, name: 'U', bedrooms: 1, maxGuests: 2, nightlyRateKobo: 0n } as never });
    })).rejects.toThrow(/unit_rate_chk/);
  });
});
```

- [ ] **Step 4: Apply and run**

Run: `pnpm db:reset && pnpm --filter @boogbe/api prisma:generate && pnpm test:int`
Expected: PASS (including RLS coverage over 10 tenant tables).

- [ ] **Step 5: Update docs and commit**

In `docs/DATA_MODEL.md` under `unit`, add `owner_follows_property (bool, default true)`.
```bash
git add prisma apps/api/test docs/DATA_MODEL.md
git commit -m "feat(db): inventory tables with RLS, ownership and block exclusion constraints [INV-01..07]"
```

---

### Task 3 (T-M1-03) [api]: Files service (R2 presigned uploads) and operator logo

**Files:**
- Create: `apps/api/src/common/files/storage.ts`, `apps/api/src/common/files/files.module.ts`, `apps/api/src/common/files/files.service.ts`
- Create: `apps/api/src/modules/files/files.controller.ts`, `apps/api/src/modules/files/files-http.module.ts`
- Modify: `apps/api/src/env.ts` (R2 vars), `apps/api/src/modules/org/org.service.ts` (logo), `apps/api/src/app.module.ts`, `apps/api/src/worker.module.ts` (FilesModule), `.env.example`
- Modify: `apps/api/test/helpers/routes.ts` (fixture `file`)
- Test: `apps/api/test/files.int.ts`

**Interfaces:**
- `interface Storage { presignPut(key: string, contentType: string, sizeBytes: number): Promise<{ url: string; headers: Record<string,string> }>; presignGet(key: string, filename?: string): Promise<string>; head(key: string): Promise<{ size: number } | null>; put(key: string, body: Buffer, contentType: string): Promise<void> }`; token `STORAGE`; `R2Storage` (S3 client) and `MemoryStorage` (tests: `objects: Map<string, { body: Buffer; contentType: string }>`, URLs `memory://<key>`).
- `FilesService.presign(ctx: OrgCtx, input: PresignInput): Promise<PresignResponse>`; `confirm(ctx, fileId): Promise<void>` (HEAD must exist and size ≤ limit, else 400); `urlFor(orgId: string, fileId: string, filename?: string): Promise<FileUrlResponse>`; `storeGenerated(orgId: string, kind: 'statement_pdf'|'receipt_pdf', body: Buffer, actorMemberId: string|null): Promise<{ fileId: string; key: string }>` (used in M3, M7); `assertConfirmed(tx, fileId, kind): Promise<File>`.
- Endpoints: `POST /v1/files/presign` (`@Permission('inventory.read')` — any staff role; housekeepers use `tasks.write_own`: the controller checks kind→permission map: `logo`→`org.settings.write`, `receipt_image`→`expenses.write` or `payments.write`, `task_photo`→`tasks.write_own` or `tasks.write`), `POST /v1/files/:id/confirm`, `GET /v1/files/:id/url`. Because the permission depends on the body, these routes use `@SignedIn()` and call `FilesService.assertCanUpload(ctx, kind)` / `assertCanRead(ctx, kind)` which require an active org.
- Env: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (all optional; when absent and `NODE_ENV !== 'production'`, `MemoryStorage` is used; in production they are required — `loadEnv` refines).
- Keys: `org/<orgId>/<kind>/<uuidv7>.<ext>` where ext from content type (`png|jpg|webp|pdf`).

- [ ] **Step 1: Write failing tests**

`apps/api/test/files.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { STORAGE } from '../src/common/files/storage';
import type { MemoryStorage } from '../src/common/files/storage';

describe('files [ORG-01]', () => {
  let t: TestApp; let storage: MemoryStorage;
  beforeAll(async () => { t = await createTestApp(); storage = t.app.get(STORAGE); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await truncateAll(); storage.objects.clear(); });

  it('admin uploads a logo and it appears in settings', async () => {
    const org = await seedOrg(); const { agent } = await signInAs(t, 'admin', org.id);
    await agent.post('/v1/files/presign').send({ kind: 'logo', contentType: 'image/png', sizeBytes: 1000 }).expect(400); // org_settings row missing? no — see note
  });
});
```
Replace the test body above with the real flow (the stub line exists only to show the endpoint; delete it):
```ts
  it('admin uploads a logo and it appears in settings', async () => {
    const org = await seedOrg(); const { agent } = await signInAs(t, 'admin', org.id);
    await agent.post('/v1/org/settings/init').expect(404); // no such route; settings rows are created by PlatformService — use helper below
  });
```
**Use this final version** (the two snippets above are not part of the file):
```ts
import { migratorClient } from './helpers/db';

async function seedSettings(orgId: string) {
  const m = await migratorClient();
  await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'TAN','TAN','TAN',now())`, [orgId]);
  await m.end();
}

describe('files [ORG-01]', () => {
  let t: TestApp; let storage: MemoryStorage;
  beforeAll(async () => { t = await createTestApp(); storage = t.app.get(STORAGE); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await truncateAll(); storage.objects.clear(); });

  it('admin uploads a logo and settings return a signed url', async () => {
    const org = await seedOrg(); await seedSettings(org.id);
    const { agent } = await signInAs(t, 'admin', org.id);
    const p = await agent.post('/v1/files/presign').send({ kind: 'logo', contentType: 'image/png', sizeBytes: 1000 }).expect(201);
    expect(p.body.uploadUrl).toMatch(/^memory:\/\/org\//);
    await agent.post(`/v1/files/${p.body.fileId}/confirm`).expect(400); // not uploaded yet
    storage.objects.set(p.body.uploadUrl.replace('memory://', ''), { body: Buffer.alloc(1000), contentType: 'image/png' });
    await agent.post(`/v1/files/${p.body.fileId}/confirm`).expect(200);
    await agent.patch('/v1/org/settings').send({ logoFileId: p.body.fileId }).expect(200);
    const s = await agent.get('/v1/org/settings').expect(200);
    expect(s.body.settings.logoUrl).toMatch(/^memory:\/\/get\/org\//);
  });

  it('rejects wrong types, oversize files and generated kinds', async () => {
    const org = await seedOrg(); await seedSettings(org.id);
    const { agent } = await signInAs(t, 'admin', org.id);
    await agent.post('/v1/files/presign').send({ kind: 'logo', contentType: 'image/gif', sizeBytes: 10 }).expect(400);
    await agent.post('/v1/files/presign').send({ kind: 'logo', contentType: 'image/png', sizeBytes: 3 * 1024 * 1024 }).expect(400);
    await agent.post('/v1/files/presign').send({ kind: 'statement_pdf', contentType: 'application/pdf', sizeBytes: 10 }).expect(400);
  });

  it('frontdesk cannot upload a logo; housekeeper can upload task photos', async () => {
    const org = await seedOrg(); await seedSettings(org.id);
    const fd = await signInAs(t, 'frontdesk', org.id);
    await fd.agent.post('/v1/files/presign').send({ kind: 'logo', contentType: 'image/png', sizeBytes: 10 }).expect(403);
    const hk = await signInAs(t, 'housekeeper', org.id);
    await hk.agent.post('/v1/files/presign').send({ kind: 'task_photo', contentType: 'image/jpeg', sizeBytes: 10 }).expect(201);
  });

  it('confirm rejects an object larger than declared limit', async () => {
    const org = await seedOrg(); await seedSettings(org.id);
    const { agent } = await signInAs(t, 'admin', org.id);
    const p = await agent.post('/v1/files/presign').send({ kind: 'logo', contentType: 'image/png', sizeBytes: 1000 }).expect(201);
    storage.objects.set(p.body.uploadUrl.replace('memory://', ''), { body: Buffer.alloc(3 * 1024 * 1024), contentType: 'image/png' });
    await agent.post(`/v1/files/${p.body.fileId}/confirm`).expect(400);
  });
});
```
(Delete the earlier illustrative `describe` block; the file contains only the imports plus this final `describe`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:int -- files`
Expected: FAIL — `STORAGE` not found.

- [ ] **Step 3: Implement**

Add to `apps/api/package.json` dependencies: `"@aws-sdk/client-s3": "^3.670.0"`, `"@aws-sdk/s3-request-presigner": "^3.670.0"`.

`env.ts` — add to schema:
```ts
  R2_ENDPOINT: z.string().url().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
```
and after parsing in `loadEnv`, before return:
```ts
  if (r.data.NODE_ENV === 'production' && !(r.data.R2_ENDPOINT && r.data.R2_BUCKET && r.data.R2_ACCESS_KEY_ID && r.data.R2_SECRET_ACCESS_KEY))
    throw new Error('Invalid environment: R2_* required in production');
```

`apps/api/src/common/files/storage.ts`:
```ts
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const STORAGE = 'BOOGBE_STORAGE';
export interface Storage {
  presignPut(key: string, contentType: string, sizeBytes: number): Promise<{ url: string; headers: Record<string, string> }>;
  presignGet(key: string, filename?: string): Promise<string>;
  head(key: string): Promise<{ size: number } | null>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
}
const TTL = 300;

export class R2Storage implements Storage {
  private readonly s3: S3Client;
  constructor(endpoint: string, private readonly bucket: string, accessKeyId: string, secretAccessKey: string) {
    this.s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });
  }
  async presignPut(key: string, contentType: string, sizeBytes: number) {
    const url = await getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: sizeBytes }), { expiresIn: TTL });
    return { url, headers: { 'content-type': contentType } };
  }
  presignGet(key: string, filename?: string) {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key, ...(filename && { ResponseContentDisposition: `attachment; filename="${filename}"` }) }), { expiresIn: TTL });
  }
  async head(key: string) {
    try { const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); return { size: r.ContentLength ?? 0 }; }
    catch (e) { if ((e as { name?: string }).name === 'NotFound') return null; throw e; }
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
}

export class MemoryStorage implements Storage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  async presignPut(key: string, contentType: string) { return { url: `memory://${key}`, headers: { 'content-type': contentType } }; }
  async presignGet(key: string) { return `memory://get/${key}`; }
  async head(key: string) { const o = this.objects.get(key); return o ? { size: o.body.length } : null; }
  async put(key: string, body: Buffer, contentType: string) { this.objects.set(key, { body, contentType }); }
}
```
`apps/api/src/common/files/files.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { can, FILE_LIMITS, type FileKind, type FileUrlResponse, type Permission, type PresignInput, type PresignResponse } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../db/org-db.service';
import { newId } from '../db/ids';
import { AppError, forbidden, notFound } from '../http/app-error';
import type { OrgCtx } from '../auth/request-ctx';
import { STORAGE, type Storage } from './storage';

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const UPLOAD_PERMS: Record<FileKind, Permission[]> = {
  logo: ['org.settings.write'], receipt_image: ['expenses.write', 'payments.write'], task_photo: ['tasks.write_own', 'tasks.write'],
  statement_pdf: [], receipt_pdf: [],
};
const READ_PERMS: Record<FileKind, Permission[]> = {
  logo: ['notifications.read'], receipt_image: ['expenses.read', 'payments.read'], task_photo: ['tasks.read_own', 'tasks.read'],
  statement_pdf: ['statements.read', 'portal.read'], receipt_pdf: ['payments.read'],
};

@Injectable()
export class FilesService {
  constructor(private readonly orgDb: OrgDb, @Inject(STORAGE) private readonly storage: Storage) {}

  private assert(ctx: OrgCtx, perms: Permission[]) { if (!perms.some((p) => can(ctx.role, p))) throw forbidden(); }

  async presign(ctx: OrgCtx, input: PresignInput): Promise<PresignResponse> {
    this.assert(ctx, UPLOAD_PERMS[input.kind]);
    const id = newId();
    const key = `org/${ctx.orgId}/${input.kind}/${id}.${EXT[input.contentType]}`;
    await this.orgDb.run(ctx.orgId, (tx) => tx.file.create({ data: { id, key, kind: input.kind, contentType: input.contentType, sizeBytes: input.sizeBytes, uploadedByMemberId: ctx.memberId } as never }));
    const { url, headers } = await this.storage.presignPut(key, input.contentType, input.sizeBytes);
    return { fileId: id, uploadUrl: url, headers };
  }

  async confirm(ctx: OrgCtx, fileId: string): Promise<void> {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const f = await tx.file.findFirst({ where: { id: fileId } });
      if (!f) throw notFound('File');
      this.assert(ctx, UPLOAD_PERMS[f.kind as FileKind]);
      const head = await this.storage.head(f.key);
      if (!head) throw new AppError('VALIDATION_FAILED', 400, 'Upload not found — try again');
      if (head.size > FILE_LIMITS[f.kind as FileKind].maxBytes) throw new AppError('VALIDATION_FAILED', 400, 'File is too large');
      await tx.file.updateMany({ where: { id: fileId }, data: { confirmed: true, sizeBytes: head.size } });
    });
  }

  async urlFor(ctx: OrgCtx, fileId: string, filename?: string): Promise<FileUrlResponse> {
    const f = await this.orgDb.run(ctx.orgId, (tx) => tx.file.findFirst({ where: { id: fileId, confirmed: true } }));
    if (!f) throw notFound('File');
    this.assert(ctx, READ_PERMS[f.kind as FileKind]);
    return { url: await this.storage.presignGet(f.key, filename), expiresAt: new Date(Date.now() + 300_000).toISOString() };
  }

  /** For server-side code that already authorised the caller (e.g. settings logo, owner statements). */
  async signedUrlForKey(key: string, filename?: string) { return this.storage.presignGet(key, filename); }

  async assertConfirmed(tx: OrgTx, fileId: string, kind: FileKind) {
    const f = await tx.file.findFirst({ where: { id: fileId, kind, confirmed: true } });
    if (!f) throw new AppError('VALIDATION_FAILED', 400, 'File not uploaded');
    return f;
  }

  async storeGenerated(orgId: string, kind: 'statement_pdf' | 'receipt_pdf', body: Buffer, actorMemberId: string | null) {
    const id = newId(); const key = `org/${orgId}/${kind}/${id}.pdf`;
    await this.storage.put(key, body, 'application/pdf');
    await this.orgDb.run(orgId, (tx) => tx.file.create({ data: { id, key, kind, contentType: 'application/pdf', sizeBytes: body.length, uploadedByMemberId: actorMemberId, confirmed: true } as never }));
    return { fileId: id, key };
  }
}
```
(`notifications.read` is held by every role, so any member may see the operator logo.)

`apps/api/src/common/files/files.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { loadEnv } from '../../env';
import { FilesService } from './files.service';
import { MemoryStorage, R2Storage, STORAGE } from './storage';

@Global()
@Module({
  providers: [
    { provide: STORAGE, useFactory: () => { const e = loadEnv(); return e.R2_ENDPOINT && e.NODE_ENV !== 'test' ? new R2Storage(e.R2_ENDPOINT, e.R2_BUCKET!, e.R2_ACCESS_KEY_ID!, e.R2_SECRET_ACCESS_KEY!) : new MemoryStorage(); } },
    FilesService,
  ],
  exports: [STORAGE, FilesService],
})
export class FilesModule {}
```
`apps/api/src/modules/files/files.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { PresignInput } from '@boogbe/shared';
import { Ctx, SignedIn } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { FilesService } from '../../common/files/files.service';

class PresignDto extends createZodDto(PresignInput) {}

/** @SignedIn: the permission depends on the file kind, checked inside FilesService. */
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}
  @Post('presign') @SignedIn() presign(@Ctx() c: RequestCtx, @Body() b: PresignDto) { return this.files.presign(requireOrg(c), b); }
  @Post(':id/confirm') @SignedIn() @HttpCode(200) async confirm(@Ctx() c: RequestCtx, @Param('id') id: string) { await this.files.confirm(requireOrg(c), id); return { ok: true }; }
  @Get(':id/url') @SignedIn() url(@Ctx() c: RequestCtx, @Param('id') id: string, @Query('filename') filename?: string) { return this.files.urlFor(requireOrg(c), id, filename); }
}
```
`files-http.module.ts`: `@Module({ controllers: [FilesController] }) export class FilesHttpModule {}`. Import `FilesModule` and `FilesHttpModule` in `AppModule`; `FilesModule` in `WorkerModule`.

Suspended-org check: `SessionGuard` only refuses suspended orgs for `permission` rules. Add to `requireOrg` a parameter-less check is not possible (no status in ctx), so extend `RequestCtx` with `orgStatus: string | null` (set in `SessionGuard`) and make `requireOrg` throw `ORG_SUSPENDED` when `orgStatus === 'suspended'`. Update `SessionGuard` to always populate `orgStatus`, keeping the early throw for `permission` rules.

`OrgService` changes:
- `get`: `logoUrl: s.logoKey ? await this.files.signedUrlForKey(s.logoKey) : null`.
- `update`: if `'logoFileId' in input`: `null` → `logoKey = null`; otherwise `const f = await this.files.assertConfirmed(tx, input.logoFileId, 'logo'); logoKey = f.key`. Strip `logoFileId` from `settingsPatch` and set `logoKey` instead.

Register in `apps/api/test/helpers/routes.ts`:
```ts
ISOLATION_FIXTURES.file = async (orgId) => {
  const { migratorClient } = await import('./db');
  const { newId } = await import('../../src/common/db/ids');
  const m = await migratorClient(); const id = newId();
  await m.query(`insert into file(id, org_id, key, kind, content_type, size_bytes, confirmed) values ($1,$2,$3,'logo','image/png',10,true)`, [id, orgId, `org/${orgId}/logo/${id}.png`]);
  await m.end(); return id;
};
PARAM_FIXTURE.id = 'file'; // overridden per-route below when ambiguous
```
Because `:id` is shared by many resources, change the harness to look up the fixture by **route prefix**: replace `PARAM_FIXTURE` with `ROUTE_FIXTURE: Array<{ match: RegExp; fixture: string }>` and in `isolation.int.ts` choose the first entry whose `match` tests `r.path`. Add `{ match: /^\/v1\/files\//, fixture: 'file' }`. (Files routes are `@SignedIn`, so also include `signedIn` routes in the isolation sweep: filter `r.access.kind === 'permission' || r.access.kind === 'signedIn'`.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: PASS, including `isolation.int.ts` now exercising `/v1/files/:id/confirm` and `/v1/files/:id/url` across orgs (404).

- [ ] **Step 5: Commit**
```bash
git add apps/api packages/shared .env.example
git commit -m "feat(files): R2 presigned uploads with per-kind limits and operator logo [ORG-01]"
```

---

### Task 4 (T-M1-04) [api]: Owners, properties, units, ownership, fee config

**Files:**
- Create: `apps/api/src/modules/inventory/{inventory.module.ts,owners.controller.ts,owners.service.ts,properties.controller.ts,properties.service.ts,units.controller.ts,units.service.ts,ownership.service.ts,mappers.ts}`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/common/auth/auth.ts` (link landlord on invite accept), `apps/api/test/helpers/routes.ts`
- Create: `apps/api/test/helpers/inventory.ts`
- Test: `apps/api/test/inventory.int.ts`

**Interfaces:**
- Endpoints:
  - `GET /v1/owners` (`owners.read`) → `{ items: Owner[] }`; `POST /v1/owners` (`owners.write`) → `Owner`; `PATCH /v1/owners/:id`; `POST /v1/owners/:id/archive`; `POST /v1/owners/:id/invite` (`owners.write`; requires `email`; creates Better Auth invitation role `landlord` via `auth.api.createInvitation` with the caller's headers).
  - `GET /v1/properties` (`inventory.read`) → `{ items: Property[] }` (active first, then archived; `?includeArchived=true` to include archived); `POST /v1/properties` (`inventory.write`); `PATCH /v1/properties/:id`; `POST /v1/properties/:id/archive`; `POST /v1/properties/:id/unarchive`; `POST /v1/properties/:id/owner` body `SetPropertyOwnerInput`.
  - `GET /v1/units?propertyId=` (`inventory.read`) → `{ items: Unit[] }`; `POST /v1/units`; `PATCH /v1/units/:id`; `POST /v1/units/:id/archive`; `POST /v1/units/:id/unarchive`; `POST /v1/units/:id/owner` body `SetUnitOwnerInput`; `GET /v1/units/:id/ownership` → `{ items: { ownerId: string|null; ownerName: string|null; from: string; to: string|null }[] }`.
- `OwnershipService.setUnitOwner(tx: OrgTx, unitId: string, ownerId: string | null, effectiveFrom: IsoDate): Promise<void>`; `OwnershipService.periodsFor(tx: OrgTx, unitIds: string[]): Promise<Map<string, OwnershipPeriod[]>>` (used by M7); `OwnershipService.currentOwner(tx, unitIds, today): Promise<Map<string, string|null>>`.
- Test helpers (`test/helpers/inventory.ts`): `seedProperty(orgId, overrides?)`, `seedUnit(orgId, propertyId, overrides?)`, `seedOwner(orgId, overrides?)` each returning the created id (insert via migrator client).
- `mappers.ts`: `toOwner(row, portalStatus)`, `toProperty(row, unitCount, ownerName)`, `toUnit(row, current)`; all BigInt → number via `Number()` after `assertKobo`.

- [ ] **Step 1: Write failing tests**

`apps/api/test/helpers/inventory.ts`:
```ts
import { migratorClient } from './db';
import { newId } from '../../src/common/db/ids';

export async function seedOwner(orgId: string, o: Partial<{ name: string; email: string }> = {}) {
  const m = await migratorClient(); const id = newId();
  await m.query(`insert into owner(id, org_id, name, email, updated_at) values ($1,$2,$3,$4,now())`, [id, orgId, o.name ?? 'Mrs Owner', o.email ?? null]);
  await m.end(); return id;
}
export async function seedProperty(orgId: string, p: Partial<{ name: string; defaultOwnerId: string; feeType: string; feeBps: number }> = {}) {
  const m = await migratorClient(); const id = newId();
  await m.query(`insert into property(id, org_id, name, address, default_owner_id, fee_type, fee_bps, updated_at) values ($1,$2,$3,'Lekki Phase 1',$4,$5,$6,now())`,
    [id, orgId, p.name ?? 'The Rock', p.defaultOwnerId ?? null, p.feeType ?? 'none', p.feeBps ?? 0]);
  await m.end(); return id;
}
export async function seedUnit(orgId: string, propertyId: string, u: Partial<{ name: string; rateKobo: number; maxGuests: number; ownerId: string | null; from: string }> = {}) {
  const m = await migratorClient(); const id = newId();
  await m.query(`insert into unit(id, org_id, property_id, name, bedrooms, max_guests, nightly_rate_kobo, updated_at) values ($1,$2,$3,$4,2,$5,$6,now())`,
    [id, orgId, propertyId, u.name ?? `Unit ${id.slice(-4)}`, u.maxGuests ?? 4, u.rateKobo ?? 20_000_000]);
  await m.query(`insert into unit_ownership(id, org_id, unit_id, owner_id, effective_from) values ($1,$2,$3,$4,$5)`, [newId(), orgId, id, u.ownerId ?? null, u.from ?? '2026-01-01']);
  await m.end(); return id;
}
```
`apps/api/test/inventory.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedOwner } from './helpers/inventory';

describe('inventory [INV-01..06]', () => {
  let t: TestApp; let admin: Agent; let orgId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll();
    orgId = (await seedOrg('Tanuhomes')).id;
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });

  const prop = (o: Record<string, unknown> = {}) => ({ name: 'The Rock', address: '3 Olu-Babajide Close, Lekki Phase 1', feeType: 'pct_gross', feeBps: 2000, feeFixedMonthlyKobo: 0, ...o });
  const unit = (propertyId: string, o: Record<string, unknown> = {}) => ({ propertyId, name: 'Kairo', bedrooms: 2, maxGuests: 4, nightlyRateKobo: 20_000_000, defaultAssigneeMemberId: null, feeOverride: false, feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 0, ...o });

  it('creates property and unit; unit owner defaults to operator', async () => {
    const p = (await admin.post('/v1/properties').send(prop()).expect(201)).body;
    const u = (await admin.post('/v1/units').send(unit(p.id)).expect(201)).body;
    expect(u).toMatchObject({ name: 'Kairo', nightlyRateKobo: 20_000_000, ownerFollowsProperty: true, currentOwner: null, currentOwnerSource: 'operator' });
    const list = (await admin.get(`/v1/units?propertyId=${p.id}`).expect(200)).body.items;
    expect(list).toHaveLength(1);
  });

  it('unit name must be unique within a property', async () => {
    const p = (await admin.post('/v1/properties').send(prop()).expect(201)).body;
    await admin.post('/v1/units').send(unit(p.id)).expect(201);
    await admin.post('/v1/units').send(unit(p.id)).expect(409);
  });

  it('property default owner applies to following units from the effective date', async () => {
    const owner = await seedOwner(orgId, { name: 'Mrs Adebayo' });
    const p = (await admin.post('/v1/properties').send(prop()).expect(201)).body;
    const u = (await admin.post('/v1/units').send(unit(p.id)).expect(201)).body;
    await admin.post(`/v1/properties/${p.id}/owner`).send({ defaultOwnerId: owner, effectiveFrom: '2026-10-10' }).expect(200);
    const hist = (await admin.get(`/v1/units/${u.id}/ownership`).expect(200)).body.items;
    expect(hist).toEqual([
      expect.objectContaining({ ownerId: null, to: '2026-10-10' }),
      expect.objectContaining({ ownerId: owner, ownerName: 'Mrs Adebayo', from: '2026-10-10', to: null }),
    ]);
  });

  it('property default change skips overridden units', async () => {
    const o1 = await seedOwner(orgId, { name: 'O1' }); const o2 = await seedOwner(orgId, { name: 'O2' });
    const p = (await admin.post('/v1/properties').send(prop()).expect(201)).body;
    const a = (await admin.post('/v1/units').send(unit(p.id, { name: 'A' })).expect(201)).body;
    const b = (await admin.post('/v1/units').send(unit(p.id, { name: 'B' })).expect(201)).body;
    await admin.post(`/v1/units/${b.id}/owner`).send({ mode: 'owner', ownerId: o2, effectiveFrom: '2026-10-10' }).expect(200);
    await admin.post(`/v1/properties/${p.id}/owner`).send({ defaultOwnerId: o1, effectiveFrom: '2026-10-11' }).expect(200);
    const units = (await admin.get(`/v1/units?propertyId=${p.id}`).expect(200)).body.items as { id: string; currentOwner: { id: string } | null; currentOwnerSource: string }[];
    // currentOwner is "as of today in Lagos"; the test pins today via ?asOf
    const asOf = (await admin.get(`/v1/units?propertyId=${p.id}&asOf=2026-10-12`).expect(200)).body.items as typeof units;
    expect(asOf.find((x) => x.id === a.id)).toMatchObject({ currentOwner: { id: o1 }, currentOwnerSource: 'property' });
    expect(asOf.find((x) => x.id === b.id)).toMatchObject({ currentOwner: { id: o2 }, currentOwnerSource: 'unit' });
    expect(units).toHaveLength(2);
  });

  it('same-day ownership change replaces the period', async () => {
    const o1 = await seedOwner(orgId); const o2 = await seedOwner(orgId);
    const p = (await admin.post('/v1/properties').send(prop()).expect(201)).body;
    const u = (await admin.post('/v1/units').send(unit(p.id)).expect(201)).body;
    await admin.post(`/v1/units/${u.id}/owner`).send({ mode: 'owner', ownerId: o1, effectiveFrom: '2026-10-10' }).expect(200);
    await admin.post(`/v1/units/${u.id}/owner`).send({ mode: 'owner', ownerId: o2, effectiveFrom: '2026-10-10' }).expect(200);
    const hist = (await admin.get(`/v1/units/${u.id}/ownership`).expect(200)).body.items;
    expect(hist.at(-1)).toMatchObject({ ownerId: o2, from: '2026-10-10', to: null });
    expect(hist.filter((h: { from: string }) => h.from === '2026-10-10')).toHaveLength(1);
  });

  it('refuses backdated ownership changes', async () => {
    const o1 = await seedOwner(orgId);
    const p = (await admin.post('/v1/properties').send(prop()).expect(201)).body;
    const u = (await admin.post('/v1/units').send(unit(p.id)).expect(201)).body;
    await admin.post(`/v1/units/${u.id}/owner`).send({ mode: 'owner', ownerId: o1, effectiveFrom: '2026-10-10' }).expect(200);
    const r = await admin.post(`/v1/units/${u.id}/owner`).send({ mode: 'operator', effectiveFrom: '2026-10-01' });
    expect(r.status).toBe(422);
  });

  it('owners CRUD validates NUBAN and archive hides them', async () => {
    await admin.post('/v1/owners').send({ name: 'Mrs A', accountNumber: '123' }).expect(400);
    const o = (await admin.post('/v1/owners').send({ name: 'Mrs A', accountNumber: '0123456789', bankName: 'GTBank' }).expect(201)).body;
    expect(o).toMatchObject({ name: 'Mrs A', portalStatus: 'none', active: true });
    await admin.post(`/v1/owners/${o.id}/archive`).expect(200);
    expect((await admin.get('/v1/owners').expect(200)).body.items).toEqual([]);
  });

  it('inviting an owner creates a landlord invitation and links on accept', async () => {
    const o = (await admin.post('/v1/owners').send({ name: 'Mrs A', email: 'mrsa@example.ng' }).expect(201)).body;
    const inv = await admin.post(`/v1/owners/${o.id}/invite`).expect(200);
    expect(inv.body.portalStatus).toBe('invited');
    const agent = t.agent();
    await agent.post('/v1/auth/sign-up/email').send({ email: 'mrsa@example.ng', password: 'correct-horse-battery', name: 'Mrs A' }).expect(200);
    await agent.post('/v1/auth/organization/accept-invitation').send({ invitationId: inv.body.invitationId }).expect(200);
    const after = (await admin.get('/v1/owners').expect(200)).body.items[0];
    expect(after).toMatchObject({ portalStatus: 'active', userId: expect.any(String) });
  });

  it('frontdesk can read inventory but not write; frontdesk cannot see owners', async () => {
    const fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    await fd.get('/v1/properties').expect(200);
    await fd.post('/v1/properties').send(prop()).expect(403);
    await fd.get('/v1/owners').expect(403);
  });

  it('unit fee override is stored and used', async () => {
    const p = (await admin.post('/v1/properties').send(prop()).expect(201)).body;
    const u = (await admin.post('/v1/units').send(unit(p.id, { feeOverride: true, feeType: 'pct_net', feeBps: 1500, feeFixedMonthlyKobo: 5_000_000 })).expect(201)).body;
    expect(u).toMatchObject({ feeOverride: true, feeType: 'pct_net', feeBps: 1500, feeFixedMonthlyKobo: 5_000_000 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:int -- inventory`
Expected: FAIL — 404 on `/v1/properties`.

- [ ] **Step 3: Implement ownership service**

`apps/api/src/modules/inventory/ownership.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { ownerOn, planOwnerChange, type IsoDate, type OwnershipPeriod } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AppError } from '../../common/http/app-error';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const date = (s: IsoDate) => new Date(`${s}T00:00:00Z`);

@Injectable()
export class OwnershipService {
  async periodsFor(tx: OrgTx, unitIds: string[]): Promise<Map<string, OwnershipPeriod[]>> {
    const rows = await tx.unitOwnership.findMany({ where: { unitId: { in: unitIds } }, orderBy: { effectiveFrom: 'asc' } });
    const map = new Map<string, OwnershipPeriod[]>(unitIds.map((id) => [id, []]));
    for (const r of rows) map.get(r.unitId)!.push({ ownerId: r.ownerId, from: iso(r.effectiveFrom), to: r.effectiveTo ? iso(r.effectiveTo) : null });
    return map;
  }

  async currentOwner(tx: OrgTx, unitIds: string[], asOf: IsoDate): Promise<Map<string, string | null>> {
    const periods = await this.periodsFor(tx, unitIds);
    return new Map(unitIds.map((id) => [id, ownerOn(periods.get(id) ?? [], asOf).ownerId]));
  }

  async setUnitOwner(tx: OrgTx, unitId: string, ownerId: string | null, effectiveFrom: IsoDate): Promise<void> {
    await tx.$queryRaw`SELECT id FROM unit WHERE id = ${unitId} FOR UPDATE`;
    if (ownerId) {
      const o = await tx.owner.findFirst({ where: { id: ownerId, active: true } });
      if (!o) throw new AppError('VALIDATION_FAILED', 400, 'Owner not found');
    }
    const periods = (await this.periodsFor(tx, [unitId])).get(unitId)!;
    let plan;
    try { plan = planOwnerChange(periods, ownerId, effectiveFrom); }
    catch (e) { throw new AppError('INVALID_TRANSITION', 422, (e as Error).message); }
    switch (plan.kind) {
      case 'noop': return;
      case 'insert':
        await tx.unitOwnership.create({ data: { id: newId(), unitId, ownerId, effectiveFrom: date(plan.insertFrom) } as never });
        return;
      case 'replace':
        await tx.unitOwnership.updateMany({ where: { unitId, effectiveFrom: date(plan.from), effectiveTo: null }, data: { ownerId } });
        return;
      case 'split':
        await tx.unitOwnership.updateMany({ where: { unitId, effectiveFrom: date(plan.closeFrom), effectiveTo: null }, data: { effectiveTo: date(plan.insertFrom) } });
        await tx.unitOwnership.create({ data: { id: newId(), unitId, ownerId, effectiveFrom: date(plan.insertFrom) } as never });
        return;
    }
  }
}
```

- [ ] **Step 4: Implement mappers and services**

`apps/api/src/modules/inventory/mappers.ts`:
```ts
import { assertKobo, type Owner, type Property, type Unit } from '@boogbe/shared';
import type { Owner as OwnerRow, Property as PropertyRow, Unit as UnitRow } from '@prisma/client';

export const kobo = (v: bigint) => { const n = Number(v); assertKobo(n); return n; };

export function toOwner(r: OwnerRow, portalStatus: Owner['portalStatus']): Owner {
  return { id: r.id, name: r.name, phone: r.phone, email: r.email, bankName: r.bankName, accountNumber: r.accountNumber, accountName: r.accountName, notes: r.notes, userId: r.userId, portalStatus, active: r.active };
}
export function toProperty(r: PropertyRow, unitCount: number, defaultOwnerName: string | null): Property {
  return {
    id: r.id, name: r.name, address: r.address, area: r.area, notes: r.notes, sortOrder: r.sortOrder, active: r.active, unitCount,
    feeType: r.feeType as Property['feeType'], feeBps: r.feeBps, feeFixedMonthlyKobo: kobo(r.feeFixedMonthlyKobo),
    defaultOwnerId: r.defaultOwnerId, defaultOwnerName,
  };
}
export function toUnit(r: UnitRow, current: { owner: { id: string; name: string } | null; source: Unit['currentOwnerSource'] }): Unit {
  return {
    id: r.id, propertyId: r.propertyId, name: r.name, bedrooms: r.bedrooms, maxGuests: r.maxGuests, nightlyRateKobo: kobo(r.nightlyRateKobo),
    defaultAssigneeMemberId: r.defaultAssigneeMemberId, checkInInstructions: r.checkInInstructions, sortOrder: r.sortOrder, active: r.active,
    feeOverride: r.feeOverride, feeType: r.feeType as Unit['feeType'], feeBps: r.feeBps, feeFixedMonthlyKobo: kobo(r.feeFixedMonthlyKobo),
    ownerFollowsProperty: r.ownerFollowsProperty, currentOwner: current.owner, currentOwnerSource: current.source,
  };
}
```

`apps/api/src/modules/inventory/owners.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Owner, OwnerInput } from '@boogbe/shared';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { OrgDb } from '../../common/db/org-db.service';
import { PrismaService } from '../../common/db/prisma.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import { AUTH } from '../../common/auth/auth.tokens';
import type { Auth } from '../../common/auth/auth';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { toOwner } from './mappers';

@Injectable()
export class OwnersService {
  constructor(private readonly orgDb: OrgDb, private readonly prisma: PrismaService, private readonly audit: AuditService, @Inject(AUTH) private readonly auth: Auth) {}

  private async portalStatus(ctx: OrgCtx, owners: { userId: string | null; email: string | null }[]) {
    const emails = owners.filter((o) => !o.userId && o.email).map((o) => o.email!.toLowerCase());
    const pending = emails.length ? await this.prisma.invitation.findMany({ where: { organizationId: ctx.orgId, email: { in: emails }, role: 'landlord', status: 'pending' }, select: { email: true } }) : [];
    const set = new Set(pending.map((p) => p.email));
    return (o: { userId: string | null; email: string | null }): Owner['portalStatus'] => (o.userId ? 'active' : o.email && set.has(o.email.toLowerCase()) ? 'invited' : 'none');
  }

  async list(ctx: OrgCtx, includeArchived = false): Promise<Owner[]> {
    const rows = await this.orgDb.run(ctx.orgId, (tx) => tx.owner.findMany({ where: includeArchived ? {} : { active: true }, orderBy: { name: 'asc' } }));
    const status = await this.portalStatus(ctx, rows);
    return rows.map((r) => toOwner(r, status(r)));
  }

  async create(ctx: OrgCtx, input: OwnerInput): Promise<Owner> {
    const row = await this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.owner.create({ data: { id: newId(), ...input, email: input.email?.toLowerCase() ?? null } as never });
      await this.audit.record(tx, { actor: ctx, action: 'owner.create', entity: 'owner', entityId: r.id, after: input });
      return r;
    });
    return toOwner(row, 'none');
  }

  async update(ctx: OrgCtx, id: string, input: Partial<OwnerInput>): Promise<Owner> {
    const row = await this.orgDb.run(ctx.orgId, async (tx) => {
      const before = await tx.owner.findFirst({ where: { id } });
      if (!before) throw notFound('Owner');
      await tx.owner.updateMany({ where: { id }, data: { ...input, ...(input.email !== undefined && { email: input.email?.toLowerCase() ?? null }) } });
      await this.audit.record(tx, { actor: ctx, action: 'owner.update', entity: 'owner', entityId: id, before, after: input });
      return (await tx.owner.findFirst({ where: { id } }))!;
    });
    return toOwner(row, (await this.portalStatus(ctx, [row]))(row));
  }

  async archive(ctx: OrgCtx, id: string) {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.owner.updateMany({ where: { id }, data: { active: false } });
      if (!r.count) throw notFound('Owner');
      await this.audit.record(tx, { actor: ctx, action: 'owner.archive', entity: 'owner', entityId: id });
    });
    return { ok: true };
  }

  /** Invite the owner to the read-only portal. Uses the caller's session so Better Auth enforces invite permission. */
  async invite(ctx: OrgCtx, id: string, headers: IncomingHttpHeaders) {
    const owner = await this.orgDb.run(ctx.orgId, (tx) => tx.owner.findFirst({ where: { id, active: true } }));
    if (!owner) throw notFound('Owner');
    if (!owner.email) throw new AppError('VALIDATION_FAILED', 400, 'Add an email address for this owner first');
    if (owner.userId) throw new AppError('CONFLICT', 409, 'This owner already has portal access');
    const inv = await this.auth.api.createInvitation({ headers: fromNodeHeaders(headers), body: { email: owner.email, role: 'landlord' as never, organizationId: ctx.orgId, resend: true } });
    return { invitationId: inv.id, portalStatus: 'invited' as const };
  }
}
```
Landlord linking on accept — in `auth.ts` `afterAcceptInvitation`, after the audit write, add:
```ts
            if (member.role === 'landlord') {
              await prisma.$transaction(async (tx) => {
                await tx.$executeRaw`SELECT set_config('app.org_id', ${org.id}, true)`;
                await tx.$executeRaw`UPDATE owner SET user_id = ${user.id} WHERE org_id = ${org.id} AND lower(email) = lower(${user.email}) AND user_id IS NULL`;
              });
            }
```
(`OwnersService` injects `PrismaService` to read the global `invitation` table → add `'modules/inventory/owners.service.ts'` to `PRISMA_ALLOWED` in `tenant-isolation.spec.ts` with comment "reads global invitation table".)

`apps/api/src/modules/inventory/properties.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { todayIn, type Property, type PropertyInput, type SetPropertyOwnerInput } from '@boogbe/shared';
import { OrgDb } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { OwnershipService } from './ownership.service';
import { toProperty } from './mappers';

@Injectable()
export class PropertiesService {
  constructor(private readonly orgDb: OrgDb, private readonly audit: AuditService, private readonly ownership: OwnershipService) {}

  async list(ctx: OrgCtx, includeArchived: boolean): Promise<Property[]> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const rows = await tx.property.findMany({ where: includeArchived ? {} : { active: true }, orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { units: { where: { active: true } } } } } });
      const ownerIds = [...new Set(rows.map((r) => r.defaultOwnerId).filter((x): x is string => !!x))];
      const owners = new Map((await tx.owner.findMany({ where: { id: { in: ownerIds } } })).map((o) => [o.id, o.name]));
      return rows.map((r) => toProperty(r, r._count.units, r.defaultOwnerId ? owners.get(r.defaultOwnerId) ?? null : null));
    });
  }

  async get(ctx: OrgCtx, id: string): Promise<Property> {
    const p = (await this.list(ctx, true)).find((x) => x.id === id);
    if (!p) throw notFound('Property');
    return p;
  }

  async create(ctx: OrgCtx, input: PropertyInput): Promise<Property> {
    const id = newId();
    await this.orgDb.run(ctx.orgId, async (tx) => {
      await tx.property.create({ data: { id, ...input, feeFixedMonthlyKobo: BigInt(input.feeFixedMonthlyKobo) } as never });
      await this.audit.record(tx, { actor: ctx, action: 'property.create', entity: 'property', entityId: id, after: input });
    });
    return this.get(ctx, id);
  }

  async update(ctx: OrgCtx, id: string, input: Partial<PropertyInput>): Promise<Property> {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const before = await tx.property.findFirst({ where: { id } });
      if (!before) throw notFound('Property');
      await tx.property.updateMany({ where: { id }, data: { ...input, ...(input.feeFixedMonthlyKobo !== undefined && { feeFixedMonthlyKobo: BigInt(input.feeFixedMonthlyKobo) }) } });
      await this.audit.record(tx, { actor: ctx, action: 'property.update', entity: 'property', entityId: id, before, after: input });
    });
    return this.get(ctx, id);
  }

  async setActive(ctx: OrgCtx, id: string, active: boolean) {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.property.updateMany({ where: { id }, data: { active } });
      if (!r.count) throw notFound('Property');
      await this.audit.record(tx, { actor: ctx, action: active ? 'property.unarchive' : 'property.archive', entity: 'property', entityId: id });
    });
    return this.get(ctx, id);
  }

  /** Changes the default owner and moves every unit that follows the property, from effectiveFrom. */
  async setDefaultOwner(ctx: OrgCtx, id: string, input: SetPropertyOwnerInput): Promise<Property> {
    if (input.effectiveFrom < todayIn(ctx.timezone).slice(0, 4) + '-01-01') throw new AppError('VALIDATION_FAILED', 400, 'Effective date is too far in the past');
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const p = await tx.property.findFirst({ where: { id } });
      if (!p) throw notFound('Property');
      await tx.property.updateMany({ where: { id }, data: { defaultOwnerId: input.defaultOwnerId } });
      const units = await tx.unit.findMany({ where: { propertyId: id, ownerFollowsProperty: true } });
      for (const u of units) await this.ownership.setUnitOwner(tx, u.id, input.defaultOwnerId, input.effectiveFrom);
      await this.audit.record(tx, { actor: ctx, action: 'property.owner_change', entity: 'property', entityId: id, before: { defaultOwnerId: p.defaultOwnerId }, after: input });
    });
    return this.get(ctx, id);
  }
}
```
`apps/api/src/modules/inventory/units.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { todayIn, type IsoDate, type SetUnitOwnerInput, type Unit, type UnitInput } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { OwnershipService } from './ownership.service';
import { toUnit } from './mappers';

@Injectable()
export class UnitsService {
  constructor(private readonly orgDb: OrgDb, private readonly audit: AuditService, private readonly ownership: OwnershipService) {}

  private async hydrate(tx: OrgTx, rows: Awaited<ReturnType<OrgTx['unit']['findMany']>>, asOf: IsoDate): Promise<Unit[]> {
    const current = await this.ownership.currentOwner(tx, rows.map((r) => r.id), asOf);
    const ownerIds = [...new Set([...current.values()].filter((x): x is string => !!x))];
    const names = new Map((await tx.owner.findMany({ where: { id: { in: ownerIds } } })).map((o) => [o.id, o.name]));
    return rows.map((r) => {
      const oid = current.get(r.id) ?? null;
      return toUnit(r, { owner: oid ? { id: oid, name: names.get(oid) ?? '' } : null, source: oid === null ? 'operator' : r.ownerFollowsProperty ? 'property' : 'unit' });
    });
  }

  list(ctx: OrgCtx, q: { propertyId?: string; includeArchived?: boolean; asOf?: IsoDate }): Promise<Unit[]> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const rows = await tx.unit.findMany({ where: { ...(q.propertyId && { propertyId: q.propertyId }), ...(!q.includeArchived && { active: true }) }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
      return this.hydrate(tx, rows, q.asOf ?? todayIn(ctx.timezone));
    });
  }

  async get(ctx: OrgCtx, id: string): Promise<Unit> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const row = await tx.unit.findFirst({ where: { id } });
      if (!row) throw notFound('Unit');
      return (await this.hydrate(tx, [row], todayIn(ctx.timezone)))[0]!;
    });
  }

  async create(ctx: OrgCtx, input: UnitInput): Promise<Unit> {
    const id = newId();
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const p = await tx.property.findFirst({ where: { id: input.propertyId, active: true } });
      if (!p) throw new AppError('VALIDATION_FAILED', 400, 'Property not found');
      await tx.unit.create({ data: { id, ...input, nightlyRateKobo: BigInt(input.nightlyRateKobo), feeFixedMonthlyKobo: BigInt(input.feeFixedMonthlyKobo) } as never });
      await tx.unitOwnership.create({ data: { id: newId(), unitId: id, ownerId: p.defaultOwnerId, effectiveFrom: new Date(`${todayIn(ctx.timezone)}T00:00:00Z`) } as never });
      await this.audit.record(tx, { actor: ctx, action: 'unit.create', entity: 'unit', entityId: id, after: input });
    });
    return this.get(ctx, id);
  }

  async update(ctx: OrgCtx, id: string, input: Partial<UnitInput>): Promise<Unit> {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const before = await tx.unit.findFirst({ where: { id } });
      if (!before) throw notFound('Unit');
      if (input.propertyId && input.propertyId !== before.propertyId) throw new AppError('VALIDATION_FAILED', 400, 'A unit cannot move to another property');
      await tx.unit.updateMany({ where: { id }, data: {
        ...input,
        ...(input.nightlyRateKobo !== undefined && { nightlyRateKobo: BigInt(input.nightlyRateKobo) }),
        ...(input.feeFixedMonthlyKobo !== undefined && { feeFixedMonthlyKobo: BigInt(input.feeFixedMonthlyKobo) }),
      } });
      await this.audit.record(tx, { actor: ctx, action: 'unit.update', entity: 'unit', entityId: id, before, after: input });
    });
    return this.get(ctx, id);
  }

  async setActive(ctx: OrgCtx, id: string, active: boolean) {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.unit.updateMany({ where: { id }, data: { active } });
      if (!r.count) throw notFound('Unit');
      await this.audit.record(tx, { actor: ctx, action: active ? 'unit.unarchive' : 'unit.archive', entity: 'unit', entityId: id });
    });
    return this.get(ctx, id);
  }

  async setOwner(ctx: OrgCtx, id: string, input: SetUnitOwnerInput): Promise<Unit> {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const u = await tx.unit.findFirst({ where: { id }, include: { property: true } });
      if (!u) throw notFound('Unit');
      const ownerId = input.mode === 'owner' ? input.ownerId : input.mode === 'property' ? u.property.defaultOwnerId : null;
      await tx.unit.updateMany({ where: { id }, data: { ownerFollowsProperty: input.mode === 'property' } });
      await this.ownership.setUnitOwner(tx, id, ownerId, input.effectiveFrom);
      await this.audit.record(tx, { actor: ctx, action: 'unit.owner_change', entity: 'unit', entityId: id, after: input });
    });
    return this.get(ctx, id);
  }

  async ownershipHistory(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const u = await tx.unit.findFirst({ where: { id } });
      if (!u) throw notFound('Unit');
      const periods = (await this.ownership.periodsFor(tx, [id])).get(id)!;
      const names = new Map((await tx.owner.findMany({ where: { id: { in: periods.map((p) => p.ownerId).filter((x): x is string => !!x) } } })).map((o) => [o.id, o.name]));
      return { items: periods.map((p) => ({ ownerId: p.ownerId, ownerName: p.ownerId ? names.get(p.ownerId) ?? null : null, from: p.from, to: p.to })) };
    });
  }
}
```
Fix in `PropertiesService.setDefaultOwner`: replace the "too far in the past" line with no check (ownership rules in `planOwnerChange` already prevent backdating before the current period) — delete that `if` line.

- [ ] **Step 5: Controllers + module**

`apps/api/src/modules/inventory/owners.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { OwnerInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { OwnersService } from './owners.service';

class OwnerDto extends createZodDto(OwnerInput) {}
class OwnerPatchDto extends createZodDto(OwnerInput.partial()) {}

@Controller('owners')
export class OwnersController {
  constructor(private readonly svc: OwnersService) {}
  @Get() @Permission('owners.read') async list(@Ctx() c: RequestCtx, @Query('includeArchived') a?: string) { return { items: await this.svc.list(requireOrg(c), a === 'true') }; }
  @Post() @Permission('owners.write') create(@Ctx() c: RequestCtx, @Body() b: OwnerDto) { return this.svc.create(requireOrg(c), b); }
  @Patch(':id') @Permission('owners.write') update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: OwnerPatchDto) { return this.svc.update(requireOrg(c), id, b); }
  @Post(':id/archive') @HttpCode(200) @Permission('owners.write') archive(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.archive(requireOrg(c), id); }
  @Post(':id/invite') @HttpCode(200) @Permission('owners.write') invite(@Ctx() c: RequestCtx, @Param('id') id: string, @Req() req: Request) { return this.svc.invite(requireOrg(c), id, req.headers); }
}
```
`apps/api/src/modules/inventory/properties.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { PropertyInput, SetPropertyOwnerInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { PropertiesService } from './properties.service';

class PropertyDto extends createZodDto(PropertyInput) {}
class PropertyPatchDto extends createZodDto(PropertyInput.partial()) {}
class OwnerDto extends createZodDto(SetPropertyOwnerInput) {}

@Controller('properties')
export class PropertiesController {
  constructor(private readonly svc: PropertiesService) {}
  @Get() @Permission('inventory.read') async list(@Ctx() c: RequestCtx, @Query('includeArchived') a?: string) { return { items: await this.svc.list(requireOrg(c), a === 'true') }; }
  @Get(':id') @Permission('inventory.read') get(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.get(requireOrg(c), id); }
  @Post() @Permission('inventory.write') create(@Ctx() c: RequestCtx, @Body() b: PropertyDto) { return this.svc.create(requireOrg(c), b); }
  @Patch(':id') @Permission('inventory.write') update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: PropertyPatchDto) { return this.svc.update(requireOrg(c), id, b); }
  @Post(':id/archive') @HttpCode(200) @Permission('inventory.write') archive(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.setActive(requireOrg(c), id, false); }
  @Post(':id/unarchive') @HttpCode(200) @Permission('inventory.write') unarchive(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.setActive(requireOrg(c), id, true); }
  @Post(':id/owner') @HttpCode(200) @Permission('owners.write') owner(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: OwnerDto) { return this.svc.setDefaultOwner(requireOrg(c), id, b); }
}
```
`apps/api/src/modules/inventory/units.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDateSchema, SetUnitOwnerInput, UnitInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { UnitsService } from './units.service';

class UnitDto extends createZodDto(UnitInput) {}
class UnitPatchDto extends createZodDto(UnitInput.partial()) {}
class OwnerDto extends createZodDto(SetUnitOwnerInput) {}
class ListQuery extends createZodDto(z.object({ propertyId: z.string().optional(), includeArchived: z.enum(['true', 'false']).optional(), asOf: IsoDateSchema.optional() })) {}

@Controller('units')
export class UnitsController {
  constructor(private readonly svc: UnitsService) {}
  @Get() @Permission('inventory.read') async list(@Ctx() c: RequestCtx, @Query() q: ListQuery) { return { items: await this.svc.list(requireOrg(c), { propertyId: q.propertyId, includeArchived: q.includeArchived === 'true', asOf: q.asOf }) }; }
  @Get(':id') @Permission('inventory.read') get(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.get(requireOrg(c), id); }
  @Post() @Permission('inventory.write') create(@Ctx() c: RequestCtx, @Body() b: UnitDto) { return this.svc.create(requireOrg(c), b); }
  @Patch(':id') @Permission('inventory.write') update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: UnitPatchDto) { return this.svc.update(requireOrg(c), id, b); }
  @Post(':id/archive') @HttpCode(200) @Permission('inventory.write') archive(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.setActive(requireOrg(c), id, false); }
  @Post(':id/unarchive') @HttpCode(200) @Permission('inventory.write') unarchive(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.setActive(requireOrg(c), id, true); }
  @Post(':id/owner') @HttpCode(200) @Permission('owners.write') owner(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: OwnerDto) { return this.svc.setOwner(requireOrg(c), id, b); }
  @Get(':id/ownership') @Permission('owners.read') history(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.ownershipHistory(requireOrg(c), id); }
}
```
`inventory.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { OwnersController } from './owners.controller';
import { OwnersService } from './owners.service';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';
import { OwnershipService } from './ownership.service';

@Module({
  controllers: [OwnersController, PropertiesController, UnitsController],
  providers: [OwnersService, PropertiesService, UnitsService, OwnershipService],
  exports: [OwnershipService, UnitsService],
})
export class InventoryModule {}
```
Register in `AppModule`.

Isolation fixtures — add to `test/helpers/routes.ts`:
```ts
import { seedOwner, seedProperty, seedUnit } from './inventory';
ISOLATION_FIXTURES.owner = (orgId) => seedOwner(orgId);
ISOLATION_FIXTURES.property = (orgId) => seedProperty(orgId);
ISOLATION_FIXTURES.unit = async (orgId) => seedUnit(orgId, await seedProperty(orgId));
ROUTE_FIXTURE.push(
  { match: /^\/v1\/owners\//, fixture: 'owner' },
  { match: /^\/v1\/properties\//, fixture: 'property' },
  { match: /^\/v1\/units\//, fixture: 'unit' },
);
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: PASS (inventory 10, isolation now covering owners/properties/units).

- [ ] **Step 7: Commit**
```bash
git add apps/api
git commit -m "feat(inventory): owners, properties, units with effective-dated ownership and fee config [INV-01..04 INV-06]"
```

---

### Task 5 (T-M1-05) [api]: Unit fees, manual blocks, calendar endpoint

**Files:**
- Create: `apps/api/src/modules/inventory/{fees.controller.ts,fees.service.ts,blocks.controller.ts,blocks.service.ts}`
- Create: `apps/api/src/modules/calendar/{calendar.module.ts,calendar.controller.ts,calendar.service.ts,calendar-sources.ts}`
- Modify: `apps/api/src/modules/inventory/inventory.module.ts`, `apps/api/src/app.module.ts`, `apps/api/test/helpers/routes.ts`
- Test: `apps/api/test/fees-blocks.int.ts`, `apps/api/test/calendar.int.ts`

**Interfaces:**
- `GET /v1/units/:id/fees` (`inventory.read`) → `{ items: UnitFee[] }`; `POST /v1/units/:id/fees` (`inventory.write`) → `UnitFee`; `PATCH /v1/fees/:id`; `POST /v1/fees/:id/archive`.
- `POST /v1/blocks` (`bookings.write`) body `BlockInput` → `Block`; `PATCH /v1/blocks/:id` (manual only); `DELETE /v1/blocks/:id` (manual only; iCal blocks → 422).
- `BlocksService.assertUnitFree(tx: OrgTx, unitId: string, start: IsoDate, end: IsoDate, ignore?: { blockId?: string; bookingId?: string }): Promise<void>` — locks the unit row (`FOR UPDATE`), checks manual blocks; **M2 extends it** to check bookings by registering a checker: `CalendarSources` registry.
- `CalendarSources`: injectable registry `{ register(source: CalendarSource): void; all(): CalendarSource[] }`, `interface CalendarSource { items(tx: OrgTx, unitIds: string[], from: IsoDate, to: IsoDate, ctx: OrgCtx): Promise<CalendarItem[]>; conflicts?(tx: OrgTx, unitId: string, start: IsoDate, end: IsoDate, ignore?: { blockId?: string; bookingId?: string }): Promise<{ kind: 'booking'|'block'; id: string } | null> }`. M1 registers `BlockSource`; M2 registers `BookingSource`.
- `GET /v1/calendar?from&to` (`calendar.read`) → `CalendarResponse` (active properties with active units, items from all sources overlapping `[from, to)`, `today` in operator tz).

- [ ] **Step 1: Write failing tests**

`apps/api/test/fees-blocks.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';

describe('fees and blocks [INV-05 INV-07]', () => {
  let t: TestApp; let admin: Agent; let orgId: string; let unitId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll();
    orgId = (await seedOrg()).id; admin = (await signInAs(t, 'admin', orgId)).agent;
    unitId = await seedUnit(orgId, await seedProperty(orgId));
  });

  it('adds fees; caution deposit is refundable, others are not', async () => {
    const dep = (await admin.post(`/v1/units/${unitId}/fees`).send({ kind: 'caution_deposit', label: 'Caution deposit', amountKobo: 10_000_000, basis: 'per_stay' }).expect(201)).body;
    const cln = (await admin.post(`/v1/units/${unitId}/fees`).send({ kind: 'cleaning', label: 'Cleaning', amountKobo: 1_500_000, basis: 'per_stay' }).expect(201)).body;
    expect(dep.refundable).toBe(true); expect(cln.refundable).toBe(false);
    await admin.post(`/v1/fees/${cln.id}/archive`).expect(200);
    expect((await admin.get(`/v1/units/${unitId}/fees`).expect(200)).body.items.map((f: { kind: string }) => f.kind)).toEqual(['caution_deposit']);
  });

  it('allows adjacent manual blocks and refuses overlaps with 409', async () => {
    await admin.post('/v1/blocks').send({ unitId, start: '2026-11-01', end: '2026-11-03', reason: 'maintenance' }).expect(201);
    await admin.post('/v1/blocks').send({ unitId, start: '2026-11-03', end: '2026-11-04', reason: 'owner_stay' }).expect(201);
    const r = await admin.post('/v1/blocks').send({ unitId, start: '2026-11-02', end: '2026-11-05', reason: 'other' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DATES_UNAVAILABLE');
  });

  it('frontdesk can block; housekeeper cannot', async () => {
    const fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    await fd.post('/v1/blocks').send({ unitId, start: '2026-11-01', end: '2026-11-02', reason: 'maintenance' }).expect(201);
    const hk = (await signInAs(t, 'housekeeper', orgId)).agent;
    await hk.post('/v1/blocks').send({ unitId, start: '2026-11-05', end: '2026-11-06', reason: 'maintenance' }).expect(403);
  });

  it('deletes a manual block', async () => {
    const b = (await admin.post('/v1/blocks').send({ unitId, start: '2026-11-01', end: '2026-11-02', reason: 'maintenance' }).expect(201)).body;
    await admin.delete(`/v1/blocks/${b.id}`).expect(200);
  });
});
```
`apps/api/test/calendar.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';

describe('calendar [CAL-01 CAL-02]', () => {
  let t: TestApp; let admin: Agent; let orgId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await truncateAll(); orgId = (await seedOrg()).id; admin = (await signInAs(t, 'admin', orgId)).agent; });

  it('returns properties, units and overlapping blocks only', async () => {
    const p = await seedProperty(orgId, { name: 'The Rock' });
    const u = await seedUnit(orgId, p, { name: 'Kairo' });
    await admin.post('/v1/blocks').send({ unitId: u, start: '2026-10-30', end: '2026-11-02', reason: 'maintenance' }).expect(201);
    await admin.post('/v1/blocks').send({ unitId: u, start: '2026-12-01', end: '2026-12-02', reason: 'maintenance' }).expect(201);
    const r = (await admin.get('/v1/calendar?from=2026-11-01&to=2026-11-15').expect(200)).body;
    expect(r.properties).toEqual([{ id: p, name: 'The Rock', units: [expect.objectContaining({ id: u, name: 'Kairo' })] }]);
    expect(r.items).toEqual([expect.objectContaining({ kind: 'block', unitId: u, start: '2026-10-30', end: '2026-11-02', source: 'manual', label: 'Maintenance' })]);
    expect(r.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects invalid ranges', async () => {
    await admin.get('/v1/calendar?from=2026-11-10&to=2026-11-01').expect(400);
    await admin.get('/v1/calendar?from=2026-11-01&to=2027-01-10').expect(400);
  });

  it('archived units are hidden', async () => {
    const p = await seedProperty(orgId);
    const u = await seedUnit(orgId, p);
    await admin.post(`/v1/units/${u}/archive`).expect(200);
    const r = (await admin.get('/v1/calendar?from=2026-11-01&to=2026-11-15').expect(200)).body;
    expect(r.properties).toEqual([]);
  });

  it('housekeeper cannot read the calendar', async () => {
    const hk = (await signInAs(t, 'housekeeper', orgId)).agent;
    await hk.get('/v1/calendar?from=2026-11-01&to=2026-11-15').expect(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:int -- fees-blocks calendar`
Expected: FAIL — 404s.

- [ ] **Step 3: Implement fees**

`apps/api/src/modules/inventory/fees.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { UnitFee, UnitFeeInput } from '@boogbe/shared';
import type { UnitFee as Row } from '@prisma/client';
import { OrgDb } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { kobo } from './mappers';

const toFee = (r: Row): UnitFee => ({ id: r.id, unitId: r.unitId, kind: r.kind as UnitFee['kind'], label: r.label, amountKobo: kobo(r.amountKobo), basis: r.basis as UnitFee['basis'], includedGuests: r.includedGuests, refundable: r.refundable, active: r.active });

@Injectable()
export class FeesService {
  constructor(private readonly orgDb: OrgDb, private readonly audit: AuditService) {}

  list(ctx: OrgCtx, unitId: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      if (!(await tx.unit.findFirst({ where: { id: unitId } }))) throw notFound('Unit');
      return (await tx.unitFee.findMany({ where: { unitId, active: true }, orderBy: { createdAt: 'asc' } })).map(toFee);
    });
  }

  create(ctx: OrgCtx, unitId: string, input: UnitFeeInput) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      if (!(await tx.unit.findFirst({ where: { id: unitId } }))) throw notFound('Unit');
      const r = await tx.unitFee.create({ data: { id: newId(), unitId, kind: input.kind, label: input.label, amountKobo: BigInt(input.amountKobo), basis: input.basis, includedGuests: input.includedGuests ?? null, refundable: input.kind === 'caution_deposit', active: input.active } as never });
      await this.audit.record(tx, { actor: ctx, action: 'fee.create', entity: 'unit_fee', entityId: r.id, after: input });
      return toFee(r);
    });
  }

  update(ctx: OrgCtx, id: string, input: Partial<Pick<UnitFeeInput, 'label' | 'amountKobo' | 'includedGuests'>>) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const before = await tx.unitFee.findFirst({ where: { id } });
      if (!before) throw notFound('Fee');
      await tx.unitFee.updateMany({ where: { id }, data: { ...input, ...(input.amountKobo !== undefined && { amountKobo: BigInt(input.amountKobo) }) } });
      await this.audit.record(tx, { actor: ctx, action: 'fee.update', entity: 'unit_fee', entityId: id, before, after: input });
      return toFee((await tx.unitFee.findFirst({ where: { id } }))!);
    });
  }

  archive(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.unitFee.updateMany({ where: { id }, data: { active: false } });
      if (!r.count) throw notFound('Fee');
      await this.audit.record(tx, { actor: ctx, action: 'fee.archive', entity: 'unit_fee', entityId: id });
      return { ok: true };
    });
  }
}
```
`fees.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Kobo, UnitFeeInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { FeesService } from './fees.service';

class FeeDto extends createZodDto(UnitFeeInput) {}
class FeePatchDto extends createZodDto(z.object({ label: z.string().trim().min(2).max(60).optional(), amountKobo: Kobo.optional(), includedGuests: z.number().int().min(0).max(50).optional() }).strict()) {}

@Controller()
export class FeesController {
  constructor(private readonly svc: FeesService) {}
  @Get('units/:id/fees') @Permission('inventory.read') async list(@Ctx() c: RequestCtx, @Param('id') id: string) { return { items: await this.svc.list(requireOrg(c), id) }; }
  @Post('units/:id/fees') @Permission('inventory.write') create(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: FeeDto) { return this.svc.create(requireOrg(c), id, b); }
  @Patch('fees/:id') @Permission('inventory.write') update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: FeePatchDto) { return this.svc.update(requireOrg(c), id, b); }
  @Post('fees/:id/archive') @HttpCode(200) @Permission('inventory.write') archive(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.archive(requireOrg(c), id); }
}
```

- [ ] **Step 4: Implement calendar sources and blocks**

`apps/api/src/modules/calendar/calendar-sources.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { CalendarItem, IsoDate } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import type { OrgCtx } from '../../common/auth/request-ctx';

export interface Ignore { blockId?: string; bookingId?: string }
export interface CalendarSource {
  items(tx: OrgTx, unitIds: string[], from: IsoDate, to: IsoDate, ctx: OrgCtx): Promise<CalendarItem[]>;
  /** Returns the first hard conflict in [start, end) for the unit, or null. */
  conflicts?(tx: OrgTx, unitId: string, start: IsoDate, end: IsoDate, ignore?: Ignore): Promise<{ kind: 'booking' | 'block'; id: string } | null>;
}

@Injectable()
export class CalendarSources {
  private readonly sources: CalendarSource[] = [];
  register(s: CalendarSource) { this.sources.push(s); }
  all() { return this.sources; }
}
```
`apps/api/src/modules/inventory/blocks.service.ts`:
```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Block, BlockInput, CalendarItem, IsoDate } from '@boogbe/shared';
import type { Block as Row } from '@prisma/client';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { CalendarSources, type CalendarSource, type Ignore } from '../calendar/calendar-sources';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: IsoDate) => new Date(`${s}T00:00:00Z`);
const LABEL: Record<string, string> = { maintenance: 'Maintenance', owner_stay: 'Owner stay', other: 'Blocked', external: 'External booking' };
export const toBlock = (r: Row): Block => ({ id: r.id, unitId: r.unitId, start: iso(r.start), end: iso(r.end), source: r.source as Block['source'], reason: r.reason as Block['reason'], note: r.note, feedId: r.feedId, externalSummary: r.externalSummary });

@Injectable()
export class BlocksService implements CalendarSource, OnModuleInit {
  constructor(private readonly orgDb: OrgDb, private readonly audit: AuditService, private readonly sources: CalendarSources) {}
  onModuleInit() { this.sources.register(this); }

  async items(tx: OrgTx, unitIds: string[], from: IsoDate, to: IsoDate): Promise<CalendarItem[]> {
    const rows = await tx.block.findMany({ where: { unitId: { in: unitIds }, start: { lt: day(to) }, end: { gt: day(from) } }, orderBy: { start: 'asc' } });
    return rows.map((r) => ({ kind: 'block', id: r.id, unitId: r.unitId, start: iso(r.start), end: iso(r.end), source: r.source as 'manual' | 'ical', reason: r.reason, label: r.source === 'ical' ? (r.externalSummary ?? LABEL.external!) : LABEL[r.reason] ?? 'Blocked' }));
  }

  /** Only manual blocks are hard conflicts; iCal blocks are warnings (BKG-03). */
  async conflicts(tx: OrgTx, unitId: string, start: IsoDate, end: IsoDate, ignore?: Ignore) {
    const b = await tx.block.findFirst({ where: { unitId, source: 'manual', start: { lt: day(end) }, end: { gt: day(start) }, ...(ignore?.blockId && { id: { not: ignore.blockId } }) } });
    return b ? { kind: 'block' as const, id: b.id } : null;
  }

  /** Locks the unit row, then asks every calendar source for a hard conflict. Call inside the same tx as the write. */
  async assertUnitFree(tx: OrgTx, unitId: string, start: IsoDate, end: IsoDate, ignore?: Ignore) {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM unit WHERE id = ${unitId} AND active FOR UPDATE`;
    if (!locked.length) throw new AppError('VALIDATION_FAILED', 400, 'Unit not found or archived');
    for (const s of this.sources.all()) {
      const c = await s.conflicts?.(tx, unitId, start, end, ignore);
      if (c) throw new AppError('DATES_UNAVAILABLE', 409, 'Those dates are not available', c);
    }
  }

  create(ctx: OrgCtx, input: BlockInput): Promise<Block> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      await this.assertUnitFree(tx, input.unitId, input.start, input.end);
      const r = await tx.block.create({ data: { id: newId(), unitId: input.unitId, start: day(input.start), end: day(input.end), source: 'manual', reason: input.reason, note: input.note ?? null, createdByMemberId: ctx.memberId } as never });
      await this.audit.record(tx, { actor: ctx, action: 'block.create', entity: 'block', entityId: r.id, after: input });
      return toBlock(r);
    });
  }

  update(ctx: OrgCtx, id: string, input: Partial<Omit<BlockInput, 'unitId'>>): Promise<Block> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const b = await tx.block.findFirst({ where: { id } });
      if (!b) throw notFound('Block');
      if (b.source !== 'manual') throw new AppError('INVALID_TRANSITION', 422, 'Calendar-sync blocks are managed by the source calendar');
      const start = input.start ?? iso(b.start); const end = input.end ?? iso(b.end);
      if (end <= start) throw new AppError('VALIDATION_FAILED', 400, 'End must be after start');
      await this.assertUnitFree(tx, b.unitId, start, end, { blockId: id });
      await tx.block.updateMany({ where: { id }, data: { start: day(start), end: day(end), ...(input.reason && { reason: input.reason }), ...(input.note !== undefined && { note: input.note }) } });
      await this.audit.record(tx, { actor: ctx, action: 'block.update', entity: 'block', entityId: id, before: toBlock(b), after: input });
      return toBlock((await tx.block.findFirst({ where: { id } }))!);
    });
  }

  remove(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const b = await tx.block.findFirst({ where: { id } });
      if (!b) throw notFound('Block');
      if (b.source !== 'manual') throw new AppError('INVALID_TRANSITION', 422, 'Calendar-sync blocks are managed by the source calendar');
      await tx.block.deleteMany({ where: { id } });
      await this.audit.record(tx, { actor: ctx, action: 'block.delete', entity: 'block', entityId: id, before: toBlock(b) });
      return { ok: true };
    });
  }
}
```
`blocks.controller.ts`:
```ts
import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { BlockInput, BlockReason, IsoDateSchema } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { BlocksService } from './blocks.service';

class BlockDto extends createZodDto(BlockInput) {}
class BlockPatchDto extends createZodDto(z.object({ start: IsoDateSchema.optional(), end: IsoDateSchema.optional(), reason: BlockReason.optional(), note: z.string().max(500).nullable().optional() }).strict()) {}

@Controller('blocks')
export class BlocksController {
  constructor(private readonly svc: BlocksService) {}
  @Post() @Permission('bookings.write') create(@Ctx() c: RequestCtx, @Body() b: BlockDto) { return this.svc.create(requireOrg(c), b); }
  @Patch(':id') @Permission('bookings.write') update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: BlockPatchDto) { return this.svc.update(requireOrg(c), id, b); }
  @Delete(':id') @Permission('bookings.write') remove(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.remove(requireOrg(c), id); }
}
```
`apps/api/src/modules/calendar/calendar.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { todayIn, type CalendarQuery, type CalendarResponse } from '@boogbe/shared';
import { OrgDb } from '../../common/db/org-db.service';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { CalendarSources } from './calendar-sources';
import { kobo } from '../inventory/mappers';

@Injectable()
export class CalendarService {
  constructor(private readonly orgDb: OrgDb, private readonly sources: CalendarSources) {}

  get(ctx: OrgCtx, q: CalendarQuery): Promise<CalendarResponse> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const props = await tx.property.findMany({
        where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { units: { where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
      });
      const withUnits = props.filter((p) => p.units.length);
      const unitIds = withUnits.flatMap((p) => p.units.map((u) => u.id));
      const items = unitIds.length ? (await Promise.all(this.sources.all().map((s) => s.items(tx, unitIds, q.from, q.to, ctx)))).flat() : [];
      return {
        from: q.from, to: q.to, today: todayIn(ctx.timezone),
        properties: withUnits.map((p) => ({ id: p.id, name: p.name, units: p.units.map((u) => ({ id: u.id, name: u.name, bedrooms: u.bedrooms, maxGuests: u.maxGuests, nightlyRateKobo: kobo(u.nightlyRateKobo) })) })),
        items: items.sort((a, b) => a.start.localeCompare(b.start)),
      };
    });
  }
}
```
`calendar.controller.ts`:
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { CalendarQuery } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { CalendarService } from './calendar.service';

class Q extends createZodDto(CalendarQuery) {}
@Controller('calendar')
export class CalendarController {
  constructor(private readonly svc: CalendarService) {}
  @Get() @Permission('calendar.read') get(@Ctx() c: RequestCtx, @Query() q: Q) { return this.svc.get(requireOrg(c), q); }
}
```
`calendar.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarSources } from './calendar-sources';

@Global()
@Module({ controllers: [CalendarController], providers: [CalendarService, CalendarSources], exports: [CalendarSources] })
export class CalendarModule {}
```
Add `FeesController`, `BlocksController`, `FeesService`, `BlocksService` to `InventoryModule` (export `BlocksService`). Import `CalendarModule` in `AppModule` **before** `InventoryModule`.

Isolation fixtures:
```ts
ISOLATION_FIXTURES.fee = async (orgId) => {
  const unitId = await seedUnit(orgId, await seedProperty(orgId));
  const m = await migratorClient(); const id = newId();
  await m.query(`insert into unit_fee(id, org_id, unit_id, kind, label, amount_kobo, basis, updated_at) values ($1,$2,$3,'cleaning','Cleaning',100,'per_stay',now())`, [id, orgId, unitId]);
  await m.end(); return id;
};
ISOLATION_FIXTURES.block = async (orgId) => {
  const unitId = await seedUnit(orgId, await seedProperty(orgId));
  const m = await migratorClient(); const id = newId();
  await m.query(`insert into block(id, org_id, unit_id, start, "end", source, reason, updated_at) values ($1,$2,$3,'2030-01-01','2030-01-02','manual','maintenance',now())`, [id, orgId, unitId]);
  await m.end(); return id;
};
ROUTE_FIXTURE.push({ match: /^\/v1\/fees\//, fixture: 'fee' }, { match: /^\/v1\/blocks\//, fixture: 'block' });
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add apps/api
git commit -m "feat(calendar): unit fees, manual blocks with unit lock, calendar sources and endpoint [INV-05 INV-07 CAL-01 CAL-02]"
```

---

### Task 6 (T-M1-06) [ui]: Inventory settings — properties, units, fees, owners

**Files:**
- Create: `apps/app/src/features/inventory/{PropertiesPage.tsx,PropertyForm.tsx,PropertyDetail.tsx,UnitForm.tsx,UnitFees.tsx,UnitOwnerDialog.tsx,OwnersPage.tsx,OwnerForm.tsx,money-input.tsx,hooks.ts}`
- Create: `packages/ui/src/Dialog.tsx`, `packages/ui/src/Table.tsx`; export them
- Modify: `apps/app/src/router.tsx` (routes + nav)
- Test: `apps/app/src/features/inventory/money-input.test.tsx`, `apps/app/src/features/inventory/PropertyDetail.test.tsx`

**Interfaces:**
- Consumes contracts `Property`, `PropertyInput`, `Unit`, `UnitInput`, `UnitFee`, `UnitFeeInput`, `Owner`, `OwnerInput`, `SetUnitOwnerInput`, `SetPropertyOwnerInput`, endpoints from T-M1-04/05.
- Produces: `<MoneyInput value={kobo} onChange={(kobo) => …} />` (types naira with grouping, emits kobo integer; empty → `NaN` is never emitted — emits `0`); `<PercentInput valueBps onChange />` (types `15` → `1500` bps); `<Dialog open onClose title>`; `<Table columns rows />`; hooks `useProperties()`, `useUnits(propertyId?)`, `useOwners()`, `useUnitFees(unitId)` (SWR keys equal to the endpoint paths, so `mutate('/v1/units?propertyId=…')` refreshes).
- Routes: `/settings/properties`, `/settings/properties/:id`, `/settings/owners`. Nav: "Properties" (`inventory.read`), "Owners" (`owners.read`).

- [ ] **Step 1: Write failing tests**

`apps/app/src/features/inventory/money-input.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MoneyInput, PercentInput } from './money-input';

function Harness({ onValue }: { onValue: (v: number) => void }) {
  const [v, setV] = useState(0);
  return <MoneyInput aria-label="Rate" value={v} onChange={(k) => { setV(k); onValue(k); }} />;
}

describe('MoneyInput', () => {
  it('turns typed naira into kobo and shows grouping on blur', async () => {
    let last = -1;
    render(<Harness onValue={(v) => (last = v)} />);
    const input = screen.getByLabelText('Rate');
    await userEvent.type(input, '200000.5');
    expect(last).toBe(20_000_050);
    await userEvent.tab();
    expect(input).toHaveValue('200,000.50');
  });
  it('ignores letters', async () => {
    let last = -1;
    render(<Harness onValue={(v) => (last = v)} />);
    await userEvent.type(screen.getByLabelText('Rate'), 'abc');
    expect(last).toBe(0);
  });
});

describe('PercentInput', () => {
  it('emits basis points', async () => {
    let last = -1;
    function H() { const [v, setV] = useState(0); return <PercentInput aria-label="Fee" valueBps={v} onChange={(b) => { setV(b); last = b; }} />; }
    render(<H />);
    await userEvent.type(screen.getByLabelText('Fee'), '12.5');
    expect(last).toBe(1250);
  });
});
```
`apps/app/src/features/inventory/PropertyDetail.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { PropertyDetail } from './PropertyDetail';

const property = { id: 'p1', name: 'The Rock', address: 'Lekki', area: null, notes: null, sortOrder: 0, active: true, unitCount: 1, feeType: 'pct_gross', feeBps: 2000, feeFixedMonthlyKobo: 0, defaultOwnerId: null, defaultOwnerName: null };
const unit = { id: 'u1', propertyId: 'p1', name: 'Kairo', bedrooms: 2, maxGuests: 4, nightlyRateKobo: 20_000_000, defaultAssigneeMemberId: null, checkInInstructions: null, sortOrder: 0, active: true, feeOverride: false, feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 0, ownerFollowsProperty: true, currentOwner: { id: 'o1', name: 'Mrs Adebayo' }, currentOwnerSource: 'property' };

vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api: vi.fn(async (path: string) => path.startsWith('/v1/properties/') ? property : path.startsWith('/v1/units') ? { items: [unit] } : { items: [] }),
}));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }) }));

describe('PropertyDetail', () => {
  it('lists units with rate, owner and where the owner comes from', async () => {
    render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter initialEntries={['/settings/properties/p1']}><Routes><Route path="/settings/properties/:id" element={<PropertyDetail />} /></Routes></MemoryRouter></SWRConfig>);
    expect(await screen.findByText('Kairo')).toBeInTheDocument();
    expect(screen.getByText('₦200,000 / night')).toBeInTheDocument();
    expect(screen.getByText('Mrs Adebayo (from property)')).toBeInTheDocument();
    expect(screen.getByText('20% of gross')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @boogbe/app test`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement primitives and inputs**

`packages/ui/src/Dialog.tsx`:
```tsx
import { useEffect, useRef, type ReactNode } from 'react';
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dlg-title" className="w-[min(560px,calc(100vw-32px))] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink backdrop:bg-black/40">
      <div className="flex items-center justify-between border-b border-line p-4"><h2 id="dlg-title" className="font-semibold">{title}</h2><button aria-label="Close" onClick={onClose} className="min-h-11 min-w-11">✕</button></div>
      <div className="max-h-[75dvh] overflow-y-auto p-4">{open && children}</div>
    </dialog>
  );
}
```
`packages/ui/src/Table.tsx`:
```tsx
import type { ReactNode } from 'react';
export interface Column<T> { key: string; header: string; cell: (row: T) => ReactNode; className?: string }
export function Table<T extends { id: string }>({ columns, rows, onRowClick }: { columns: Column<T>[]; rows: T[]; onRowClick?: (r: T) => void }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-2 text-ink-muted"><tr>{columns.map((c) => <th key={c.key} scope="col" className={`px-3 py-2 font-medium ${c.className ?? ''}`}>{c.header}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} onClick={onRowClick && (() => onRowClick(r))} className={onRowClick ? 'cursor-pointer border-t border-line hover:bg-surface-2' : 'border-t border-line'}>
            {columns.map((c) => <td key={c.key} className={`px-3 py-2 ${c.className ?? ''}`}>{c.cell(r)}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
```
Export both from `packages/ui/src/index.ts`.

`apps/app/src/features/inventory/money-input.tsx`:
```tsx
import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { Input } from '@boogbe/ui';

const group = new Intl.NumberFormat('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const toText = (kobo: number) => (kobo ? (kobo % 100 ? group.format(kobo / 100).replace(/\.(\d)$/, '.$10') : group.format(kobo / 100)) : '');
const parse = (s: string) => { const clean = s.replace(/[^\d.]/g, ''); const [n = '', d = ''] = clean.split('.'); return Number(n || 0) * 100 + Number((d + '00').slice(0, 2)); };

type Base = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;

export function MoneyInput({ value, onChange, ...rest }: Base & { value: number; onChange: (kobo: number) => void }) {
  const [text, setText] = useState(toText(value));
  useEffect(() => { if (parse(text) !== value) setText(toText(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">₦</span>
      <Input {...rest} inputMode="decimal" className="pl-7" value={text}
        onChange={(e) => { const t = e.target.value.replace(/[^\d.,]/g, ''); setText(t); onChange(parse(t)); }}
        onBlur={(e) => { setText(toText(parse(text))); rest.onBlur?.(e); }} />
    </div>
  );
}

export function PercentInput({ valueBps, onChange, ...rest }: Base & { valueBps: number; onChange: (bps: number) => void }) {
  const [text, setText] = useState(valueBps ? String(valueBps / 100) : '');
  return (
    <div className="relative">
      <Input {...rest} inputMode="decimal" className="pr-8" value={text}
        onChange={(e) => { const t = e.target.value.replace(/[^\d.]/g, ''); setText(t); onChange(Math.min(10_000, Math.round(Number(t || 0) * 100))); }} />
      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted">%</span>
    </div>
  );
}

export const feeSummary = (f: { feeType: string; feeBps: number; feeFixedMonthlyKobo: number }, money: (k: number) => string) => {
  const pct = `${f.feeBps / 100}%`;
  const base = f.feeType === 'pct_gross' ? `${pct} of gross` : f.feeType === 'pct_net' ? `${pct} of net` : 'No commission';
  return f.feeFixedMonthlyKobo ? `${base} + ${money(f.feeFixedMonthlyKobo)}/month` : base;
};
```
`toText` correction: implement as `kobo ? group.format(kobo / 100) : ''` but with `minimumFractionDigits: kobo % 100 ? 2 : 0` — replace the regex trick with:
```ts
const toText = (kobo: number) => kobo ? new Intl.NumberFormat('en-NG', { minimumFractionDigits: kobo % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(kobo / 100) : '';
```
(and delete the `group` constant).

`apps/app/src/features/inventory/hooks.ts`:
```ts
import { z } from 'zod';
import { Owner, Property, Unit, UnitFee } from '@boogbe/shared';
import { useApi } from '../../lib/api';

export const useProperties = (includeArchived = false) => useApi(`/v1/properties${includeArchived ? '?includeArchived=true' : ''}`, z.object({ items: z.array(Property) }));
export const useProperty = (id: string) => useApi(`/v1/properties/${id}`, Property);
export const useUnits = (propertyId?: string) => useApi(`/v1/units${propertyId ? `?propertyId=${propertyId}&includeArchived=true` : ''}`, z.object({ items: z.array(Unit) }));
export const useOwners = (enabled = true) => useApi(enabled ? '/v1/owners' : null, z.object({ items: z.array(Owner) }));
export const useUnitFees = (unitId: string | null) => useApi(unitId ? `/v1/units/${unitId}/fees` : null, z.object({ items: z.array(UnitFee) }));
```

- [ ] **Step 4: Implement pages**

`apps/app/src/features/inventory/PropertiesPage.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { can } from '@boogbe/shared';
import { Badge, Button, Dialog, EmptyState, Spinner, Table } from '@boogbe/ui';
import { formatNaira } from '../../lib/format';
import { useMe } from '../../lib/use-me';
import { useProperties } from './hooks';
import { PropertyForm } from './PropertyForm';
import { feeSummary } from './money-input';

export function PropertiesPage() {
  const { data, mutate } = useProperties(true); const nav = useNavigate(); const { me } = useMe();
  const [open, setOpen] = useState(false);
  const canWrite = !!me?.activeOrg && can(me.activeOrg.role, 'inventory.write');
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Properties</h1>{canWrite && <Button onClick={() => setOpen(true)}>Add property</Button>}</div>
      {data.items.length === 0 ? <EmptyState title="No properties yet" body="Add a building or address, then its units." /> : (
        <Table rows={data.items} onRowClick={(p) => nav(`/settings/properties/${p.id}`)} columns={[
          { key: 'name', header: 'Property', cell: (p) => <span className="font-medium">{p.name}</span> },
          { key: 'units', header: 'Units', cell: (p) => p.unitCount },
          { key: 'owner', header: 'Default owner', cell: (p) => p.defaultOwnerName ?? 'Operator' },
          { key: 'fee', header: 'Management fee', cell: (p) => feeSummary(p, formatNaira) },
          { key: 'status', header: '', cell: (p) => !p.active && <Badge>Archived</Badge> },
        ]} />
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Add property">
        <PropertyForm onSaved={async (p) => { setOpen(false); await mutate(); nav(`/settings/properties/${p.id}`); }} />
      </Dialog>
    </div>
  );
}
```
`apps/app/src/features/inventory/PropertyForm.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { Property, PropertyInput } from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api } from '../../lib/api';
import { MoneyInput, PercentInput } from './money-input';

export function PropertyForm({ initial, onSaved }: { initial?: Property; onSaved: (p: Property) => void }) {
  const f = useForm<PropertyInput>({
    resolver: zodResolver(PropertyInput) as never,
    defaultValues: initial ?? { name: '', address: '', feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 0, sortOrder: 0 },
  });
  const feeType = f.watch('feeType');
  const e = f.formState.errors;
  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={f.handleSubmit(async (v) => {
      const p = await api(initial ? `/v1/properties/${initial.id}` : '/v1/properties', { method: initial ? 'PATCH' : 'POST', body: v, schema: Property });
      onSaved(p);
    })}>
      <Field label="Name" error={e.name?.message}><Input {...f.register('name')} /></Field>
      <Field label="Address" error={e.address?.message}><Input {...f.register('address')} /></Field>
      <Field label="Area" hint="e.g. Lekki Phase 1"><Input {...f.register('area')} /></Field>
      <Field label="Management fee"><Select {...f.register('feeType')}><option value="none">No commission</option><option value="pct_gross">% of gross income</option><option value="pct_net">% of net income (after expenses)</option></Select></Field>
      {feeType !== 'none' && <Controller control={f.control} name="feeBps" render={({ field }) => <Field label="Commission" error={e.feeBps?.message}><PercentInput valueBps={field.value} onChange={field.onChange} /></Field>} />}
      <Controller control={f.control} name="feeFixedMonthlyKobo" render={({ field }) => <Field label="Fixed monthly fee (optional)"><MoneyInput value={field.value} onChange={field.onChange} /></Field>} />
      <Button type="submit" loading={f.formState.isSubmitting}>Save</Button>
    </form>
  );
}
```
`apps/app/src/features/inventory/UnitForm.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { Unit, UnitInput } from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { MoneyInput, PercentInput } from './money-input';

export function UnitForm({ propertyId, initial, onSaved }: { propertyId: string; initial?: Unit; onSaved: (u: Unit) => void }) {
  const f = useForm<UnitInput>({
    resolver: zodResolver(UnitInput) as never,
    defaultValues: initial ?? { propertyId, name: '', bedrooms: 1, maxGuests: 2, nightlyRateKobo: 0, defaultAssigneeMemberId: null, feeOverride: false, feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 0, sortOrder: 0 },
  });
  const override = f.watch('feeOverride'); const e = f.formState.errors;
  return (
    <form noValidate className="grid gap-4 md:grid-cols-2" onSubmit={f.handleSubmit(async (v) => {
      try { onSaved(await api(initial ? `/v1/units/${initial.id}` : '/v1/units', { method: initial ? 'PATCH' : 'POST', body: v, schema: Unit })); }
      catch (err) { if (err instanceof ApiError && err.code === 'CONFLICT') f.setError('name', { message: 'A unit with this name already exists here' }); else throw err; }
    })}>
      <Field label="Unit name" error={e.name?.message}><Input {...f.register('name')} /></Field>
      <Controller control={f.control} name="nightlyRateKobo" render={({ field }) => <Field label="Nightly rate" error={e.nightlyRateKobo?.message}><MoneyInput value={field.value} onChange={field.onChange} /></Field>} />
      <Field label="Bedrooms" error={e.bedrooms?.message}><Input type="number" min={0} {...f.register('bedrooms', { valueAsNumber: true })} /></Field>
      <Field label="Max guests" error={e.maxGuests?.message}><Input type="number" min={1} {...f.register('maxGuests', { valueAsNumber: true })} /></Field>
      <Field label="Check-in instructions" hint="Sent to guests the day before arrival. Owners never see this."><textarea className="min-h-24 rounded-lg border border-line bg-surface p-3" {...f.register('checkInInstructions')} /></Field>
      <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" {...f.register('feeOverride')} />Use a different management fee for this unit</label>
      {override && <>
        <Field label="Management fee"><Select {...f.register('feeType')}><option value="none">No commission</option><option value="pct_gross">% of gross</option><option value="pct_net">% of net</option></Select></Field>
        <Controller control={f.control} name="feeBps" render={({ field }) => <Field label="Commission"><PercentInput valueBps={field.value} onChange={field.onChange} /></Field>} />
        <Controller control={f.control} name="feeFixedMonthlyKobo" render={({ field }) => <Field label="Fixed monthly fee"><MoneyInput value={field.value} onChange={field.onChange} /></Field>} />
      </>}
      <Button type="submit" loading={f.formState.isSubmitting} className="md:col-span-2">Save unit</Button>
    </form>
  );
}
```
`apps/app/src/features/inventory/UnitOwnerDialog.tsx`:
```tsx
import { useState } from 'react';
import { todayIn, type Unit } from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api } from '../../lib/api';
import { useMe } from '../../lib/use-me';
import { useOwners } from './hooks';

export function UnitOwnerForm({ unit, onSaved }: { unit: Unit; onSaved: () => void }) {
  const { me } = useMe(); const { data } = useOwners();
  const [mode, setMode] = useState<'property' | 'owner' | 'operator'>(unit.ownerFollowsProperty ? 'property' : unit.currentOwner ? 'owner' : 'operator');
  const [ownerId, setOwnerId] = useState(unit.currentOwner?.id ?? '');
  const [from, setFrom] = useState(todayIn(me?.activeOrg?.timezone ?? 'Africa/Lagos'));
  const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(undefined);
      try { await api(`/v1/units/${unit.id}/owner`, { method: 'POST', body: mode === 'owner' ? { mode, ownerId, effectiveFrom: from } : { mode, effectiveFrom: from } }); onSaved(); }
      catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
    }}>
      <Field label="Who owns this unit?"><Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
        <option value="property">Same as the property</option><option value="owner">A specific owner</option><option value="operator">The operator (self-owned)</option>
      </Select></Field>
      {mode === 'owner' && <Field label="Owner"><Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} required><option value="">Choose…</option>{data?.items.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>}
      <Field label="From" hint="Statements use the owner on each night"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button type="submit" loading={busy}>Save</Button>
    </form>
  );
}
```
`apps/app/src/features/inventory/UnitFees.tsx`:
```tsx
import { useState } from 'react';
import { UnitFeeInput, type UnitFee } from '@boogbe/shared';
import { Badge, Button, Field, Input, Select } from '@boogbe/ui';
import { api } from '../../lib/api';
import { formatNaira } from '../../lib/format';
import { useUnitFees } from './hooks';
import { MoneyInput } from './money-input';

const BASIS = { per_stay: 'per stay', per_night: 'per night', per_guest_night: 'per extra guest per night' } as const;

export function UnitFees({ unitId, canWrite }: { unitId: string; canWrite: boolean }) {
  const { data, mutate } = useUnitFees(unitId);
  const [draft, setDraft] = useState<UnitFeeInput>({ kind: 'cleaning', label: 'Cleaning fee', amountKobo: 0, basis: 'per_stay', active: true });
  const [err, setErr] = useState<string>();
  const presets: Record<UnitFeeInput['kind'], Partial<UnitFeeInput>> = {
    caution_deposit: { label: 'Caution deposit', basis: 'per_stay', includedGuests: undefined },
    cleaning: { label: 'Cleaning fee', basis: 'per_stay', includedGuests: undefined },
    extra_guest: { label: 'Extra guest', basis: 'per_guest_night', includedGuests: 2 },
    other: { label: 'Other fee', basis: 'per_stay', includedGuests: undefined },
  };
  return (
    <div className="flex flex-col gap-2">
      {data?.items.map((f: UnitFee) => (
        <div key={f.id} className="flex items-center justify-between text-sm">
          <span>{f.label} · {formatNaira(f.amountKobo)} {BASIS[f.basis]}{f.includedGuests !== null && ` (after ${f.includedGuests} guests)`} {f.refundable && <Badge tone="info">Refundable</Badge>}</span>
          {canWrite && <Button variant="ghost" onClick={async () => { await api(`/v1/fees/${f.id}/archive`, { method: 'POST' }); await mutate(); }}>Remove</Button>}
        </div>
      ))}
      {canWrite && (
        <form className="grid gap-2 md:grid-cols-[160px_1fr_160px_auto]" onSubmit={async (e) => {
          e.preventDefault(); setErr(undefined);
          const parsed = UnitFeeInput.safeParse(draft);
          if (!parsed.success) return setErr(parsed.error.issues[0]?.message);
          await api(`/v1/units/${unitId}/fees`, { method: 'POST', body: parsed.data }); await mutate();
        }}>
          <Field label="Type"><Select value={draft.kind} onChange={(e) => { const kind = e.target.value as UnitFeeInput['kind']; setDraft({ ...draft, kind, ...presets[kind] } as UnitFeeInput); }}>
            <option value="caution_deposit">Caution deposit</option><option value="cleaning">Cleaning</option><option value="extra_guest">Extra guest</option><option value="other">Other</option>
          </Select></Field>
          <Field label="Label"><Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Field>
          <Field label="Amount"><MoneyInput value={draft.amountKobo} onChange={(k) => setDraft({ ...draft, amountKobo: k })} /></Field>
          <Button type="submit" className="self-end">Add fee</Button>
          {draft.kind === 'extra_guest' && <Field label="Guests included in the rate"><Input type="number" min={0} value={draft.includedGuests ?? 0} onChange={(e) => setDraft({ ...draft, includedGuests: Number(e.target.value) })} /></Field>}
          {draft.kind === 'other' && <Field label="Charged"><Select value={draft.basis} onChange={(e) => setDraft({ ...draft, basis: e.target.value as UnitFeeInput['basis'] })}><option value="per_stay">Per stay</option><option value="per_night">Per night</option></Select></Field>}
          {err && <p role="alert" className="text-sm text-danger md:col-span-4">{err}</p>}
        </form>
      )}
    </div>
  );
}
```
`apps/app/src/features/inventory/PropertyDetail.tsx`:
```tsx
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { can, type Unit } from '@boogbe/shared';
import { Badge, Button, Card, Dialog, EmptyState, Spinner } from '@boogbe/ui';
import { api } from '../../lib/api';
import { formatNaira } from '../../lib/format';
import { useMe } from '../../lib/use-me';
import { useProperty, useUnits } from './hooks';
import { feeSummary } from './money-input';
import { PropertyForm } from './PropertyForm';
import { UnitFees } from './UnitFees';
import { UnitForm } from './UnitForm';
import { UnitOwnerForm } from './UnitOwnerDialog';

const SOURCE = { unit: '', property: ' (from property)', operator: '' } as const;

export function PropertyDetail() {
  const { id = '' } = useParams(); const { me } = useMe();
  const { data: p, mutate: mutateP } = useProperty(id);
  const { data: units, mutate: mutateU } = useUnits(id);
  const [dialog, setDialog] = useState<null | { kind: 'edit' } | { kind: 'unit'; unit?: Unit } | { kind: 'owner'; unit: Unit } | { kind: 'fees'; unit: Unit }>(null);
  const role = me?.activeOrg?.role; const canWrite = !!role && can(role, 'inventory.write'); const canOwners = !!role && can(role, 'owners.write');
  if (!p || !units) return <Spinner />;
  const close = () => setDialog(null);
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-xl font-semibold">{p.name}</h1><p className="text-sm text-ink-muted">{p.address}</p><p className="mt-1 text-sm">{feeSummary(p, formatNaira)}</p></div>
        {canWrite && <div className="flex gap-2"><Button variant="secondary" onClick={() => setDialog({ kind: 'edit' })}>Edit</Button><Button onClick={() => setDialog({ kind: 'unit' })}>Add unit</Button></div>}
      </Card>
      {units.items.length === 0 ? <EmptyState title="No units yet" body="Add the apartments guests can book." /> : units.items.map((u) => (
        <Card key={u.id} className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">{u.name} {!u.active && <Badge>Archived</Badge>}</p>
            <p className="text-sm text-ink-muted">{u.bedrooms} bed · up to {u.maxGuests} guests · {formatNaira(u.nightlyRateKobo)} / night</p>
            <p className="text-sm">{u.currentOwner ? `${u.currentOwner.name}${SOURCE[u.currentOwnerSource]}` : 'Operator-owned'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canWrite && <Button variant="ghost" onClick={() => setDialog({ kind: 'unit', unit: u })}>Edit</Button>}
            <Button variant="ghost" onClick={() => setDialog({ kind: 'fees', unit: u })}>Fees</Button>
            {canOwners && <Button variant="ghost" onClick={() => setDialog({ kind: 'owner', unit: u })}>Owner</Button>}
            {canWrite && <Button variant="ghost" onClick={async () => { await api(`/v1/units/${u.id}/${u.active ? 'archive' : 'unarchive'}`, { method: 'POST' }); await mutateU(); }}>{u.active ? 'Archive' : 'Restore'}</Button>}
          </div>
        </Card>
      ))}
      <Dialog open={dialog?.kind === 'edit'} onClose={close} title="Edit property"><PropertyForm initial={p} onSaved={async () => { close(); await mutateP(); }} /></Dialog>
      <Dialog open={dialog?.kind === 'unit'} onClose={close} title={dialog?.kind === 'unit' && dialog.unit ? 'Edit unit' : 'Add unit'}>
        {dialog?.kind === 'unit' && <UnitForm propertyId={p.id} initial={dialog.unit} onSaved={async () => { close(); await mutateU(); await mutateP(); }} />}
      </Dialog>
      <Dialog open={dialog?.kind === 'owner'} onClose={close} title="Unit owner">{dialog?.kind === 'owner' && <UnitOwnerForm unit={dialog.unit} onSaved={async () => { close(); await mutateU(); }} />}</Dialog>
      <Dialog open={dialog?.kind === 'fees'} onClose={close} title="Fees">{dialog?.kind === 'fees' && <UnitFees unitId={dialog.unit.id} canWrite={canWrite} />}</Dialog>
    </div>
  );
}
```
`apps/app/src/features/inventory/OwnerForm.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Owner, OwnerInput } from '@boogbe/shared';
import { Button, Field, Input } from '@boogbe/ui';
import { api } from '../../lib/api';

export function OwnerForm({ initial, onSaved }: { initial?: Owner; onSaved: (o: Owner) => void }) {
  const f = useForm<OwnerInput>({ resolver: zodResolver(OwnerInput) as never, defaultValues: initial ?? { name: '' } });
  const e = f.formState.errors;
  const opt = { setValueAs: (v: string) => v || null };
  return (
    <form noValidate className="grid gap-4 md:grid-cols-2" onSubmit={f.handleSubmit(async (v) => onSaved(await api(initial ? `/v1/owners/${initial.id}` : '/v1/owners', { method: initial ? 'PATCH' : 'POST', body: v, schema: Owner })))}>
      <Field label="Full name" error={e.name?.message}><Input {...f.register('name')} /></Field>
      <Field label="Phone" hint="+234…" error={e.phone?.message}><Input {...f.register('phone', opt)} /></Field>
      <Field label="Email" hint="Needed to invite them to the owner portal" error={e.email?.message}><Input type="email" {...f.register('email', opt)} /></Field>
      <Field label="Bank" error={e.bankName?.message}><Input {...f.register('bankName', opt)} /></Field>
      <Field label="Account number" error={e.accountNumber?.message}><Input inputMode="numeric" maxLength={10} {...f.register('accountNumber', opt)} /></Field>
      <Field label="Account name" error={e.accountName?.message}><Input {...f.register('accountName', opt)} /></Field>
      <Button type="submit" loading={f.formState.isSubmitting} className="md:col-span-2">Save owner</Button>
    </form>
  );
}
```
`apps/app/src/features/inventory/OwnersPage.tsx`:
```tsx
import { useState } from 'react';
import type { Owner } from '@boogbe/shared';
import { Badge, Button, Dialog, EmptyState, Spinner, Table } from '@boogbe/ui';
import { api } from '../../lib/api';
import { useOwners } from './hooks';
import { OwnerForm } from './OwnerForm';

const PORTAL = { none: <Badge>No portal</Badge>, invited: <Badge tone="warning">Invited</Badge>, active: <Badge tone="success">Portal active</Badge> };

export function OwnersPage() {
  const { data, mutate } = useOwners(); const [edit, setEdit] = useState<Owner | 'new' | null>(null); const [msg, setMsg] = useState<string>();
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Property owners</h1><Button onClick={() => setEdit('new')}>Add owner</Button></div>
      {msg && <p role="status" className="text-sm">{msg}</p>}
      {data.items.length === 0 ? <EmptyState title="No owners yet" body="Add the people whose properties you manage." /> : (
        <Table rows={data.items} onRowClick={(o) => setEdit(o)} columns={[
          { key: 'name', header: 'Name', cell: (o) => o.name },
          { key: 'contact', header: 'Contact', cell: (o) => o.phone ?? o.email ?? '—' },
          { key: 'bank', header: 'Bank', cell: (o) => (o.bankName ? `${o.bankName} · ${o.accountNumber ?? ''}` : '—') },
          { key: 'portal', header: 'Portal', cell: (o) => PORTAL[o.portalStatus] },
          { key: 'act', header: '', cell: (o) => o.portalStatus === 'none' && o.email && <Button variant="ghost" onClick={async (e) => { e.stopPropagation(); await api(`/v1/owners/${o.id}/invite`, { method: 'POST' }); setMsg(`Invitation sent to ${o.email}`); await mutate(); }}>Invite</Button> },
        ]} />
      )}
      <Dialog open={edit !== null} onClose={() => setEdit(null)} title={edit === 'new' ? 'Add owner' : 'Edit owner'}>
        {edit !== null && <OwnerForm initial={edit === 'new' ? undefined : edit} onSaved={async () => { setEdit(null); await mutate(); }} />}
      </Dialog>
    </div>
  );
}
```
Router additions (inside the `RequireAuth` children):
```tsx
{ path: '/settings/properties', element: operator(<PropertiesPage />) },
{ path: '/settings/properties/:id', element: operator(<PropertyDetail />) },
{ path: '/settings/owners', element: operator(<OwnersPage />) },
```
`OPERATOR_NAV` additions (after Calendar): `{ to: '/settings/properties', label: 'Properties', icon: Building2, permission: 'inventory.read' }`, `{ to: '/settings/owners', label: 'Owners', icon: UserRound, permission: 'owners.read' }` (import icons from `lucide-react`).

- [ ] **Step 5: Run tests and build**

Run: `pnpm --filter @boogbe/app test && pnpm --filter @boogbe/app build`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add apps/app packages/ui
git commit -m "feat(app): properties, units, fees and owners settings [INV-01..06]"
```

---

### Task 7 (T-M1-07) [ui]: Calendar grid (desktop) and day list (mobile), blocks

**Files:**
- Create: `apps/app/src/features/calendar/{CalendarPage.tsx,CalendarGrid.tsx,DayList.tsx,BlockDialog.tsx,layout.ts,use-calendar.ts}`
- Modify: `apps/app/src/router.tsx` (`/calendar` → `CalendarPage`)
- Test: `apps/app/src/features/calendar/layout.test.ts`, `apps/app/src/features/calendar/CalendarGrid.test.tsx`

**Interfaces:**
- `layoutBars(items: CalendarItem[], from: IsoDate, days: number): Array<{ item: CalendarItem; col: number; span: number; clippedStart: boolean; clippedEnd: boolean }>` — `col` 0-based day index clamped to the window; `span ≥ 1`.
- `useCalendar(from: IsoDate, days: number)` → SWR on `/v1/calendar?from&to`.
- `<CalendarGrid data onEmptySelect={(unitId, start, end) => void} onItemClick={(item) => void} />` — desktop: sticky unit column, 1 column per day, drag across cells to select a range; `onEmptySelect` fires on mouseup. Mobile (`<768px` via `matchMedia`) renders `<DayList>`: arrivals, departures, in-house, blocked for the selected day, with "New booking" and "Block dates" buttons.
- M2 replaces the `onEmptySelect` handler body (currently opens `BlockDialog` with prefilled unit/dates and a "Booking comes in M2" choice hidden) — in M1 it opens `BlockDialog` directly.

- [ ] **Step 1: Write failing tests**

`apps/app/src/features/calendar/layout.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { CalendarItem } from '@boogbe/shared';
import { layoutBars } from './layout';

const block = (start: string, end: string): CalendarItem => ({ kind: 'block', id: start, unitId: 'u', start, end, source: 'manual', reason: 'maintenance', label: 'Maintenance' });

describe('layoutBars', () => {
  it('positions an item fully inside the window', () => {
    expect(layoutBars([block('2026-11-03', '2026-11-05')], '2026-11-01', 14)[0]).toMatchObject({ col: 2, span: 2, clippedStart: false, clippedEnd: false });
  });
  it('clips items that start before or end after the window', () => {
    expect(layoutBars([block('2026-10-28', '2026-11-02')], '2026-11-01', 14)[0]).toMatchObject({ col: 0, span: 1, clippedStart: true });
    expect(layoutBars([block('2026-11-13', '2026-11-20')], '2026-11-01', 14)[0]).toMatchObject({ col: 12, span: 2, clippedEnd: true });
  });
  it('drops items outside the window', () => {
    expect(layoutBars([block('2026-12-01', '2026-12-02')], '2026-11-01', 14)).toEqual([]);
  });
});
```
`apps/app/src/features/calendar/CalendarGrid.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarResponse } from '@boogbe/shared';
import { CalendarGrid } from './CalendarGrid';

const data: CalendarResponse = {
  from: '2026-11-01', to: '2026-11-15', today: '2026-11-02',
  properties: [{ id: 'p', name: 'The Rock', units: [{ id: 'u1', name: 'Kairo', bedrooms: 2, maxGuests: 4, nightlyRateKobo: 20_000_000 }] }],
  items: [{ kind: 'block', id: 'b1', unitId: 'u1', start: '2026-11-03', end: '2026-11-05', source: 'manual', reason: 'maintenance', label: 'Maintenance' }],
};

describe('CalendarGrid', () => {
  it('renders units, today marker and bars', () => {
    render(<CalendarGrid data={data} onEmptySelect={vi.fn()} onItemClick={vi.fn()} />);
    expect(screen.getByRole('rowheader', { name: /Kairo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Maintenance, 3 Nov – 5 Nov/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /2 Nov.*today/i })).toBeInTheDocument();
  });
  it('drag-selects empty cells into a range', () => {
    const onEmptySelect = vi.fn();
    render(<CalendarGrid data={data} onEmptySelect={onEmptySelect} onItemClick={vi.fn()} />);
    fireEvent.mouseDown(screen.getByTestId('cell-u1-2026-11-06'));
    fireEvent.mouseEnter(screen.getByTestId('cell-u1-2026-11-08'));
    fireEvent.mouseUp(screen.getByTestId('cell-u1-2026-11-08'));
    expect(onEmptySelect).toHaveBeenCalledWith('u1', '2026-11-06', '2026-11-09');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @boogbe/app test`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/app/src/features/calendar/layout.ts`:
```ts
import { addDays, nightsBetween, type CalendarItem, type IsoDate } from '@boogbe/shared';

export function layoutBars(items: CalendarItem[], from: IsoDate, days: number) {
  const to = addDays(from, days);
  return items
    .filter((i) => i.start < to && i.end > from)
    .map((item) => {
      const s = item.start < from ? from : item.start;
      const e = item.end > to ? to : item.end;
      return { item, col: s === from ? 0 : nightsBetween(from, s), span: nightsBetween(s, e), clippedStart: item.start < from, clippedEnd: item.end > to };
    });
}
```
`apps/app/src/features/calendar/use-calendar.ts`:
```ts
import { addDays, CalendarResponse, type IsoDate } from '@boogbe/shared';
import { useApi } from '../../lib/api';
export const calendarKey = (from: IsoDate, days: number) => `/v1/calendar?from=${from}&to=${addDays(from, days)}`;
export const useCalendar = (from: IsoDate, days: number) => useApi(calendarKey(from, days), CalendarResponse);
```
`apps/app/src/features/calendar/CalendarGrid.tsx`:
```tsx
import clsx from 'clsx';
import { useState } from 'react';
import { addDays, eachNight, type CalendarItem, type CalendarResponse } from '@boogbe/shared';
import { formatDate } from '../../lib/format';
import { layoutBars } from './layout';

const CELL = 44; // px per day
const short = (d: string) => formatDate(d).replace(/ \d{4}$/, '');
const TONE: Record<string, string> = {
  tentative: 'bg-warning/20 text-warning border-warning', confirmed: 'bg-brand/15 text-brand border-brand', checked_in: 'bg-success/20 text-success border-success',
  checked_out: 'bg-surface-2 text-ink-muted border-line', manual: 'bg-[repeating-linear-gradient(45deg,var(--color-line)_0_6px,transparent_6px_12px)] text-ink border-line', ical: 'bg-surface-2 text-ink-muted border-line',
};
const tone = (i: CalendarItem) => (i.kind === 'booking' ? TONE[i.status] : TONE[i.source]) ?? '';
const label = (i: CalendarItem) => (i.kind === 'booking' ? `${i.guestName ?? 'Guest'} · ${i.ref}` : i.label);

export function CalendarGrid({ data, onEmptySelect, onItemClick }: {
  data: CalendarResponse; onEmptySelect: (unitId: string, start: string, end: string) => void; onItemClick: (i: CalendarItem) => void;
}) {
  const days = eachNight(data.from, data.to);
  const [drag, setDrag] = useState<{ unitId: string; a: string; b: string } | null>(null);
  const inDrag = (u: string, d: string) => !!drag && drag.unitId === u && d >= (drag.a < drag.b ? drag.a : drag.b) && d <= (drag.a < drag.b ? drag.b : drag.a);
  const finish = () => {
    if (!drag) return;
    const [s, e] = drag.a < drag.b ? [drag.a, drag.b] : [drag.b, drag.a];
    setDrag(null); onEmptySelect(drag.unitId, s, addDays(e, 1));
  };
  return (
    <div role="grid" aria-label="Calendar" className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface" onMouseLeave={() => setDrag(null)}>
      <div style={{ minWidth: 180 + days.length * CELL }}>
        <div role="row" className="sticky top-0 z-10 flex border-b border-line bg-surface">
          <div className="sticky left-0 w-[180px] shrink-0 bg-surface" />
          {days.map((d) => (
            <div role="columnheader" key={d} aria-label={`${short(d)}${d === data.today ? ' today' : ''}`} style={{ width: CELL }}
              className={clsx('shrink-0 py-1 text-center text-xs', d === data.today ? 'font-semibold text-brand' : 'text-ink-muted')}>
              {new Date(`${d}T00:00:00Z`).toLocaleDateString('en-NG', { weekday: 'narrow', timeZone: 'UTC' })}<br />{Number(d.slice(8))}
            </div>
          ))}
        </div>
        {data.properties.map((p) => (
          <div key={p.id}>
            <div className="sticky left-0 bg-surface-2 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{p.name}</div>
            {p.units.map((u) => {
              const bars = layoutBars(data.items.filter((i) => i.unitId === u.id), data.from, days.length);
              return (
                <div role="row" key={u.id} className="relative flex border-t border-line" style={{ height: 48 }}>
                  <div role="rowheader" className="sticky left-0 z-[5] flex w-[180px] shrink-0 items-center bg-surface px-3 text-sm font-medium">{u.name}</div>
                  {days.map((d) => (
                    <div key={d} role="gridcell" data-testid={`cell-${u.id}-${d}`} style={{ width: CELL }}
                      className={clsx('shrink-0 border-l border-line', d === data.today && 'bg-brand/5', inDrag(u.id, d) && 'bg-brand/20')}
                      onMouseDown={() => setDrag({ unitId: u.id, a: d, b: d })}
                      onMouseEnter={() => drag?.unitId === u.id && setDrag({ ...drag, b: d })}
                      onMouseUp={finish} />
                  ))}
                  {bars.map(({ item, col, span, clippedStart, clippedEnd }) => (
                    <button key={`${item.kind}-${item.id}`} type="button" onClick={() => onItemClick(item)}
                      aria-label={`${label(item)}, ${short(item.start)} – ${short(item.end)}`}
                      className={clsx('absolute top-1.5 z-[4] h-9 truncate border px-2 text-left text-xs font-medium', tone(item), clippedStart ? 'rounded-l-none' : 'rounded-l-md', clippedEnd ? 'rounded-r-none' : 'rounded-r-md')}
                      style={{ left: 180 + col * CELL + (clippedStart ? 0 : CELL / 2), width: span * CELL - (clippedStart ? 0 : CELL / 2) + (clippedEnd ? 0 : CELL / 2) - 2 }}>
                      {label(item)}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```
(Bars start at the middle of the check-in cell and end at the middle of the check-out cell — the conventional "afternoon in, morning out" look, so back-to-back stays sit side by side.)

`apps/app/src/features/calendar/DayList.tsx`:
```tsx
import type { CalendarItem, CalendarResponse } from '@boogbe/shared';
import { Button, Card, EmptyState } from '@boogbe/ui';

export function DayList({ data, day, onItemClick, onNew }: { data: CalendarResponse; day: string; onItemClick: (i: CalendarItem) => void; onNew: (unitId: string) => void }) {
  const units = data.properties.flatMap((p) => p.units.map((u) => ({ ...u, property: p.name })));
  const name = (id: string) => units.find((u) => u.id === id)?.name ?? '';
  const sections = [
    { title: 'Arriving', items: data.items.filter((i) => i.start === day) },
    { title: 'Leaving', items: data.items.filter((i) => i.end === day) },
    { title: 'In house / blocked', items: data.items.filter((i) => i.start < day && i.end > day) },
  ];
  const free = units.filter((u) => !data.items.some((i) => i.unitId === u.id && i.start <= day && i.end > day));
  return (
    <div className="flex flex-col gap-4">
      {sections.map((s) => (
        <section key={s.title} aria-label={s.title}>
          <h2 className="mb-2 text-sm font-semibold text-ink-muted">{s.title} ({s.items.length})</h2>
          {s.items.length === 0 ? <p className="text-sm text-ink-muted">None</p> : s.items.map((i) => (
            <button key={`${i.kind}-${i.id}`} className="mb-2 block w-full text-left" onClick={() => onItemClick(i)}>
              <Card><p className="font-medium">{name(i.unitId)}</p><p className="text-sm text-ink-muted">{i.kind === 'booking' ? `${i.guestName ?? 'Guest'} · ${i.ref}` : i.label}</p></Card>
            </button>
          ))}
        </section>
      ))}
      <section aria-label="Free tonight">
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">Free tonight ({free.length})</h2>
        {free.length === 0 ? <EmptyState title="Fully booked tonight" /> : free.map((u) => (
          <Card key={u.id} className="mb-2 flex items-center justify-between"><span>{u.name} <span className="text-sm text-ink-muted">{u.property}</span></span><Button variant="secondary" onClick={() => onNew(u.id)}>Block / book</Button></Card>
        ))}
      </section>
    </div>
  );
}
```
`apps/app/src/features/calendar/BlockDialog.tsx`:
```tsx
import { useState } from 'react';
import { BlockInput } from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';

export function BlockForm({ unitId, start, end, onSaved }: { unitId: string; start: string; end: string; onSaved: () => void }) {
  const [v, setV] = useState({ unitId, start, end, reason: 'maintenance' as const, note: '' });
  const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault(); setErr(undefined);
      const parsed = BlockInput.safeParse(v); if (!parsed.success) return setErr(parsed.error.issues[0]?.message);
      setBusy(true);
      try { await api('/v1/blocks', { method: 'POST', body: parsed.data }); onSaved(); }
      catch (x) { setErr(x instanceof ApiError && x.code === 'DATES_UNAVAILABLE' ? 'Those dates overlap another booking or block.' : (x as Error).message); }
      finally { setBusy(false); }
    }}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="From"><Input type="date" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} /></Field>
        <Field label="Until (free again)"><Input type="date" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} /></Field>
      </div>
      <Field label="Reason"><Select value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value as never })}><option value="maintenance">Maintenance</option><option value="owner_stay">Owner stay</option><option value="other">Other</option></Select></Field>
      <Field label="Note"><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button type="submit" loading={busy}>Block dates</Button>
    </form>
  );
}
```
`apps/app/src/features/calendar/CalendarPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { addDays, todayIn, type CalendarItem } from '@boogbe/shared';
import { Button, Dialog, EmptyState, Input, Spinner } from '@boogbe/ui';
import { api } from '../../lib/api';
import { useMe } from '../../lib/use-me';
import { BlockForm } from './BlockDialog';
import { CalendarGrid } from './CalendarGrid';
import { DayList } from './DayList';
import { useCalendar } from './use-calendar';

const useNarrow = () => {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => { const m = window.matchMedia('(max-width: 767px)'); const h = () => setNarrow(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h); }, []);
  return narrow;
};

export function CalendarPage() {
  const { me } = useMe(); const narrow = useNarrow();
  const today = todayIn(me?.activeOrg?.timezone ?? 'Africa/Lagos');
  const [from, setFrom] = useState(addDays(today, -1));
  const [day, setDay] = useState(today);
  const days = narrow ? 1 : 14;
  const { data, mutate } = useCalendar(narrow ? day : from, narrow ? 2 : days);
  const [sel, setSel] = useState<{ unitId: string; start: string; end: string } | null>(null);
  const [item, setItem] = useState<CalendarItem | null>(null);
  if (!data) return <Spinner />;
  if (!data.properties.length) return <EmptyState title="No units yet" body="Add your properties and units in Settings → Properties." />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Calendar</h1>
        {narrow ? <>
          <Button variant="secondary" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">‹</Button>
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day" className="w-40" />
          <Button variant="secondary" onClick={() => setDay(addDays(day, 1))} aria-label="Next day">›</Button>
        </> : <>
          <Button variant="secondary" onClick={() => setFrom(addDays(from, -7))}>‹ Week</Button>
          <Button variant="secondary" onClick={() => setFrom(addDays(today, -1))}>Today</Button>
          <Button variant="secondary" onClick={() => setFrom(addDays(from, 7))}>Week ›</Button>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Jump to date" className="w-40" />
        </>}
      </div>
      {narrow
        ? <DayList data={data} day={day} onItemClick={setItem} onNew={(unitId) => setSel({ unitId, start: day, end: addDays(day, 1) })} />
        : <CalendarGrid data={data} onEmptySelect={(unitId, start, end) => setSel({ unitId, start, end })} onItemClick={setItem} />}
      <Dialog open={!!sel} onClose={() => setSel(null)} title="Block dates">
        {sel && <BlockForm {...sel} onSaved={async () => { setSel(null); await mutate(); }} />}
      </Dialog>
      <Dialog open={item?.kind === 'block'} onClose={() => setItem(null)} title={item?.kind === 'block' ? item.label : ''}>
        {item?.kind === 'block' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">{item.start} → {item.end}</p>
            {item.source === 'manual'
              ? <Button variant="danger" onClick={async () => { await api(`/v1/blocks/${item.id}`, { method: 'DELETE' }); setItem(null); await mutate(); }}>Remove block</Button>
              : <p className="text-sm text-ink-muted">This came from a synced calendar. Change it there.</p>}
          </div>
        )}
      </Dialog>
    </div>
  );
}
```
Router: `{ path: '/calendar', element: operator(<CalendarPage />) }` (replacing `Home`). Delete `apps/app/src/routes/Home.tsx` and its import.

- [ ] **Step 4: Run tests and build**

Run: `pnpm --filter @boogbe/app test && pnpm --filter @boogbe/app build`
Expected: PASS. Check in the browser at 360 px wide that the day list renders and at ≥ 768 px that the grid scrolls horizontally with the unit column sticky.

- [ ] **Step 5: Commit**
```bash
git add apps/app
git commit -m "feat(app): calendar grid with drag-select, mobile day list and blocks [CAL-01 CAL-02 CAL-03 CAL-05 INV-07]"
```

---

### Task 8 (T-M1-08) [ui][infra]: Logo upload UI and Tanuhomes seed

**Files:**
- Create: `apps/app/src/lib/upload.ts`, `apps/app/src/routes/settings/LogoUpload.tsx`
- Modify: `apps/app/src/routes/settings/OrgProfile.tsx`, `apps/app/src/components/shell/AppShell.tsx` (show logo)
- Create: `apps/api/scripts/seed-tanuhomes.ts`, `apps/api/scripts/data/tanuhomes.json`
- Test: `apps/app/src/lib/upload.test.ts`

**Interfaces:**
- `uploadFile(kind: FileKind, file: File): Promise<string /*fileId*/>` — validates against `FILE_LIMITS` client-side, presigns, `PUT`s to the URL with returned headers, confirms; throws `Error` with a plain message on failure.
- `seed-tanuhomes.ts <orgId>` — idempotent: creates property "The Rock Apartments" etc. and the 6 units from `tanuhomes.json` (name, bedrooms, maxGuests, nightlyRateKobo) if a unit with that name does not exist.

- [ ] **Step 1: Write failing test**

`apps/app/src/lib/upload.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadFile } from './upload';

afterEach(() => vi.restoreAllMocks());

describe('uploadFile', () => {
  it('rejects oversize files before calling the API', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    const big = new File([new Uint8Array(3 * 1024 * 1024)], 'logo.png', { type: 'image/png' });
    await expect(uploadFile('logo', big)).rejects.toThrow('Max 2048 KB');
    expect(f).not.toHaveBeenCalled();
  });
  it('presigns, uploads and confirms', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (String(url).endsWith('/presign')) return new Response(JSON.stringify({ fileId: 'f1', uploadUrl: 'https://r2/x', headers: { 'content-type': 'image/png' } }), { status: 201 });
      return new Response('{}', { status: 200 });
    });
    const id = await uploadFile('logo', new File(['x'], 'logo.png', { type: 'image/png' }));
    expect(id).toBe('f1');
    expect(calls).toEqual(['POST /v1/files/presign', 'PUT https://r2/x', 'POST /v1/files/f1/confirm']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @boogbe/app test -- upload`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/app/src/lib/upload.ts`:
```ts
import { FILE_LIMITS, PresignResponse, type FileKind } from '@boogbe/shared';
import { api } from './api';

export async function uploadFile(kind: FileKind, file: File): Promise<string> {
  const lim = FILE_LIMITS[kind];
  if (!lim.types.includes(file.type)) throw new Error(`Use ${lim.types.map((t) => t.split('/')[1]).join(', ')}`);
  if (file.size > lim.maxBytes) throw new Error(`Max ${Math.round(lim.maxBytes / 1024)} KB`);
  const p = await api('/v1/files/presign', { method: 'POST', body: { kind, contentType: file.type, sizeBytes: file.size }, schema: PresignResponse });
  const put = await fetch(p.uploadUrl, { method: 'PUT', headers: p.headers, body: file });
  if (!put.ok) throw new Error('Upload failed — check your connection and try again');
  await api(`/v1/files/${p.fileId}/confirm`, { method: 'POST' });
  return p.fileId;
}
```
`apps/app/src/routes/settings/LogoUpload.tsx`:
```tsx
import { useState } from 'react';
import { Button } from '@boogbe/ui';
import { api } from '../../lib/api';
import { uploadFile } from '../../lib/upload';

export function LogoUpload({ logoUrl, onChanged }: { logoUrl: string | null; onChanged: () => void }) {
  const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-4">
      {logoUrl ? <img src={logoUrl} alt="Business logo" className="h-14 w-14 rounded-lg border border-line object-contain" /> : <div className="grid h-14 w-14 place-items-center rounded-lg border border-dashed border-line text-xs text-ink-muted">Logo</div>}
      <label className="cursor-pointer">
        <span className="sr-only">Upload logo</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return; setErr(undefined); setBusy(true);
          try { const id = await uploadFile('logo', f); await api('/v1/org/settings', { method: 'PATCH', body: { logoFileId: id } }); onChanged(); }
          catch (x) { setErr((x as Error).message); } finally { setBusy(false); e.target.value = ''; }
        }} />
        <Button variant="secondary" loading={busy} type="button" onClick={(e) => (e.currentTarget.previousElementSibling as HTMLInputElement).click()}>{logoUrl ? 'Change logo' : 'Upload logo'}</Button>
      </label>
      {logoUrl && <Button variant="ghost" onClick={async () => { await api('/v1/org/settings', { method: 'PATCH', body: { logoFileId: null } }); onChanged(); }}>Remove</Button>}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}
```
In `OrgProfile.tsx` render `<LogoUpload logoUrl={data.settings.logoUrl} onChanged={() => mutate()} />` above the form. In `AppShell`, show the logo next to `OrgSwitcher` when `/v1/org/settings` has `logoUrl` (use `useApi('/v1/org/settings', OrgSettingsResponse)` only when `can(role, 'org.settings.read')`; otherwise no logo).

`apps/api/scripts/data/tanuhomes.json` (values from the Tanuhomes site's `src/content/properties/*.json`; rates are the published nightly rates — confirm with the owner before running in production):
```json
{
  "properties": [
    { "name": "Tanuhomes Lekki", "address": "Lekki Phase 1, Lagos", "area": "Lekki Phase 1",
      "units": [
        { "name": "Alaska", "bedrooms": 0, "maxGuests": 2, "nightlyRateKobo": 0 },
        { "name": "Destiny", "bedrooms": 0, "maxGuests": 2, "nightlyRateKobo": 0 },
        { "name": "Ebony", "bedrooms": 0, "maxGuests": 2, "nightlyRateKobo": 0 },
        { "name": "Kairo", "bedrooms": 2, "maxGuests": 4, "nightlyRateKobo": 20000000 },
        { "name": "Lumina", "bedrooms": 0, "maxGuests": 2, "nightlyRateKobo": 0 },
        { "name": "Veyra", "bedrooms": 0, "maxGuests": 2, "nightlyRateKobo": 0 }
      ] }
  ]
}
```
**Before committing**, fill every `bedrooms`, `maxGuests` and `nightlyRateKobo` from `~/Projects/tanuhomes/src/content/properties/<name>.json` (`beds`, `rate × 100`) and split units into separate properties if their `address` fields differ (Kairo is "The Rock Apartments, 3 Olu-Babajide Close"). A unit with `nightlyRateKobo: 0` is rejected by the script — this is deliberate so no zero rate reaches production.

`apps/api/scripts/seed-tanuhomes.ts`:
```ts
/** Usage: pnpm --filter @boogbe/api exec tsx scripts/seed-tanuhomes.ts <orgId> */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { uuidv7 } from 'uuidv7';

interface Data { properties: { name: string; address: string; area?: string; units: { name: string; bedrooms: number; maxGuests: number; nightlyRateKobo: number }[] }[] }

async function main() {
  const orgId = process.argv[2];
  if (!orgId) throw new Error('usage: seed-tanuhomes <orgId>');
  const data = JSON.parse(readFileSync(resolve(__dirname, 'data/tanuhomes.json'), 'utf8')) as Data;
  for (const p of data.properties) for (const u of p.units) if (u.nightlyRateKobo <= 0) throw new Error(`${u.name}: set nightlyRateKobo first`);
  const prisma = new PrismaClient();
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
    for (const p of data.properties) {
      const existing = await tx.property.findFirst({ where: { orgId, name: p.name } });
      const propertyId = existing?.id ?? (await tx.property.create({ data: { id: uuidv7(), orgId, name: p.name, address: p.address, area: p.area } })).id;
      for (const u of p.units) {
        if (await tx.unit.findFirst({ where: { orgId, propertyId, name: u.name } })) continue;
        const id = uuidv7();
        await tx.unit.create({ data: { id, orgId, propertyId, name: u.name, bedrooms: u.bedrooms, maxGuests: u.maxGuests, nightlyRateKobo: BigInt(u.nightlyRateKobo) } });
        await tx.unitOwnership.create({ data: { id: uuidv7(), orgId, unitId: id, ownerId: null, effectiveFrom: today } });
        console.log(`+ ${p.name} / ${u.name}`);
      }
    }
  });
  await prisma.$disconnect();
}
void main();
```

- [ ] **Step 4: Run tests and build**

Run: `pnpm --filter @boogbe/app test && pnpm build`
Expected: PASS.

- [ ] **Step 5: Staging exit check**

On staging, as the Tanuhomes admin: upload the logo; run `seed-tanuhomes.ts <orgId>` on the VPS staging checkout; open the calendar and confirm 6 units across their properties; block one date range; confirm the block appears and overlapping blocks are refused. Record in `docs/COORDINATION.md` notes for T-M1-08.

- [ ] **Step 6: Commit**
```bash
git add apps/app apps/api/scripts
git commit -m "feat(app): logo upload and Tanuhomes inventory seed [ORG-01]"
```

---

## Self-review notes (completed)
- Coverage: INV-01 (T4, T6), INV-02 (T4, T6), INV-03 (T4 ownership + `currentOwnerSource`), INV-04 (T4, T6), INV-05 (T5, T6), INV-06 (T4, T6), INV-07 (T5, T7), CAL-01/02/03/05 (T5, T7), CAL-04 deferred to M4 (conflict flag `hasConflict` already in contract), ORG-01 logo (T3, T8).
- Names consistent: `OwnershipService.periodsFor/currentOwner/setUnitOwner`, `BlocksService.assertUnitFree`, `CalendarSources.register`, `CalendarSource.items/conflicts`, `ROUTE_FIXTURE` (replaces M0's `PARAM_FIXTURE` — T-M1-03 makes that change and updates `isolation.int.ts`).
- M2 must: register `BookingSource` with `CalendarSources`; make `BlocksService.conflicts` unchanged; open the booking form from `CalendarPage.onEmptySelect` with a "Block instead" option.
