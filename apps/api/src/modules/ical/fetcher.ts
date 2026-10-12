import { lookup as dnsLookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

/** Messages are shown to operators on the feed's health line, so they are plain English. */
export class FetchError extends Error {}
export class UnsafeUrlError extends FetchError {}

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
type Lookup = (h: string) => Promise<{ address: string }[]>;
const defaultLookup: Lookup = (h) => dnsLookup(h, { all: true });

/** Only global unicast: no loopback, RFC1918, link-local, CGNAT, ULA, unspecified, multicast or reserved. */
function isPublic(ip: string): boolean {
  const a = ipaddr.process(ip); // unwraps IPv4-mapped IPv6
  return a.range() === 'unicast';
}

/** SSRF guard (ICS-01): every address the host resolves to must be public. */
export async function assertPublicHost(hostname: string, lookup: Lookup = defaultLookup): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  const addrs = ipaddr.isValid(host)
    ? [{ address: host }]
    : await lookup(host).catch(() => {
        throw new FetchError('Could not find that calendar address');
      });
  if (!addrs.length || addrs.some((a) => !isPublic(a.address)))
    throw new UnsafeUrlError('That address is not allowed');
}

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;
export type FetchResult =
  | { status: 'ok'; body: string; etag: string | null; lastModified: string | null }
  | { status: 'not_modified' };

/**
 * https only, 15 s timeout, 2 MB cap, at most 3 redirects with every hop re-checked.
 * Residual risk: DNS rebinding between the check and the connect (accepted for v1, M8 security review).
 */
export class IcalFetcher {
  constructor(
    private readonly fetchImpl: FetchImpl = fetch,
    private readonly lookup: Lookup = defaultLookup,
  ) {}

  async fetch(
    url: string,
    cache: { etag: string | null; lastModified: string | null },
  ): Promise<FetchResult> {
    let current = url;
    for (let hop = 0; hop <= 3; hop++) {
      const u = new URL(current);
      if (u.protocol !== 'https:') throw new UnsafeUrlError('That address is not allowed');
      await assertPublicHost(u.hostname, this.lookup);
      let res: Response;
      try {
        res = await this.fetchImpl(current, {
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: {
            'user-agent': 'Boogbe-iCal/1.0 (+https://boogbe.com)',
            accept: 'text/calendar, */*',
            ...(cache.etag && { 'if-none-match': cache.etag }),
            ...(cache.lastModified && { 'if-modified-since': cache.lastModified }),
          },
        });
      } catch (e) {
        throw new FetchError(
          (e as Error).name === 'TimeoutError'
            ? 'Calendar took too long to respond'
            : 'Could not reach the calendar',
        );
      }
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location');
        if (!loc) throw new FetchError('Calendar redirected without a location');
        current = new URL(loc, current).toString();
        continue;
      }
      if (res.status === 304) return { status: 'not_modified' };
      if (res.status === 404 || res.status === 410)
        throw new FetchError(`Calendar link not found (${res.status})`);
      if (!res.ok) throw new FetchError(`Calendar returned an error (${res.status})`);
      if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES)
        throw new FetchError('Calendar is larger than 2 MB');
      if (!res.body) throw new FetchError('Not a calendar file');
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new FetchError('Calendar is larger than 2 MB');
        }
        chunks.push(value);
      }
      return {
        status: 'ok',
        body: Buffer.concat(chunks).toString('utf8'),
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
      };
    }
    throw new FetchError('Calendar redirected too many times');
  }
}
