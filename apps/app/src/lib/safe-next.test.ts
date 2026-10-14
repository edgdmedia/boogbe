import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('keeps in-app paths, with their query and hash', () => {
    expect(safeNext('/bookings')).toBe('/bookings');
    expect(safeNext('/bookings/new?unitId=u1#top')).toBe('/bookings/new?unitId=u1#top');
  });
  it('falls back to / when missing or empty', () => {
    expect(safeNext(null)).toBe('/');
    expect(safeNext('')).toBe('/');
  });
  it('refuses anything that could leave the app', () => {
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '\\\\evil.com', 'javascript:alert(1)', 'bookings', ' /bookings', '/\tevil'])
      expect(safeNext(bad), bad).toBe('/');
  });
  it('refuses the auth pages, so a signed-in redirect cannot loop', () => {
    expect(safeNext('/auth/sign-in')).toBe('/');
    expect(safeNext('/auth/accept-invite/i1')).toBe('/');
  });
});
