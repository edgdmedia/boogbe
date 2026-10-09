export function assertKobo(n: number): void {
  if (!Number.isSafeInteger(n)) throw new Error(`kobo must be a safe integer, got ${n}`);
}

export function toKobo(naira: number): number {
  return Math.round(naira * 100);
}

export function sumKobo(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    assertKobo(v);
    total += v;
  }
  assertKobo(total);
  return total;
}

/** amount × bps / 10000, rounded half away from zero. */
export function pctOfBps(amountKobo: number, bps: number): number {
  assertKobo(amountKobo);
  const raw = (Math.abs(amountKobo) * bps) / 10_000;
  const rounded = Math.floor(raw + 0.5);
  return amountKobo < 0 ? -rounded : rounded;
}

const fmt = new Intl.NumberFormat('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function formatNaira(kobo: number): string {
  assertKobo(kobo);
  const sign = kobo < 0 ? '-' : '';
  return `${sign}₦${fmt.format(Math.abs(kobo) / 100)}`;
}
