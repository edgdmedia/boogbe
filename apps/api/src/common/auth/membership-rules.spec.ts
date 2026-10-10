import { describe, expect, it } from 'vitest';
import { assertKnownRole } from './membership-rules';

describe('assertKnownRole', () => {
  it('accepts boogbe roles and rejects better-auth defaults', () => {
    expect(() => assertKnownRole('frontdesk')).not.toThrow();
    expect(() => assertKnownRole('owner')).toThrow();
    expect(() => assertKnownRole('member')).toThrow();
  });
});
