export function assertKobo(n: number): void {
  if (!Number.isSafeInteger(n)) throw new Error(`kobo must be a safe integer, got ${n}`);
}

/** Rounds half away from zero. toPrecision(15) strips float noise so 1.005 → 101, not 100. */
export function toKobo(naira: number): number {
  const kobo = Math.round(Number((Math.abs(naira) * 100).toPrecision(15)));
  const result = naira < 0 ? -kobo : kobo;
  assertKobo(result);
  return result;
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
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error(`bps must be an integer from 0 to 10000, got ${bps}`);
  }
  const raw = (Math.abs(amountKobo) * bps) / 10_000;
  const rounded = Math.floor(raw + 0.5);
  return amountKobo < 0 ? -rounded : rounded;
}

const wholeNaira = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });
const withKobo = new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whole amounts drop the decimals (₦200,000); any kobo shows both digits (₦1.50). */
export function formatNaira(kobo: number): string {
  assertKobo(kobo);
  const sign = kobo < 0 ? '-' : '';
  const fmt = kobo % 100 === 0 ? wholeNaira : withKobo;
  return `${sign}₦${fmt.format(Math.abs(kobo) / 100)}`;
}
