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
  id: z.string(),
  userId: z.string().nullable(),
  portalStatus: z.enum(['none', 'invited', 'active']),
  active: z.boolean(),
});
export type Owner = z.infer<typeof Owner>;

export const PropertyInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    address: z.string().trim().min(3).max(300),
    area: opt(z.string().max(120)),
    notes: opt(z.string().max(2000)),
    sortOrder: z.number().int().min(0).default(0),
  })
  .merge(FeeConfig);
export type PropertyInput = z.infer<typeof PropertyInput>;
export const Property = PropertyInput.extend({
  id: z.string(),
  active: z.boolean(),
  unitCount: z.number().int(),
  defaultOwnerId: z.string().nullable(),
  defaultOwnerName: z.string().nullable(),
});
export type Property = z.infer<typeof Property>;
export const SetPropertyOwnerInput = z.object({ defaultOwnerId: z.string().nullable(), effectiveFrom: IsoDateSchema });
export type SetPropertyOwnerInput = z.infer<typeof SetPropertyOwnerInput>;

export const UnitInput = z
  .object({
    propertyId: z.string(),
    name: z.string().trim().min(1).max(80),
    bedrooms: z.number().int().min(0).max(20),
    maxGuests: z.number().int().min(1).max(50),
    nightlyRateKobo: Kobo.refine((v) => v > 0, 'Rate must be more than ₦0'),
    defaultAssigneeMemberId: z.string().nullable(),
    checkInInstructions: opt(z.string().max(5000)),
    feeOverride: z.boolean(),
    sortOrder: z.number().int().min(0).default(0),
    /** Shown on the operator's website (WB); only admins change it. */
    publicListed: z.boolean().optional(),
  })
  .merge(FeeConfig);
export type UnitInput = z.infer<typeof UnitInput>;
export const Unit = UnitInput.extend({
  id: z.string(),
  active: z.boolean(),
  publicListed: z.boolean(),
  ownerFollowsProperty: z.boolean(),
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
export const UnitFeeInput = z
  .object({
    kind: UnitFeeKind,
    label: z.string().trim().min(2).max(60),
    amountKobo: Kobo.refine((v) => v > 0, 'Amount must be more than ₦0'),
    basis: FeeBasis,
    includedGuests: z.number().int().min(0).max(50).optional(),
    active: z.boolean().default(true),
  })
  .superRefine((f, ctx) => {
    if (f.kind === 'extra_guest' && (f.basis !== 'per_guest_night' || f.includedGuests === undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['includedGuests'],
        message: 'Extra-guest fees are per guest per night and need the number of included guests',
      });
    if (f.kind === 'caution_deposit' && f.basis !== 'per_stay')
      ctx.addIssue({ code: 'custom', path: ['basis'], message: 'Caution deposits are charged once per stay' });
  });
export type UnitFeeInput = z.infer<typeof UnitFeeInput>;
export const UnitFee = z.object({
  id: z.string(),
  unitId: z.string(),
  kind: UnitFeeKind,
  label: z.string(),
  amountKobo: Kobo,
  basis: FeeBasis,
  includedGuests: z.number().int().nullable(),
  refundable: z.boolean(),
  active: z.boolean(),
});
export type UnitFee = z.infer<typeof UnitFee>;

export const BlockReason = z.enum(['maintenance', 'owner_stay', 'other']);
export const BlockInput = z
  .object({
    unitId: z.string(),
    start: IsoDateSchema,
    end: IsoDateSchema,
    reason: BlockReason,
    note: opt(z.string().max(500)),
  })
  .refine((b) => b.end > b.start, { path: ['end'], message: 'End must be after start' });
export type BlockInput = z.infer<typeof BlockInput>;
export const Block = z.object({
  id: z.string(),
  unitId: z.string(),
  start: z.string(),
  end: z.string(),
  source: z.enum(['manual', 'ical']),
  reason: z.enum(['maintenance', 'owner_stay', 'other', 'external']),
  note: z.string().nullable(),
  feedId: z.string().nullable(),
  externalSummary: z.string().nullable(),
});
export type Block = z.infer<typeof Block>;
