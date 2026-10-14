import { describe, expect, it } from 'vitest';
import { normalizePhone, waDigits } from './phone';

describe('phone', () => {
  it('normalises Nigerian local numbers', () => {
    expect(normalizePhone('0810 754 8559')).toBe('+2348107548559');
    expect(normalizePhone('+234 810 754 8559')).toBe('+2348107548559');
    expect(normalizePhone('2348107548559')).toBe('+2348107548559');
  });
  it('keeps foreign numbers in international format', () => {
    // 07700 900xxx is Ofcom's range reserved for fiction, which libphonenumber rightly rejects; use a real-format mobile.
    expect(normalizePhone('+44 7911 123456')).toBe('+447911123456');
  });
  it('returns null for junk', () => {
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone('hello')).toBeNull();
  });
  it('wa digits', () => {
    expect(waDigits('+2348107548559')).toBe('2348107548559');
  });
});
