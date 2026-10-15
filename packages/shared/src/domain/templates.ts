import { waDigits } from './phone';

export const TEMPLATE_KEYS = ['booking_confirmation', 'payment_receipt', 'check_in_details', 'pre_arrival_reminder', 'post_checkout_thanks', 'deposit_returned', 'website_request_received', 'website_request_closed'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  booking_confirmation: 'Booking confirmation', payment_receipt: 'Payment receipt', check_in_details: 'Check-in details',
  pre_arrival_reminder: 'Pre-arrival reminder', post_checkout_thanks: 'Thank you after checkout', deposit_returned: 'Deposit returned',
  website_request_received: 'Website request received', website_request_closed: 'Website request not confirmed',
};
export const PLACEHOLDERS = [
  'guest.firstName', 'guest.fullName', 'booking.ref', 'booking.checkIn', 'booking.checkOut', 'booking.nights', 'booking.guests',
  'unit.name', 'property.name', 'property.address', 'money.total', 'money.paid', 'money.balance', 'money.deposit', 'money.lastPayment',
  'operator.name', 'operator.phone', 'operator.email', 'checkIn.time', 'checkOut.time', 'unit.checkInInstructions',
  'booking.holdUntil', 'operator.website',
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export type TemplateVars = Record<Placeholder, string>;

const RE = /\{\{\s*([\w.]+)\s*\}\}/g;
const value = (vars: TemplateVars, k: string) => (vars as Record<string, string>)[k] ?? '';
export const findPlaceholders = (t: string) => [...t.matchAll(RE)].map((m) => m[1]!);
export const unknownPlaceholders = (t: string) => [...new Set(findPlaceholders(t).filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p)))];
export const render = (t: string, vars: TemplateVars) => t.replace(RE, (_, k: string) => value(vars, k));

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// Links become tokens before escaping so bold markers in a URL never turn into tags inside href.
const LINK = /\[([^\]\n]+)\]\((https:\/\/[^\s()"'<>]+)\)/g;
const LINK_TOKEN = /\uE000(\d+)\uE000/g;
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/** Safe subset: paragraphs, line breaks, **bold**, [text](https://…). Everything else is escaped text. */
export function markdownToHtml(md: string): string {
  return md.replace(/\uE000/g, '').replace(/\r\n?/g, '\n').trim().split(/\n{2,}/).map((para) => {
    const links: string[] = [];
    const tokenised = para.replace(LINK, (_, text: string, url: string) => `\uE000${links.push(`<a href="${esc(url)}">${inline(text)}</a>`) - 1}\uE000`);
    const h = inline(tokenised).replace(LINK_TOKEN, (_, i: string) => links[Number(i)]!);
    return `<p>${h.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

/**
 * Email HTML: the template is Markdown, but placeholder values are plain text — a guest name can never add a link or formatting.
 * Inside a link address values are URL-encoded, so they cannot change where the link points.
 */
export function renderHtml(md: string, vars: TemplateVars): string {
  const keys: string[] = [];
  const token = /(\d+)/g;
  const val = (i: string) => value(vars, keys[Number(i)]!);
  const tokenised = md.replace(//g, '').replace(RE, (_, k: string) => `${keys.push(k) - 1}`);
  return markdownToHtml(tokenised)
    .replace(/href="([^"]*)"/g, (_, url: string) => `href="${url.replace(token, (__, i: string) => esc(encodeURIComponent(val(i))))}"`)
    .replace(token, (_, i: string) => esc(val(i)).replace(/\r?\n/g, '<br>'));
}

export const waLink = (e164: string, text: string) => `https://wa.me/${waDigits(e164)}?text=${encodeURIComponent(text)}`;

export const SAMPLE_VARS: TemplateVars = {
  'guest.firstName': 'Adaeze', 'guest.fullName': 'Adaeze Okafor', 'booking.ref': 'TAN-2610-0042', 'booking.checkIn': '1 Nov 2026', 'booking.checkOut': '4 Nov 2026',
  'booking.nights': '3', 'booking.guests': '2', 'unit.name': 'Kairo', 'property.name': 'The Rock Apartments', 'property.address': '3 Olu-Babajide Close, Lekki Phase 1',
  'money.total': '₦615,000', 'money.paid': '₦300,000', 'money.balance': '₦315,000', 'money.deposit': '₦100,000', 'money.lastPayment': '₦300,000',
  'operator.name': 'Tanuhomes', 'operator.phone': '+234 810 754 8559', 'operator.email': 'hello@tanuhomes.com', 'checkIn.time': '2:00 pm', 'checkOut.time': '12:00 pm',
  'unit.checkInInstructions': 'The gate code is 4821. Your key is in the lockbox by the door.',
  'booking.holdUntil': '1 Nov 2026, 4:30 pm', 'operator.website': 'https://tanuhomes.com',
};
export { DEFAULT_TEMPLATES } from './template-defaults';
