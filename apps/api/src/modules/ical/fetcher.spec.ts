import { describe, expect, it } from 'vitest';
import { assertPublicHost } from './fetcher';

const fakeLookup = (ip: string) => async () => [{ address: ip }];

describe('assertPublicHost [ICS-01]', () => {
  it('allows public addresses', async () => {
    await expect(assertPublicHost('www.airbnb.com', fakeLookup('34.226.10.1'))).resolves.toBeUndefined();
  });
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.3.4',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('rejects %s', async (ip) => {
    await expect(assertPublicHost('evil.example', fakeLookup(ip))).rejects.toThrow(
      'That address is not allowed',
    );
  });
  it('rejects a host if any of its addresses is private', async () => {
    const mixed = async () => [{ address: '34.226.10.1' }, { address: '10.0.0.5' }];
    await expect(assertPublicHost('evil.example', mixed)).rejects.toThrow('That address is not allowed');
  });
  it('rejects literal private IPs without DNS', async () => {
    await expect(assertPublicHost('127.0.0.1')).rejects.toThrow('That address is not allowed');
    await expect(assertPublicHost('[::1]')).rejects.toThrow('That address is not allowed');
  });
});
