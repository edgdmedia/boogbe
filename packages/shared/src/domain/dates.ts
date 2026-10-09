export type IsoDate = string;
const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(d: IsoDate): number {
  const m = RE.exec(d);
  if (!m) throw new Error(`invalid date ${d}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(ms).toISOString().slice(0, 10) !== d) throw new Error(`invalid date ${d}`);
  return ms;
}
const fmt = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

export function isIsoDate(s: string): boolean {
  try {
    parse(s);
    return true;
  } catch {
    return false;
  }
}
export function addDays(d: IsoDate, n: number): IsoDate {
  return fmt(parse(d) + n * DAY);
}
export function nightsBetween(checkIn: IsoDate, checkOut: IsoDate): number {
  const n = Math.round((parse(checkOut) - parse(checkIn)) / DAY);
  if (n < 1) throw new Error('check-out must be after check-in');
  return n;
}
export function rangesOverlap(aStart: IsoDate, aEnd: IsoDate, bStart: IsoDate, bEnd: IsoDate): boolean {
  return aStart < bEnd && bStart < aEnd;
}
export function eachNight(checkIn: IsoDate, checkOut: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) out.push(d);
  return out;
}
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function monthOf(d: IsoDate): IsoDate {
  parse(d);
  return `${d.slice(0, 7)}-01`;
}
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Wall-clock time in `timeZone` on `date` → UTC instant. */
export function zonedTimeToUtc(date: IsoDate, time: string, timeZone: string): Date {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`invalid time ${time}`);
  const guess = parse(date) + (Number(m[1]) * 60 + Number(m[2])) * 60_000;
  // Second pass: the offset at the first estimate can be on the wrong side of a DST change.
  const first = tzOffsetMs(new Date(guess), timeZone);
  const offset = tzOffsetMs(new Date(guess - first), timeZone);
  return new Date(guess - offset);
}
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - at.getTime();
}
