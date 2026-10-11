import { assertKobo, type Owner, type Property, type Unit } from '@boogbe/shared';
import type { Owner as OwnerRow, Property as PropertyRow, Unit as UnitRow } from '@prisma/client';

export const kobo = (v: bigint) => {
  const n = Number(v);
  assertKobo(n);
  return n;
};

export function toOwner(r: OwnerRow, portalStatus: Owner['portalStatus']): Owner {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    bankName: r.bankName,
    accountNumber: r.accountNumber,
    accountName: r.accountName,
    notes: r.notes,
    userId: r.userId,
    portalStatus,
    active: r.active,
  };
}

export function toProperty(r: PropertyRow, unitCount: number, defaultOwnerName: string | null): Property {
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    area: r.area,
    notes: r.notes,
    sortOrder: r.sortOrder,
    active: r.active,
    unitCount,
    feeType: r.feeType as Property['feeType'],
    feeBps: r.feeBps,
    feeFixedMonthlyKobo: kobo(r.feeFixedMonthlyKobo),
    defaultOwnerId: r.defaultOwnerId,
    defaultOwnerName,
  };
}

export function toUnit(
  r: UnitRow,
  current: { owner: { id: string; name: string } | null; source: Unit['currentOwnerSource'] },
): Unit {
  return {
    id: r.id,
    propertyId: r.propertyId,
    name: r.name,
    bedrooms: r.bedrooms,
    maxGuests: r.maxGuests,
    nightlyRateKobo: kobo(r.nightlyRateKobo),
    defaultAssigneeMemberId: r.defaultAssigneeMemberId,
    checkInInstructions: r.checkInInstructions,
    sortOrder: r.sortOrder,
    active: r.active,
    feeOverride: r.feeOverride,
    feeType: r.feeType as Unit['feeType'],
    feeBps: r.feeBps,
    feeFixedMonthlyKobo: kobo(r.feeFixedMonthlyKobo),
    ownerFollowsProperty: r.ownerFollowsProperty,
    currentOwner: current.owner,
    currentOwnerSource: current.source,
  };
}
