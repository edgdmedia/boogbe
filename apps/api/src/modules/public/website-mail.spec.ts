import { describe, expect, it } from 'vitest';
import { markdownToHtml } from '@boogbe/shared';
import { plain, teamEmail } from './website-mail';

const BOOKING = {
  id: 'b1',
  ref: 'TAN-2611-0001',
  unitName: '1 bedroom',
  propertyName: 'Destiny',
  checkIn: '1 Nov 2026',
  checkOut: '3 Nov 2026',
  nights: 2,
  guests: 2,
  total: '₦350,000',
  guestName: 'Ada [x](https://e)',
  phone: '+2348030000000',
  email: 'ada@example.ng',
  note: '**late** arrival\n[pay here](https://evil.example)',
  holdUntil: '1 Nov 2026, 4:30 pm',
};

describe('website request team email', () => {
  it('plain() neutralises Markdown and links in guest-typed text', () => {
    expect(plain('[click](https://evil.example) **bold**\nnext')).toBe('click (https://evil.example) bold next');
    expect(plain('__x__ `code` <b>hi</b>')).toBe('x code <b>hi</b>');
  });

  it('carries the deep link, a wa.me link and the hold expiry; guest text stays plain', () => {
    const m = teamEmail(BOOKING, { appOrigin: 'https://app.boogbe.com' });
    expect(m.subject).toBe('New website request: Destiny · 1 bedroom, 1 Nov 2026 – 3 Nov 2026 (TAN-2611-0001)');
    expect(m.bodyMarkdown).toContain('[Confirm in Boogbe](https://app.boogbe.com/bookings/b1)');
    expect(m.bodyMarkdown).toContain('[WhatsApp the guest](https://wa.me/2348030000000?text=');
    expect(m.bodyMarkdown).toContain('Held until 1 Nov 2026, 4:30 pm');
    expect(m.bodyMarkdown).toContain('Ada x (https://e)');
    expect(m.bodyMarkdown).not.toContain('**late**');
    // Rendered, the only links are the two the email itself adds: guest text can't add one.
    const links = [...markdownToHtml(m.bodyMarkdown).matchAll(/<a href="([^"]+)"/g)].map((x) => x[1]);
    expect(links).toHaveLength(2);
    expect(links[0]).toBe('https://app.boogbe.com/bookings/b1');
    expect(links[1]).toMatch(/^https:\/\/wa\.me\/2348030000000\?text=/);
  });

  it('omits email and note lines when the guest gave none', () => {
    const m = teamEmail({ ...BOOKING, email: undefined, note: undefined }, { appOrigin: 'https://app.boogbe.com' });
    expect(m.bodyMarkdown).not.toMatch(/Email:|Note:/);
  });
});
