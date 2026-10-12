import { describe, expect, it } from 'vitest';
import { renderReceipt } from './receipt';

describe('renderReceipt [PAY-06]', () => {
  it('produces a PDF containing the key facts', async () => {
    const buf = await renderReceipt(
      {
        org: {
          name: 'Tanuhomes',
          address: 'Lekki Phase 1, Lagos',
          phone: '+2348107548559',
          email: 'hello@tanuhomes.com',
          logo: null,
        },
        receiptNo: 'TAN-R-000042',
        issuedOn: '2026-10-10',
        booking: {
          ref: 'TAN-2610-0007',
          unitName: 'Kairo',
          propertyName: 'The Rock',
          checkIn: '2026-11-01',
          checkOut: '2026-11-04',
          nights: 3,
        },
        guestName: 'Adaeze Okafor',
        entryLabel: 'Payment',
        amountKobo: 30_000_000,
        method: 'Bank transfer',
        reference: 'GTB-123',
        balanceAfterKobo: 30_000_000,
        depositHeldKobo: 0,
      },
      { compress: false },
    );
    const text = buf.toString('latin1');
    expect(text.startsWith('%PDF')).toBe(true);
    for (const s of ['TAN-R-000042', 'TAN-2610-0007', 'Adaeze Okafor', 'Tanuhomes'])
      expect(text).toContain(s);
  });
});
