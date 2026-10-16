import { useEffect, useState } from 'react';

const URGENT_MIN = 15;

export function holdLabel(
  holdUntil: string,
  now: number,
): { text: string; urgent: boolean; expired: boolean } {
  const ms = new Date(holdUntil).getTime() - now;
  if (ms <= 0) return { text: 'Hold expired', urgent: true, expired: true };
  const mins = Math.ceil(ms / 60_000); // "1 min" until the hold actually lapses, never "0 min"
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const text = h ? `Held ${h} h${m ? ` ${m} min` : ''}` : `Held ${m} min`;
  return { text, urgent: mins < URGENT_MIN, expired: false };
}

/** Time left on a tentative hold; re-renders every 30 s and turns urgent under 15 minutes. */
export function HoldCountdown({ holdUntil }: { holdUntil: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [holdUntil]);
  const { text, urgent } = holdLabel(holdUntil, now);
  return (
    <span
      data-urgent={String(urgent)}
      title={`Held until ${new Date(holdUntil).toLocaleString('en-NG')}`}
      className={urgent ? 'text-xs font-semibold text-danger' : 'text-xs text-ink-muted'}
    >
      {text}
    </span>
  );
}
