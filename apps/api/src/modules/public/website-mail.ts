import { waLink } from '@boogbe/shared';

/** encodeURIComponent leaves ( ) ' ! * alone; a ( or ) in a guest's name would end the Markdown link early. */
const linkSafe = (url: string) => url.replace(/[()'!*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Guest-typed text goes into Markdown: strip anything the renderer would turn into formatting or links. */
export const plain = (s: string) =>
  s
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1 ($2)')
    .replace(/[*_`[\]]/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

export interface TeamEmailBooking {
  id: string;
  ref: string;
  unitName: string;
  propertyName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  total: string;
  guestName: string;
  phone: string;
  email?: string;
  note?: string;
  holdUntil: string;
}

/**
 * The front desk's email for a new website request: a fixed system email (plan deviation 2), not an editable
 * template, because it carries app deep links and guest-typed text that must not pass through template rendering.
 */
export function teamEmail(b: TeamEmailBooking, opts: { appOrigin: string }) {
  const name = plain(b.guestName);
  const wa = linkSafe(waLink(b.phone, `Hello ${name}, thank you for your booking request ${b.ref}.`));
  const lines = [
    'New booking request from the website.',
    `**${plain(b.propertyName)} · ${plain(b.unitName)}**\n${b.checkIn} – ${b.checkOut} (${b.nights} night${b.nights === 1 ? '' : 's'}, ${b.guests} guest${b.guests === 1 ? '' : 's'})\nQuoted total: ${b.total}`,
    `Guest: ${name}\nPhone: ${b.phone}${b.email ? `\nEmail: ${plain(b.email)}` : ''}${b.note ? `\nNote: ${plain(b.note)}` : ''}`,
    `**Held until ${b.holdUntil}.** Confirm or decline before then, or the dates are released.`,
    `[Confirm in Boogbe](${opts.appOrigin}/bookings/${b.id})`,
    `[WhatsApp the guest](${wa})`,
  ];
  return {
    subject: `New website request: ${plain(b.propertyName)} · ${plain(b.unitName)}, ${b.checkIn} – ${b.checkOut} (${b.ref})`,
    bodyMarkdown: lines.join('\n\n'),
  };
}
