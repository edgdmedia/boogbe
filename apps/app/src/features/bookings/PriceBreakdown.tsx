import type { PriceLine } from '@boogbe/shared';
import { formatNaira } from '../../lib/format';

export function PriceBreakdown({ lines, totalKobo, depositKobo }: { lines: PriceLine[]; totalKobo: number; depositKobo: number }) {
  const charges = lines.filter((l) => l.kind !== 'deposit');
  const deposits = lines.filter((l) => l.kind === 'deposit');
  return (
    <dl className="flex flex-col gap-1 text-sm">
      {charges.map((l, i) => (
        <div key={i} className="flex justify-between">
          <dt>{l.label}</dt>
          <dd className={l.amountKobo < 0 ? 'num text-success' : 'num'}>{formatNaira(l.amountKobo)}</dd>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-line pt-2 font-bold">
        <dt>Total</dt>
        <dd className="num">{formatNaira(totalKobo)}</dd>
      </div>
      {deposits.map((l, i) => (
        <div key={`d${i}`} className="flex justify-between text-ink-muted">
          <dt>{l.label} (refundable)</dt>
          <dd>{formatNaira(l.amountKobo)}</dd>
        </div>
      ))}
      {depositKobo > 0 && (
        <div className="flex justify-between text-ink-muted">
          <dt>Guest pays now</dt>
          <dd>{formatNaira(totalKobo + depositKobo)}</dd>
        </div>
      )}
    </dl>
  );
}
