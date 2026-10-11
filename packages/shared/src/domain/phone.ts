import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

export function normalizePhone(input: string, defaultCountry: 'NG' = 'NG'): string | null {
  const raw = input.trim();
  // "2348…" typed without the plus is common on WhatsApp; treat it as international, not a local number.
  const digits = raw.replace(/\D/g, '');
  const candidate = /^234\d{10}$/.test(digits) && !raw.startsWith('+') ? `+${digits}` : raw;
  const p = parsePhoneNumberFromString(candidate, defaultCountry);
  return p && p.isValid() ? p.number : null;
}
export const waDigits = (e164: string) => e164.replace(/^\+/, '');
