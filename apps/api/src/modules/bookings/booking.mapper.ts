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
    id: r.id,
    ref: r.ref,
    unit: {
      id: r.unit.id,
      name: r.unit.name,
      propertyName: r.unit.property.name,
      maxGuests: r.unit.maxGuests,
    },
    guest: { id: r.guest.id, fullName: r.guest.fullName, phoneE164: r.guest.phoneE164, email: r.guest.email },
    checkIn: iso(r.checkIn),
    checkOut: iso(r.checkOut),
    nights: nightsBetween(iso(r.checkIn), iso(r.checkOut)),
    guestCount: r.guestCount,
    source: r.source as Booking['source'],
    status: r.status as Booking['status'],
    holdUntil: r.holdUntil?.toISOString() ?? null,
    lines: r.lines.map((l): PriceLine => ({
      kind: l.kind as PriceLine['kind'],
      feeKind: l.feeKind as PriceLine['feeKind'],
      label: l.label,
      quantity: Number(l.quantity),
      unitAmountKobo: Number(l.unitAmountKobo),
      amountKobo: Number(l.amountKobo),
      refundable: l.refundable,
      recognition: l.recognition as PriceLine['recognition'],
    })),
    computedTotalKobo: kobo(r.computedTotalKobo),
    finalTotalKobo: kobo(r.finalTotalKobo),
    depositKobo: kobo(r.depositKobo),
    overrideReason: r.overrideReason,
    capacityOverrideReason: r.capacityOverrideReason,
    priceStale: r.priceStale,
    icalWarningAck: r.icalWarningAck,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    history: r.events.map((e) => ({
      from: (e.fromStatus as Booking['status']) ?? null,
      to: e.toStatus as Booking['status'],
      at: e.at.toISOString(),
      actorName: e.actorMemberId ? (actorNames.get(e.actorMemberId) ?? null) : null,
      reason: e.reason,
    })),
    paidKobo: null,
    balanceKobo: null,
    depositHeldKobo: null,
  };
}

export function toSummary(b: Booking): BookingSummary {
  return {
    id: b.id,
    ref: b.ref,
    unitName: b.unit.name,
    propertyName: b.unit.propertyName,
    guestName: b.guest.fullName,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: b.nights,
    status: b.status,
    source: b.source,
    finalTotalKobo: b.finalTotalKobo,
    balanceKobo: b.balanceKobo,
    holdUntil: b.holdUntil,
  };
}
