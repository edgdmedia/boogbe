import type { UnitFee } from '../contracts/inventory';
import { nightsBetween, type IsoDate } from './dates';
import { formatNaira, sumKobo } from './money';

export type LineKind = 'accommodation' | 'fee' | 'deposit' | 'adjustment';
export type Recognition = 'per_night' | 'on_check_in';
type UnitFeeKind = UnitFee['kind'];
export interface PriceLine {
  kind: LineKind;
  feeKind: UnitFeeKind | null;
  label: string;
  quantity: number;
  unitAmountKobo: number;
  amountKobo: number;
  refundable: boolean;
  recognition: Recognition;
}
export interface QuoteInput {
  nightlyRateKobo: number;
  fees: Pick<UnitFee, 'kind' | 'label' | 'amountKobo' | 'basis' | 'includedGuests' | 'active'>[];
  checkIn: IsoDate;
  checkOut: IsoDate;
  guestCount: number;
}
export interface PriceResult {
  nights: number;
  lines: PriceLine[];
  computedTotalKobo: number;
  finalTotalKobo: number;
  depositKobo: number;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The caution deposit is held, not earned, so it never counts towards the booking total. */
export function totals(lines: PriceLine[]) {
  return {
    totalKobo: sumKobo(lines.filter((l) => l.kind !== 'deposit').map((l) => l.amountKobo)),
    depositKobo: sumKobo(lines.filter((l) => l.kind === 'deposit').map((l) => l.amountKobo)),
  };
}

export function quote(i: QuoteInput): PriceResult {
  const nights = nightsBetween(i.checkIn, i.checkOut);
  const lines: PriceLine[] = [
    {
      kind: 'accommodation',
      feeKind: null,
      label: `${plural(nights, 'night')} × ${formatNaira(i.nightlyRateKobo)}`,
      quantity: nights,
      unitAmountKobo: i.nightlyRateKobo,
      amountKobo: i.nightlyRateKobo * nights,
      refundable: false,
      recognition: 'per_night',
    },
  ];
  const deposits: PriceLine[] = [];
  for (const f of i.fees.filter((x) => x.active)) {
    if (f.kind === 'caution_deposit') {
      deposits.push({
        kind: 'deposit',
        feeKind: f.kind,
        label: f.label,
        quantity: 1,
        unitAmountKobo: f.amountKobo,
        amountKobo: f.amountKobo,
        refundable: true,
        recognition: 'on_check_in',
      });
      continue;
    }
    if (f.basis === 'per_stay') {
      lines.push({
        kind: 'fee',
        feeKind: f.kind,
        label: f.label,
        quantity: 1,
        unitAmountKobo: f.amountKobo,
        amountKobo: f.amountKobo,
        refundable: false,
        recognition: 'on_check_in',
      });
    } else if (f.basis === 'per_night') {
      lines.push({
        kind: 'fee',
        feeKind: f.kind,
        label: f.label,
        quantity: nights,
        unitAmountKobo: f.amountKobo,
        amountKobo: f.amountKobo * nights,
        refundable: false,
        recognition: 'per_night',
      });
    } else {
      const extra = Math.max(0, i.guestCount - (f.includedGuests ?? 0));
      if (!extra) continue;
      lines.push({
        kind: 'fee',
        feeKind: f.kind,
        label: `${f.label} (${extra} × ${plural(nights, 'night')})`,
        quantity: extra * nights,
        unitAmountKobo: f.amountKobo,
        amountKobo: f.amountKobo * extra * nights,
        refundable: false,
        recognition: 'per_night',
      });
    }
  }
  const all = [...lines, ...deposits];
  const { totalKobo, depositKobo } = totals(all);
  return { nights, lines: all, computedTotalKobo: totalKobo, finalTotalKobo: totalKobo, depositKobo };
}

/** Sets the negotiated total with a single adjustment line (BKG-05); the computed total is kept for the record. */
export function applyOverride(r: PriceResult, finalTotalKobo: number): PriceResult {
  if (finalTotalKobo < 0) throw new Error('Total cannot be negative');
  const lines = r.lines.filter((l) => l.kind !== 'adjustment');
  const diff = finalTotalKobo - r.computedTotalKobo;
  if (diff !== 0) {
    const deposit = lines.findIndex((l) => l.kind === 'deposit');
    const adj: PriceLine = {
      kind: 'adjustment',
      feeKind: null,
      label: diff < 0 ? 'Discount' : 'Price adjustment',
      quantity: 1,
      unitAmountKobo: diff,
      amountKobo: diff,
      refundable: false,
      recognition: 'per_night',
    };
    if (deposit === -1) lines.push(adj);
    else lines.splice(deposit, 0, adj);
  }
  return { ...r, lines, finalTotalKobo };
}
