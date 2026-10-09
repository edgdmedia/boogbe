# M4 — iCal Sync & Tanuhomes Go-Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Claim each task in `docs/COORDINATION.md` before starting.

**Goal:** Two-way calendar sync with Airbnb / Booking.com / VRBO via iCal: per-unit import feeds pulled every 15 minutes into `block(source='ical')`, per-unit-per-channel export links that never echo a channel's own events, feed health with alerts, booking-vs-channel conflict detection and resolution, and email copies of critical alerts. Exit: **Tanuhomes live in production** (go-live checklist in T-M4-08 signed off).

**Architecture:** `IcalFetcher` (SSRF-safe HTTPS fetch with timeout, size cap, ETag/Last-Modified) → `parseFeed()` (node-ical → normalised all-day ranges in operator tz) → `IcalSyncService.syncFeed()` (upsert by `(feed_id, external_uid)`, delete future vanished blocks, recompute conflicts) inside `OrgDb.run`. Worker job `IcalImportJob` ticks every 5 minutes and syncs feeds that are due (15 min ± jitter). Exports are served by a public, throttled route that resolves the token through a `SECURITY DEFINER` SQL function and then reads under RLS. Alerts go through `NotificationsService` with an `email: true` option backed by `AlertMailer`.

**Tech Stack:** as M3, plus `node-ical`, `ical-generator`, `ipaddr.js`.

**Spec:** FRD ICS-01..06, CAL-04, NTF-02. Decision D-009 (iCal only).

**Depends on:** M3 complete (conflict resolution "cancel booking" reuses `PaymentsService.cancelWithRefund`).

## Global Constraints

- Import URLs: `https:` only; host must resolve to public IPs only (no RFC1918, loopback, link-local, CGNAT, ULA); 15 s timeout; 2 MB max body; max 3 redirects, each re-checked.
- Imported events become all-day ranges `[start, end)` in the operator's timezone; `end > start` guaranteed (zero-length → +1 day); `STATUS:CANCELLED` events skipped; events ending before `today − 1` are ignored on import and never deleted later (history).
- A sync deletes only blocks of **that feed** whose UID vanished **and** whose `end > today`.
- Export events: all-day, `SUMMARY` = `Reserved` (bookings) or `Blocked` (blocks), stable `UID` = `<kind>-<id>@boogbe`, no guest PII; range `today − 30` to `today + 730`; never include blocks imported from the export's `exclude_feed_id`.
- Export tokens: 32 random bytes base64url; rotating replaces the token (old URL 404s).
- Feed due rule: `last_attempt_at IS NULL OR last_attempt_at < now() − 15 min − jitter`, `jitter = (hash(feed.id) % 300) s`. "Sync now" allowed once per 60 s per feed.
- Alerts: feed failing after 3 consecutive failures (once per feed per day); conflict opened (once per conflict).

## Review Focus

1. **A feed URL that points at the server itself or a private network** (`https://127.0.0.1`, `https://10.0.0.5`, a DNS name resolving to `169.254.169.254`) → rejected (T-M4-03 tests).
2. **A channel removes a booking** → the matching future block disappears on next sync, past ones stay (T-M4-04 test `vanished future events are removed, past kept`).
3. **Exporting to Airbnb the dates Airbnb itself sent us** (echo loop) → excluded via `exclude_feed_id` (T-M4-06 test `export excludes own channel`).
4. **Feed returns 304 Not Modified** → counts as success, blocks untouched (T-M4-04 test `304 keeps blocks`).
5. **A conflict whose channel block later vanishes** → conflict auto-resolves as `cleared` (T-M4-05 test `conflict clears when block vanishes`).

## Parallel split

| Task | Track | Agent | Depends on |
|---|---|---|---|
| T-M4-01 Contracts | domain | Claude Code | M3 |
| T-M4-02 Schema | schema | Claude Code | T-M4-01 |
| T-M4-03 Fetcher + parser | api | Claude Code | T-M4-01 |
| T-M4-04 Feeds API, sync service, import job, health alerts, AlertMailer | api | Claude Code | T-M4-02, T-M4-03 |
| T-M4-05 Conflicts: detection, resolution, calendar flag | api | Claude Code | T-M4-04 |
| T-M4-06 Exports + public .ics | api | Claude Code | T-M4-02 |
| T-M4-07 Calendar-sync UI, conflicts page, calendar markers | ui | OpenCode | T-M4-01 (stub), merge after T-M4-05/06 |
| T-M4-08 Go-live (production, Tanuhomes data, channel links) | infra | Claude Code + owner | all above |

---

### Task 1 (T-M4-01) [domain]: iCal contracts

**Files:** Create `packages/shared/src/contracts/ical.ts`; modify `index.ts`.

**Interfaces (produced):**
```ts
export const Channel = z.enum(['airbnb','booking_com','vrbo','other']); export const CHANNEL_LABELS
export const IcalFeedInput = z.object({ unitId; label (2..60); channel: Channel; url: https URL max 2000 })
export const IcalFeed = { id; unitId; label; channel; urlHost: string; lastSyncedAt: string|null; lastAttemptAt: string|null; lastStatus: 'ok'|'error'|'never'; lastError: string|null; consecutiveFailures: number; active: boolean; blockCount: number }
export const IcalExport = { id; unitId; channel: Channel | 'all'; url: string; excludeFeedId: string|null; createdAt; rotatedAt: string|null }
export const CreateExportInput = { unitId; channel: Channel | 'all' }
export const ConflictResolution = z.enum(['external','cancelled_booking','moved_booking','cleared'])
export const SyncConflict = { id; status: 'open'|'resolved'; resolution: ConflictResolution|null; unit: { id; name }; booking: { id; ref; guestName; checkIn; checkOut; status }; block: { id; start; end; summary; channel: Channel|null }; createdAt; resolvedAt: string|null }
export const ResolveConflictInput = { action: z.enum(['external','cancel_booking','moved_booking']); refundKobo?: number; refundMethod?: PaymentMethod }
export const SyncResult = { status: 'ok'|'not_modified'|'error'; added: number; updated: number; removed: number; error: string|null }
```

- [ ] **Step 1: Implement** `packages/shared/src/contracts/ical.ts`:
```ts
import { z } from 'zod';
import { Kobo } from './common';
import { PaymentMethod } from './payments';

export const Channel = z.enum(['airbnb', 'booking_com', 'vrbo', 'other']);
export type Channel = z.infer<typeof Channel>;
export const CHANNEL_LABELS: Record<Channel | 'all', string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'VRBO', other: 'Other', all: 'All channels' };

export const IcalFeedInput = z.object({
  unitId: z.string(), label: z.string().trim().min(2).max(60), channel: Channel,
  url: z.string().trim().url().max(2000).refine((u) => u.startsWith('https://'), 'Use the https:// calendar link'),
});
export type IcalFeedInput = z.infer<typeof IcalFeedInput>;
export const IcalFeed = z.object({
  id: z.string(), unitId: z.string(), label: z.string(), channel: Channel, urlHost: z.string(),
  lastSyncedAt: z.string().nullable(), lastAttemptAt: z.string().nullable(), lastStatus: z.enum(['ok', 'error', 'never']),
  lastError: z.string().nullable(), consecutiveFailures: z.number().int(), active: z.boolean(), blockCount: z.number().int(),
});
export type IcalFeed = z.infer<typeof IcalFeed>;

export const ExportChannel = z.union([Channel, z.literal('all')]);
export const CreateExportInput = z.object({ unitId: z.string(), channel: ExportChannel });
export const IcalExport = z.object({ id: z.string(), unitId: z.string(), channel: ExportChannel, url: z.string().url(), excludeFeedId: z.string().nullable(), createdAt: z.string(), rotatedAt: z.string().nullable() });
export type IcalExport = z.infer<typeof IcalExport>;

export const ConflictResolution = z.enum(['external', 'cancelled_booking', 'moved_booking', 'cleared']);
export const SyncConflict = z.object({
  id: z.string(), status: z.enum(['open', 'resolved']), resolution: ConflictResolution.nullable(),
  unit: z.object({ id: z.string(), name: z.string() }),
  booking: z.object({ id: z.string(), ref: z.string(), guestName: z.string(), checkIn: z.string(), checkOut: z.string(), status: z.string() }),
  block: z.object({ id: z.string(), start: z.string(), end: z.string(), summary: z.string(), channel: Channel.nullable() }),
  createdAt: z.string(), resolvedAt: z.string().nullable(),
});
export type SyncConflict = z.infer<typeof SyncConflict>;
export const ResolveConflictInput = z.object({
  action: z.enum(['external', 'cancel_booking', 'moved_booking']),
  refundKobo: Kobo.optional(), refundMethod: PaymentMethod.optional(),
}).refine((r) => !r.refundKobo || !!r.refundMethod, { path: ['refundMethod'], message: 'How was the refund paid?' });
export type ResolveConflictInput = z.infer<typeof ResolveConflictInput>;
export const SyncResult = z.object({ status: z.enum(['ok', 'not_modified', 'error']), added: z.number().int(), updated: z.number().int(), removed: z.number().int(), error: z.string().nullable() });
export type SyncResult = z.infer<typeof SyncResult>;
```
Export from `index.ts`. Run `pnpm --filter @boogbe/shared typecheck`.

- [ ] **Step 2: Commit** `git commit -m "feat(shared): iCal feed, export and conflict contracts [ICS-01..06]"`

---

### Task 2 (T-M4-02) [schema]: Feeds, exports, conflicts, token lookup function

**Files:** `prisma/schema.prisma`, `prisma/migrations/0006_ical/migration.sql`; Test `apps/api/test/ical-schema.int.ts`.

- [ ] **Step 1: Schema**
```prisma
model IcalFeed {
  id                  String    @id
  orgId               String    @map("org_id")
  unitId              String    @map("unit_id")
  label               String
  channel             String
  url                 String
  etag                String?
  lastModified        String?   @map("last_modified")
  lastSyncedAt        DateTime? @map("last_synced_at")
  lastAttemptAt       DateTime? @map("last_attempt_at")
  lastStatus          String    @default("never") @map("last_status")
  lastError           String?   @map("last_error")
  consecutiveFailures Int       @default(0) @map("consecutive_failures")
  active              Boolean   @default(true)
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")

  @@index([orgId, unitId])
  @@map("ical_feed")
}

model IcalExport {
  id            String    @id
  orgId         String    @map("org_id")
  unitId        String    @map("unit_id")
  channel       String
  token         String    @unique
  excludeFeedId String?   @map("exclude_feed_id")
  createdAt     DateTime  @default(now()) @map("created_at")
  rotatedAt     DateTime? @map("rotated_at")

  @@unique([orgId, unitId, channel])
  @@map("ical_export")
}

model SyncConflict {
  id                 String    @id
  orgId              String    @map("org_id")
  unitId             String    @map("unit_id")
  bookingId          String    @map("booking_id")
  blockId            String?   @map("block_id")
  blockStart         DateTime  @db.Date @map("block_start")
  blockEnd           DateTime  @db.Date @map("block_end")
  blockSummary       String    @map("block_summary")
  channel            String?
  status             String    @default("open")
  resolution         String?
  resolvedByMemberId String?   @map("resolved_by_member_id")
  resolvedAt         DateTime? @map("resolved_at")
  createdAt          DateTime  @default(now()) @map("created_at")

  @@index([orgId, status])
  @@map("sync_conflict")
}
```
(`block_*` fields snapshot the channel event so the conflict stays readable after the block is deleted; `block_id` becomes NULL on delete.)

- [ ] **Step 2: Migration SQL** (append to `0006_ical`):
```sql
ALTER TABLE ical_feed     ADD CONSTRAINT ical_feed_org_fk     FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE ical_feed     ADD CONSTRAINT ical_feed_unit_fk    FOREIGN KEY (unit_id) REFERENCES unit(id);
ALTER TABLE ical_export   ADD CONSTRAINT ical_export_org_fk   FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE ical_export   ADD CONSTRAINT ical_export_unit_fk  FOREIGN KEY (unit_id) REFERENCES unit(id);
ALTER TABLE ical_export   ADD CONSTRAINT ical_export_feed_fk  FOREIGN KEY (exclude_feed_id) REFERENCES ical_feed(id) ON DELETE SET NULL;
ALTER TABLE sync_conflict ADD CONSTRAINT sync_conflict_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE sync_conflict ADD CONSTRAINT sync_conflict_booking_fk FOREIGN KEY (booking_id) REFERENCES booking(id);
ALTER TABLE sync_conflict ADD CONSTRAINT sync_conflict_block_fk   FOREIGN KEY (block_id) REFERENCES block(id) ON DELETE SET NULL;
ALTER TABLE block         ADD CONSTRAINT block_feed_fk FOREIGN KEY (feed_id) REFERENCES ical_feed(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX sync_conflict_open_pair ON sync_conflict (booking_id, block_id) WHERE status = 'open';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ical_feed','ical_export','sync_conflict'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

-- Public export lookup: the only way to read ical_export without an org context. Returns ids only.
-- Runs as its owner boogbe_migrator, which has BYPASSRLS (see M0 roles.sql), so it can read across orgs.

CREATE OR REPLACE FUNCTION ical_export_lookup(p_token text)
RETURNS TABLE (org_id text, unit_id text, export_id text, channel text, exclude_feed_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.org_id, e.unit_id, e.id, e.channel, e.exclude_feed_id
  FROM ical_export e JOIN organization o ON o.id = e.org_id
  WHERE e.token = p_token AND o.status = 'active'
$$;
ALTER FUNCTION ical_export_lookup(text) OWNER TO boogbe_migrator;
REVOKE ALL ON FUNCTION ical_export_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ical_export_lookup(text) TO boogbe_app;
```

- [ ] **Step 3: Failing test** `apps/api/test/ical-schema.int.ts`:
```ts
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';

describe('ical_export_lookup', () => {
  let app: Client;
  beforeAll(async () => { app = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await app.connect(); });
  afterAll(async () => { await app.end(); });
  beforeEach(async () => { await truncateAll(); });

  it('resolves a token without org context and only for active orgs', async () => {
    const org = await seedOrg(); const unit = await seedUnit(org.id, await seedProperty(org.id));
    const m = await migratorClient();
    await m.query(`insert into ical_export(id, org_id, unit_id, channel, token) values ($1,$2,$3,'airbnb','tok123')`, [newId(), org.id, unit]);
    const r = await app.query(`select * from ical_export_lookup('tok123')`);
    expect(r.rows[0]).toMatchObject({ org_id: org.id, unit_id: unit, channel: 'airbnb' });
    expect((await app.query(`select count(*)::int n from ical_export`)).rows[0].n).toBe(0); // RLS still hides the table
    await m.query(`update organization set status='suspended' where id=$1`, [org.id]);
    expect((await app.query(`select * from ical_export_lookup('tok123')`)).rows).toEqual([]);
    await m.end();
  });
});
```
- [ ] **Step 4:** `pnpm db:reset && pnpm --filter @boogbe/api prisma:generate && pnpm test:int` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(db): iCal feeds, exports, conflicts and RLS-safe token lookup [ICS-01..05]"`

---

### Task 3 (T-M4-03) [api]: SSRF-safe fetcher and feed parser

**Files:**
- Create: `apps/api/src/modules/ical/fetcher.ts`, `apps/api/src/modules/ical/parse.ts`
- Create fixtures: `apps/api/test/fixtures/ical/{airbnb.ics,booking_com.ics,vrbo.ics,datetime-events.ics,cancelled.ics,malformed.ics,empty.ics}`
- Test: `apps/api/src/modules/ical/parse.spec.ts`, `apps/api/src/modules/ical/fetcher.spec.ts`

**Interfaces:**
- `assertPublicHost(hostname: string, lookup?: (h: string) => Promise<{ address: string }[]>): Promise<void>` throws `UnsafeUrlError`.
- `class IcalFetcher { fetch(url: string, cache: { etag: string|null; lastModified: string|null }): Promise<{ status: 'ok'; body: string; etag: string|null; lastModified: string|null } | { status: 'not_modified' }> }` — throws `FetchError(message)` with plain-English messages: `Calendar link not found (404)`, `Calendar took too long to respond`, `Calendar is larger than 2 MB`, `That address is not allowed`, `Not a calendar file`.
- `parseFeed(text: string, timeZone: string, today: IsoDate): ParsedEvent[]` where `ParsedEvent = { uid: string; start: IsoDate; end: IsoDate; summary: string }`; throws `FetchError('Not a calendar file')` if no `BEGIN:VCALENDAR`.

- [ ] **Step 1: Fixtures**

`apps/api/test/fixtures/ical/airbnb.ics`:
```
BEGIN:VCALENDAR
PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN
CALSCALE:GREGORIAN
VERSION:2.0
BEGIN:VEVENT
DTEND;VALUE=DATE:20261104
DTSTART;VALUE=DATE:20261101
UID:1418fb94e984-a1b2c3@airbnb.com
SUMMARY:Reserved
DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABC\nPhone Number (Last 4 Digits): 1234
END:VEVENT
BEGIN:VEVENT
DTEND;VALUE=DATE:20261210
DTSTART;VALUE=DATE:20261208
UID:1418fb94e984-d4e5f6@airbnb.com
SUMMARY:Airbnb (Not available)
END:VEVENT
BEGIN:VEVENT
DTEND;VALUE=DATE:20250102
DTSTART;VALUE=DATE:20250101
UID:old-event@airbnb.com
SUMMARY:Reserved
END:VEVENT
END:VCALENDAR
```
`booking_com.ics`:
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//booking.com//EN
BEGIN:VEVENT
UID:bdc-77812@booking.com
DTSTAMP:20261001T000000Z
DTSTART;VALUE=DATE:20261115
DTEND;VALUE=DATE:20261117
SUMMARY:CLOSED - Not available
END:VEVENT
END:VCALENDAR
```
`vrbo.ics`:
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//HomeAway.com, Inc.//EN
BEGIN:VEVENT
UID:vrbo-1
DTSTART;VALUE=DATE:20261120
DTEND;VALUE=DATE:20261121
SUMMARY:Blocked
END:VEVENT
END:VCALENDAR
```
`datetime-events.ics` (timed events, one in UTC, one floating, one zero-length):
```
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:dt-utc
DTSTART:20261101T130000Z
DTEND:20261104T100000Z
SUMMARY:Timed UTC
END:VEVENT
BEGIN:VEVENT
UID:dt-floating
DTSTART:20261110T150000
DTEND:20261111T110000
SUMMARY:Floating
END:VEVENT
BEGIN:VEVENT
UID:dt-zero
DTSTART;VALUE=DATE:20261125
DTEND;VALUE=DATE:20261125
SUMMARY:Zero length
END:VEVENT
END:VCALENDAR
```
`cancelled.ics`:
```
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:c-1
STATUS:CANCELLED
DTSTART;VALUE=DATE:20261101
DTEND;VALUE=DATE:20261102
SUMMARY:Cancelled
END:VEVENT
END:VCALENDAR
```
`malformed.ics`: `<html><body>Login required</body></html>`
`empty.ics`:
```
BEGIN:VCALENDAR
VERSION:2.0
END:VCALENDAR
```

- [ ] **Step 2: Failing tests**

`apps/api/src/modules/ical/parse.spec.ts`:
```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFeed } from './parse';

const fx = (n: string) => readFileSync(resolve(__dirname, '../../../test/fixtures/ical', n), 'utf8');
const TODAY = '2026-10-10';

describe('parseFeed [ICS-02]', () => {
  it('parses Airbnb all-day events and drops old ones', () => {
    expect(parseFeed(fx('airbnb.ics'), 'Africa/Lagos', TODAY)).toEqual([
      { uid: '1418fb94e984-a1b2c3@airbnb.com', start: '2026-11-01', end: '2026-11-04', summary: 'Reserved' },
      { uid: '1418fb94e984-d4e5f6@airbnb.com', start: '2026-12-08', end: '2026-12-10', summary: 'Airbnb (Not available)' },
    ]);
  });
  it('parses Booking.com and VRBO', () => {
    expect(parseFeed(fx('booking_com.ics'), 'Africa/Lagos', TODAY)).toEqual([{ uid: 'bdc-77812@booking.com', start: '2026-11-15', end: '2026-11-17', summary: 'CLOSED - Not available' }]);
    expect(parseFeed(fx('vrbo.ics'), 'Africa/Lagos', TODAY)).toHaveLength(1);
  });
  it('maps timed events to local dates and fixes zero-length ones', () => {
    expect(parseFeed(fx('datetime-events.ics'), 'Africa/Lagos', TODAY)).toEqual([
      { uid: 'dt-utc', start: '2026-11-01', end: '2026-11-04', summary: 'Timed UTC' },
      { uid: 'dt-floating', start: '2026-11-10', end: '2026-11-11', summary: 'Floating' },
      { uid: 'dt-zero', start: '2026-11-25', end: '2026-11-26', summary: 'Zero length' },
    ]);
  });
  it('skips cancelled events; empty calendars are fine; HTML is rejected', () => {
    expect(parseFeed(fx('cancelled.ics'), 'Africa/Lagos', TODAY)).toEqual([]);
    expect(parseFeed(fx('empty.ics'), 'Africa/Lagos', TODAY)).toEqual([]);
    expect(() => parseFeed(fx('malformed.ics'), 'Africa/Lagos', TODAY)).toThrow('Not a calendar file');
  });
});
```
`apps/api/src/modules/ical/fetcher.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { assertPublicHost } from './fetcher';

const fakeLookup = (ip: string) => async () => [{ address: ip }];

describe('assertPublicHost [ICS-01]', () => {
  it('allows public addresses', async () => {
    await expect(assertPublicHost('www.airbnb.com', fakeLookup('34.226.10.1'))).resolves.toBeUndefined();
  });
  it.each(['127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1'])('rejects %s', async (ip) => {
    await expect(assertPublicHost('evil.example', fakeLookup(ip))).rejects.toThrow('That address is not allowed');
  });
  it('rejects literal private IPs without DNS', async () => {
    await expect(assertPublicHost('127.0.0.1')).rejects.toThrow('That address is not allowed');
  });
});
```
(HTTP behaviour of `IcalFetcher` — 304, 404, timeout, size cap — is tested in T-M4-04 through an injectable `fetchImpl`; no network in unit tests.)

- [ ] **Step 3:** `pnpm --filter @boogbe/api add node-ical ipaddr.js` → run tests → FAIL.

- [ ] **Step 4: Implement**

`apps/api/src/modules/ical/fetcher.ts`:
```ts
import { lookup as dnsLookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export class FetchError extends Error {}
export class UnsafeUrlError extends FetchError {}

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
type Lookup = (h: string) => Promise<{ address: string }[]>;
const defaultLookup: Lookup = (h) => dnsLookup(h, { all: true });

function isPublic(ip: string): boolean {
  const a = ipaddr.process(ip); // unwraps IPv4-mapped IPv6
  return a.range() === 'unicast';
}

export async function assertPublicHost(hostname: string, lookup: Lookup = defaultLookup): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  const addrs = ipaddr.isValid(host) ? [{ address: host }] : await lookup(host).catch(() => { throw new FetchError('Could not find that calendar address'); });
  if (!addrs.length || addrs.some((a) => !isPublic(a.address))) throw new UnsafeUrlError('That address is not allowed');
}

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export class IcalFetcher {
  constructor(private readonly fetchImpl: FetchImpl = fetch, private readonly lookup: Lookup = defaultLookup) {}

  async fetch(url: string, cache: { etag: string | null; lastModified: string | null }) {
    let current = url;
    for (let hop = 0; hop <= 3; hop++) {
      const u = new URL(current);
      if (u.protocol !== 'https:') throw new UnsafeUrlError('That address is not allowed');
      await assertPublicHost(u.hostname, this.lookup);
      let res: Response;
      try {
        res = await this.fetchImpl(current, {
          redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'user-agent': 'Boogbe-iCal/1.0 (+https://boogbe.com)', accept: 'text/calendar, */*', ...(cache.etag && { 'if-none-match': cache.etag }), ...(cache.lastModified && { 'if-modified-since': cache.lastModified }) },
        });
      } catch (e) {
        throw new FetchError((e as Error).name === 'TimeoutError' ? 'Calendar took too long to respond' : 'Could not reach the calendar');
      }
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location'); if (!loc) throw new FetchError('Calendar redirected without a location');
        current = new URL(loc, current).toString(); continue;
      }
      if (res.status === 304) return { status: 'not_modified' as const };
      if (res.status === 404 || res.status === 410) throw new FetchError(`Calendar link not found (${res.status})`);
      if (!res.ok) throw new FetchError(`Calendar returned an error (${res.status})`);
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > MAX_BYTES) throw new FetchError('Calendar is larger than 2 MB');
      const reader = res.body!.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > MAX_BYTES) { await reader.cancel(); throw new FetchError('Calendar is larger than 2 MB'); }
        chunks.push(value);
      }
      return { status: 'ok' as const, body: Buffer.concat(chunks).toString('utf8'), etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
    }
    throw new FetchError('Calendar redirected too many times');
  }
}
```
(Residual risk — DNS rebinding between `assertPublicHost` and `fetch` — is accepted for v1 and listed in M8's security review; the fix there is a custom `undici` `Agent` with a `connect.lookup` that re-validates.)

`apps/api/src/modules/ical/parse.ts`:
```ts
import ical, { type VEvent } from 'node-ical';
import { addDays, todayIn, type IsoDate } from '@boogbe/shared';
import { FetchError } from './fetcher';

export interface ParsedEvent { uid: string; start: IsoDate; end: IsoDate; summary: string }

/** Date-only values are kept as-is; date-times become the local calendar date in `timeZone`. Floating times are treated as local. */
function toLocalDate(d: Date & { dateOnly?: boolean; tz?: string }, timeZone: string): IsoDate {
  if (d.dateOnly) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!d.tz) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // floating
  return todayIn(timeZone, d);
}

export function parseFeed(text: string, timeZone: string, today: IsoDate): ParsedEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new FetchError('Not a calendar file');
  let data: ReturnType<typeof ical.sync.parseICS>;
  try { data = ical.sync.parseICS(text); } catch { throw new FetchError('Not a calendar file'); }
  const cutoff = addDays(today, -1);
  const out: ParsedEvent[] = [];
  for (const v of Object.values(data)) {
    if (!v || v.type !== 'VEVENT') continue;
    const e = v as VEvent;
    if (String(e.status ?? '').toUpperCase() === 'CANCELLED' || !e.start) continue;
    const start = toLocalDate(e.start as never, timeZone);
    let end = e.end ? toLocalDate(e.end as never, timeZone) : addDays(start, 1);
    if (end <= start) end = addDays(start, 1);
    if (end < cutoff) continue;
    const summary = typeof e.summary === 'string' ? e.summary : (e.summary as { val?: string } | undefined)?.val ?? 'External booking';
    out.push({ uid: String(e.uid ?? `${start}-${end}-${summary}`), start, end, summary: summary.slice(0, 200) });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
```
`node-ical` sets `dateOnly` on all-day dates (constructed in local server time); the test environment must run with `TZ=UTC` so `getFullYear()/getDate()` read the intended date — set `process.env.TZ = 'UTC'` at the top of `apps/api/src/main.ts`, `worker.ts`, and in `vitest.config.ts`/`vitest.int.config.ts` via `test.env: { TZ: 'UTC' }`; also set `TZ=UTC` in `ecosystem.config.js` env.

- [ ] **Step 5:** `pnpm --filter @boogbe/api test` → PASS. **Step 6: Commit** `git commit -m "feat(ical): SSRF-safe fetcher and normalising feed parser with fixtures [ICS-01 ICS-02]"`

---

### Task 4 (T-M4-04) [api]: Feeds API, sync service, import job, health alerts, AlertMailer

**Files:**
- Create: `apps/api/src/modules/ical/{ical.module.ts,feeds.controller.ts,feeds.service.ts,sync.service.ts,ical-import.job.ts,tokens.ts}`
- Create: `apps/api/src/modules/notifications/alert-mailer.ts`; modify `notifications.service.ts` (`email` option)
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/worker.module.ts`, `apps/api/test/helpers/routes.ts`
- Test: `apps/api/test/ical-sync.int.ts`

**Interfaces:**
- `ICAL_FETCHER` token (default `new IcalFetcher()`; tests override with a fake).
- `POST /v1/ical/feeds` (`ical.write`) body `IcalFeedInput` → `IcalFeed` (validates by fetching + parsing once; on failure 400 with the fetch message; on success stores and runs the first sync).
- `GET /v1/units/:id/ical` (`ical.read`) → `{ feeds: IcalFeed[]; exports: IcalExport[] }`.
- `PATCH /v1/ical/feeds/:id` (`ical.write`) `{ label?, active? }`; `DELETE /v1/ical/feeds/:id` (`ical.write`; deletes its blocks via FK cascade).
- `POST /v1/ical/feeds/:id/sync` (`ical.write`) → `SyncResult`; 429 `RATE_LIMITED` if last attempt < 60 s ago.
- `IcalSyncService.syncFeed(orgId: string, feedId: string, now?: Date): Promise<SyncResult>`; after a successful sync calls `ConflictsService.recompute(tx, orgId, unitId)` (T-M4-05 — until then a no-op method on `IcalSyncService` named `afterSync` that T-M4-05 fills).
- `IcalImportJob.run(now?)` — every 5 min; per active org, due feeds, concurrency 4.
- `NotificationsService.notifyRoles(tx, orgId, roles, n, { email?: boolean })` — when `email`, `AlertMailer.send(orgId, roles, subject, text)` is called **after** the transaction (collect in `tx`-scoped list via `afterCommit` array returned by `OrgDb.run`? — simpler: send immediately; duplicates are prevented by `dedupeKey` — only send when the insert actually created a row (`createMany` returns `count`)).

- [ ] **Step 1: Failing tests** `apps/api/test/ical-sync.int.ts`:
```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';
import { ICAL_FETCHER } from '../src/modules/ical/tokens';
import { IcalSyncService } from '../src/modules/ical/sync.service';
import { MAILER } from '../src/common/mail/mail.module';
import type { MemoryMailer } from '../src/common/mail/mailer';

const fx = (n: string) => readFileSync(resolve(__dirname, 'fixtures/ical', n), 'utf8');

class FakeFetcher {
  responses = new Map<string, () => Promise<unknown>>();
  set(url: string, fn: () => Promise<unknown>) { this.responses.set(url, fn); }
  async fetch(url: string) { const r = this.responses.get(url); if (!r) throw new Error('no fake'); return r(); }
}

describe('iCal import [ICS-01..03 ICS-06 NTF-02]', () => {
  let t: TestApp; let admin: Agent; let orgId: string; let unitId: string; let fake: FakeFetcher;
  beforeAll(async () => { t = await createTestApp({ overrides: [[ICAL_FETCHER, new FakeFetcher()]] }); fake = t.app.get(ICAL_FETCHER); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); fake.responses.clear();
    orgId = (await seedOrg()).id; unitId = await seedUnit(orgId, await seedProperty(orgId));
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });
  const URL_A = 'https://www.airbnb.com/calendar/ical/123.ics?s=abc';

  it('adding a feed validates it and imports events as blocks', async () => {
    fake.set(URL_A, async () => ({ status: 'ok', body: fx('airbnb.ics'), etag: '"v1"', lastModified: null }));
    const f = (await admin.post('/v1/ical/feeds').send({ unitId, label: 'Airbnb', channel: 'airbnb', url: URL_A }).expect(201)).body;
    expect(f).toMatchObject({ lastStatus: 'ok', urlHost: 'www.airbnb.com', blockCount: 2 });
    const cal = (await admin.get('/v1/calendar?from=2026-11-01&to=2026-12-31').expect(200)).body;
    expect(cal.items.filter((i: { kind: string; source: string }) => i.kind === 'block' && i.source === 'ical')).toHaveLength(2);
  });

  it('rejects a link that is not a calendar', async () => {
    fake.set(URL_A, async () => ({ status: 'ok', body: fx('malformed.ics'), etag: null, lastModified: null }));
    const r = await admin.post('/v1/ical/feeds').send({ unitId, label: 'Airbnb', channel: 'airbnb', url: URL_A });
    expect(r.status).toBe(400); expect(r.body.error.message).toBe('Not a calendar file');
  });

  it('vanished future events are removed, past kept; 304 keeps blocks', async () => {
    fake.set(URL_A, async () => ({ status: 'ok', body: fx('airbnb.ics'), etag: null, lastModified: null }));
    const f = (await admin.post('/v1/ical/feeds').send({ unitId, label: 'Airbnb', channel: 'airbnb', url: URL_A }).expect(201)).body;
    const m = await migratorClient();
    await m.query(`insert into block(id, org_id, unit_id, start, "end", source, reason, feed_id, external_uid, updated_at) values ('past1',$1,$2,'2026-09-01','2026-09-03','ical','external',$3,'gone-past',now())`, [orgId, unitId, f.id]);
    fake.set(URL_A, async () => ({ status: 'ok', body: fx('booking_com.ics'), etag: null, lastModified: null })); // airbnb events vanish
    const svc = t.app.get(IcalSyncService);
    const r = await svc.syncFeed(orgId, f.id, new Date('2026-10-10T12:00:00Z'));
    expect(r).toMatchObject({ status: 'ok', added: 1, removed: 2 });
    const { rows } = await m.query(`select external_uid from block where feed_id=$1 order by start`, [f.id]);
    expect(rows.map((x) => x.external_uid)).toEqual(['gone-past', 'bdc-77812@booking.com']);
    fake.set(URL_A, async () => ({ status: 'not_modified' }));
    expect((await svc.syncFeed(orgId, f.id, new Date('2026-10-10T12:30:00Z'))).status).toBe('not_modified');
    expect((await m.query(`select count(*)::int n from block where feed_id=$1`, [f.id])).rows[0].n).toBe(2);
    await m.end();
  });

  it('three failures mark the feed failing, alert admins once and email them', async () => {
    fake.set(URL_A, async () => ({ status: 'ok', body: fx('airbnb.ics'), etag: null, lastModified: null }));
    const f = (await admin.post('/v1/ical/feeds').send({ unitId, label: 'Airbnb', channel: 'airbnb', url: URL_A }).expect(201)).body;
    fake.set(URL_A, async () => { throw Object.assign(new Error('Calendar link not found (404)'), { name: 'FetchError' }); });
    const svc = t.app.get(IcalSyncService);
    for (let i = 0; i < 4; i++) await svc.syncFeed(orgId, f.id, new Date(Date.UTC(2026, 9, 10, 12, i * 20)));
    const feed = (await admin.get(`/v1/units/${unitId}/ical`).expect(200)).body.feeds[0];
    expect(feed).toMatchObject({ lastStatus: 'error', consecutiveFailures: 4, lastError: 'Calendar link not found (404)' });
    const n = (await admin.get('/v1/notifications').expect(200)).body;
    expect(n.items.filter((x: { kind: string }) => x.kind === 'ical_feed_failing')).toHaveLength(1);
    expect(t.app.get<MemoryMailer>(MAILER).sent.filter((mm) => mm.subject.includes('calendar sync'))).toHaveLength(1);
  });

  it('sync now is rate limited to once a minute', async () => {
    fake.set(URL_A, async () => ({ status: 'ok', body: fx('airbnb.ics'), etag: null, lastModified: null }));
    const f = (await admin.post('/v1/ical/feeds').send({ unitId, label: 'Airbnb', channel: 'airbnb', url: URL_A }).expect(201)).body;
    const r = await admin.post(`/v1/ical/feeds/${f.id}/sync`);
    expect(r.status).toBe(429);
  });

  it('frontdesk can view feeds but not add them', async () => {
    const fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    await fd.get(`/v1/units/${unitId}/ical`).expect(200);
    await fd.post('/v1/ical/feeds').send({ unitId, label: 'Airbnb', channel: 'airbnb', url: URL_A }).expect(403);
  });
});
```
`createTestApp` gains an optional `{ overrides?: Array<[token, value]> }` — implement by having `buildApp(opts)` accept `overrides` and apply them via `NestFactory.create(AppModule.forRoot?)` — simplest: `buildApp({ overrides })` builds a `Test.createTestingModule({ imports: [AppModule] })` when overrides are given, applies `.overrideProvider(token).useValue(value)` for each, then `createNestApplication({ bodyParser: false })` and runs the same middleware setup. Refactor `buildApp` so middleware setup is a shared `configureApp(app)` function used by both paths. (`ical` permissions: `ical.read` is held by frontdesk; `ical.write` admin only.)

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Implement**

`apps/api/src/modules/ical/tokens.ts`: `export const ICAL_FETCHER = 'BOOGBE_ICAL_FETCHER';`

`apps/api/src/modules/notifications/alert-mailer.ts`:
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OrgRole } from '@boogbe/shared';
import { PrismaService } from '../../common/db/prisma.service';
import { MAILER } from '../../common/mail/mail.module';
import type { Mailer } from '../../common/mail/mailer';
import { loadEnv } from '../../env';

@Injectable()
export class AlertMailer {
  private readonly log = new Logger('AlertMailer');
  constructor(private readonly prisma: PrismaService, @Inject(MAILER) private readonly mailer: Mailer) {}
  async send(orgId: string, roles: OrgRole[], subject: string, text: string, link?: string) {
    const members = await this.prisma.member.findMany({ where: { organizationId: orgId, role: { in: roles } }, include: { user: { select: { email: true } } } });
    const url = link ? `${loadEnv().APP_ORIGIN}${link}` : null;
    const body = url ? `${text}\n\nOpen in Boogbe: ${url}` : text;
    for (const m of members) {
      try { await this.mailer.send({ to: m.user.email, subject, text: body, html: `<p>${body.replace(/\n/g, '<br>')}</p>` }); }
      catch (e) { this.log.error(`alert to ${m.user.email} failed: ${String(e)}`); }
    }
  }
}
```
`NotificationsService.notifyRoles` — new signature `notifyRoles(tx, orgId, roles, n, opts: { email?: boolean } = {})`; change `insert` to return `count` from `createMany`; when `opts.email && count > 0` → `await this.alertMailer.send(orgId, roles, n.title, n.body ?? n.title, n.link)`. Provide `AlertMailer` in `NotificationsModule`.

`apps/api/src/modules/ical/sync.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { todayIn, type SyncResult } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { PrismaService } from '../../common/db/prisma.service';
import { newId } from '../../common/db/ids';
import { NotificationsService } from '../notifications/notifications.service';
import { FetchError, IcalFetcher } from './fetcher';
import { parseFeed } from './parse';
import { ICAL_FETCHER } from './tokens';

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class IcalSyncService {
  /** Set by ConflictsService (T-M4-05) to recompute conflicts after each successful sync. */
  afterSync: (tx: OrgTx, orgId: string, unitId: string) => Promise<void> = async () => {};

  constructor(private readonly orgDb: OrgDb, private readonly prisma: PrismaService, private readonly notifications: NotificationsService, @Inject(ICAL_FETCHER) private readonly fetcher: Pick<IcalFetcher, 'fetch'>) {}

  async syncFeed(orgId: string, feedId: string, now = new Date()): Promise<SyncResult> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { timezone: true } });
    const feed = await this.orgDb.run(orgId, async (tx) => {
      const f = await tx.icalFeed.findFirst({ where: { id: feedId } });
      if (f) await tx.icalFeed.updateMany({ where: { id: feedId }, data: { lastAttemptAt: now } });
      return f;
    });
    if (!feed) return { status: 'error', added: 0, updated: 0, removed: 0, error: 'Feed not found' };
    const today = todayIn(org.timezone, now);

    let fetched: Awaited<ReturnType<IcalFetcher['fetch']>>;
    let events: ReturnType<typeof parseFeed> = [];
    try {
      fetched = await this.fetcher.fetch(feed.url, { etag: feed.etag, lastModified: feed.lastModified });
      if (fetched.status === 'ok') events = parseFeed(fetched.body, org.timezone, today);
    } catch (e) {
      const message = e instanceof FetchError || (e as Error).name === 'FetchError' ? (e as Error).message : 'Could not read the calendar';
      return this.orgDb.run(orgId, async (tx) => {
        const failures = feed.consecutiveFailures + 1;
        await tx.icalFeed.updateMany({ where: { id: feedId }, data: { lastStatus: 'error', lastError: message, consecutiveFailures: failures } });
        if (failures >= 3) {
          await this.notifications.notifyRoles(tx, orgId, ['admin'], {
            kind: 'ical_feed_failing', title: `Calendar sync failing: ${feed.label}`,
            body: `${message}. Bookings from this channel may be missing. Check the link in the channel and paste it again.`,
            link: `/settings/properties?unit=${feed.unitId}#calendar-sync`, dedupeKey: `feed-failing-${feedId}-${today}`,
          }, { email: true });
        }
        return { status: 'error' as const, added: 0, updated: 0, removed: 0, error: message };
      });
    }

    return this.orgDb.run(orgId, async (tx) => {
      if (fetched.status === 'not_modified') {
        await tx.icalFeed.updateMany({ where: { id: feedId }, data: { lastStatus: 'ok', lastError: null, consecutiveFailures: 0, lastSyncedAt: now } });
        return { status: 'not_modified' as const, added: 0, updated: 0, removed: 0, error: null };
      }
      const existing = await tx.block.findMany({ where: { feedId, source: 'ical' } });
      const byUid = new Map(existing.map((b) => [b.externalUid!, b]));
      const seen = new Set<string>(); let added = 0; let updated = 0;
      for (const ev of events) {
        seen.add(ev.uid);
        const prev = byUid.get(ev.uid);
        if (!prev) {
          await tx.block.create({ data: { id: newId(), unitId: feed.unitId, start: day(ev.start), end: day(ev.end), source: 'ical', reason: 'external', feedId, externalUid: ev.uid, externalSummary: ev.summary } as never });
          added++;
        } else if (iso(prev.start) !== ev.start || iso(prev.end) !== ev.end || prev.externalSummary !== ev.summary) {
          await tx.block.updateMany({ where: { id: prev.id }, data: { start: day(ev.start), end: day(ev.end), externalSummary: ev.summary } });
          updated++;
        }
      }
      const vanished = existing.filter((b) => !seen.has(b.externalUid!) && iso(b.end) > today).map((b) => b.id);
      if (vanished.length) await tx.block.deleteMany({ where: { id: { in: vanished } } });
      await tx.icalFeed.updateMany({ where: { id: feedId }, data: { lastStatus: 'ok', lastError: null, consecutiveFailures: 0, lastSyncedAt: now, etag: fetched.etag, lastModified: fetched.lastModified } });
      await this.afterSync(tx, orgId, feed.unitId);
      return { status: 'ok' as const, added, updated, removed: vanished.length, error: null };
    });
  }
}
```
(The test's `removed: 2` counts the two future Airbnb events; the past `gone-past` block is kept because its `end <= today`.)

`apps/api/src/modules/ical/feeds.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { todayIn, type IcalFeed, type IcalFeedInput } from '@boogbe/shared';
import type { IcalFeed as Row } from '@prisma/client';
import { OrgDb } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { FetchError, type IcalFetcher } from './fetcher';
import { parseFeed } from './parse';
import { IcalSyncService } from './sync.service';
import { ICAL_FETCHER } from './tokens';
import { ExportsService } from './exports.service';

const toFeed = (r: Row, blockCount: number): IcalFeed => ({
  id: r.id, unitId: r.unitId, label: r.label, channel: r.channel as IcalFeed['channel'], urlHost: new URL(r.url).host,
  lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null, lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
  lastStatus: r.lastStatus as IcalFeed['lastStatus'], lastError: r.lastError, consecutiveFailures: r.consecutiveFailures, active: r.active, blockCount,
});

@Injectable()
export class FeedsService {
  constructor(private readonly orgDb: OrgDb, private readonly audit: AuditService, private readonly sync: IcalSyncService, private readonly exports: ExportsService, @Inject(ICAL_FETCHER) private readonly fetcher: Pick<IcalFetcher, 'fetch'>) {}

  async forUnit(ctx: OrgCtx, unitId: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      if (!(await tx.unit.findFirst({ where: { id: unitId } }))) throw notFound('Unit');
      const feeds = await tx.icalFeed.findMany({ where: { unitId }, orderBy: { createdAt: 'asc' } });
      const counts = await tx.block.groupBy({ by: ['feedId'], where: { unitId, source: 'ical' }, _count: true });
      const c = new Map(counts.map((x) => [x.feedId, x._count]));
      return { feeds: feeds.map((f) => toFeed(f, c.get(f.id) ?? 0)), exports: await this.exports.listIn(tx, unitId) };
    });
  }

  async create(ctx: OrgCtx, input: IcalFeedInput): Promise<IcalFeed> {
    try {
      const r = await this.fetcher.fetch(input.url, { etag: null, lastModified: null });
      if (r.status === 'ok') parseFeed(r.body, ctx.timezone, todayIn(ctx.timezone));
    } catch (e) {
      if (e instanceof FetchError || (e as Error).name === 'FetchError' || (e as Error).name === 'UnsafeUrlError') throw new AppError('VALIDATION_FAILED', 400, (e as Error).message);
      throw e;
    }
    const id = newId();
    await this.orgDb.run(ctx.orgId, async (tx) => {
      if (!(await tx.unit.findFirst({ where: { id: input.unitId, active: true } }))) throw new AppError('VALIDATION_FAILED', 400, 'Unit not found');
      await tx.icalFeed.create({ data: { id, unitId: input.unitId, label: input.label, channel: input.channel, url: input.url } as never });
      await this.audit.record(tx, { actor: ctx, action: 'ical_feed.create', entity: 'ical_feed', entityId: id, after: { label: input.label, channel: input.channel, host: new URL(input.url).host } });
    });
    await this.sync.syncFeed(ctx.orgId, id);
    return (await this.forUnit(ctx, input.unitId)).feeds.find((f) => f.id === id)!;
  }

  update(ctx: OrgCtx, id: string, input: { label?: string; active?: boolean }) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.icalFeed.updateMany({ where: { id }, data: input });
      if (!r.count) throw notFound('Feed');
      await this.audit.record(tx, { actor: ctx, action: 'ical_feed.update', entity: 'ical_feed', entityId: id, after: input });
      return { ok: true };
    });
  }

  remove(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const f = await tx.icalFeed.findFirst({ where: { id } });
      if (!f) throw notFound('Feed');
      await tx.icalFeed.deleteMany({ where: { id } }); // blocks cascade
      await this.audit.record(tx, { actor: ctx, action: 'ical_feed.delete', entity: 'ical_feed', entityId: id, before: { label: f.label } });
      return { ok: true };
    });
  }

  async syncNow(ctx: OrgCtx, id: string) {
    const f = await this.orgDb.run(ctx.orgId, (tx) => tx.icalFeed.findFirst({ where: { id } }));
    if (!f) throw notFound('Feed');
    if (f.lastAttemptAt && Date.now() - f.lastAttemptAt.getTime() < 60_000) throw new AppError('RATE_LIMITED', 429, 'Synced less than a minute ago — try again shortly');
    return this.sync.syncFeed(ctx.orgId, id);
  }
}
```
(The `ExportsService` dependency is created in T-M4-06; until then `forUnit` returns `exports: []` — implement `ExportsService.listIn` as part of T-M4-06 and inject it then. If T-M4-06 lands first, use it directly.)

`apps/api/src/modules/ical/feeds.controller.ts`:
```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IcalFeedInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { FeedsService } from './feeds.service';

class FeedDto extends createZodDto(IcalFeedInput) {}
class FeedPatch extends createZodDto(z.object({ label: z.string().trim().min(2).max(60).optional(), active: z.boolean().optional() }).strict()) {}

@Controller()
export class FeedsController {
  constructor(private readonly svc: FeedsService) {}
  @Get('units/:id/ical') @Permission('ical.read') forUnit(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.forUnit(requireOrg(c), id); }
  @Post('ical/feeds') @Permission('ical.write') create(@Ctx() c: RequestCtx, @Body() b: FeedDto) { return this.svc.create(requireOrg(c), b); }
  @Patch('ical/feeds/:id') @Permission('ical.write') update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: FeedPatch) { return this.svc.update(requireOrg(c), id, b); }
  @Delete('ical/feeds/:id') @Permission('ical.write') remove(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.remove(requireOrg(c), id); }
  @Post('ical/feeds/:id/sync') @HttpCode(200) @Permission('ical.write') sync(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.syncNow(requireOrg(c), id); }
}
```
`apps/api/src/modules/ical/ical-import.job.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import { OrgDb } from '../../common/db/org-db.service';
import { JobRunner } from '../../common/jobs/job-runner';
import { IcalSyncService } from './sync.service';

const jitterMs = (id: string) => (parseInt(createHash('sha1').update(id).digest('hex').slice(0, 8), 16) % 300) * 1000;

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<unknown>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()!); }));
}

@Injectable()
export class IcalImportJob {
  constructor(private readonly runner: JobRunner, private readonly orgDb: OrgDb, private readonly sync: IcalSyncService) {}

  @Cron('*/5 * * * *')
  async tick() { await this.run(); }

  async run(now = new Date()) {
    return this.runner.forEachActiveOrg('ical.import', async (org) => {
      const feeds = await this.orgDb.run(org.id, (tx) => tx.icalFeed.findMany({ where: { active: true }, select: { id: true, lastAttemptAt: true } }));
      const due = feeds.filter((f) => !f.lastAttemptAt || now.getTime() - f.lastAttemptAt.getTime() >= 15 * 60_000 + jitterMs(f.id) - 5 * 60_000);
      await pool(due, 4, (f) => this.sync.syncFeed(org.id, f.id, now));
    });
  }
}
```
(The `- 5 min` compensates for the 5-minute tick so a feed is synced every 15–20 minutes, never later.)

`apps/api/src/modules/ical/ical.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { IcalFetcher } from './fetcher';
import { IcalSyncService } from './sync.service';
import { ICAL_FETCHER } from './tokens';

@Global()
@Module({
  controllers: [FeedsController],
  providers: [FeedsService, IcalSyncService, { provide: ICAL_FETCHER, useFactory: () => new IcalFetcher() }],
  exports: [IcalSyncService, ICAL_FETCHER],
})
export class IcalModule {}
```
Register `IcalModule` in `AppModule` and `WorkerModule`; add `IcalImportJob` to `WorkerModule.providers`. `IcalSyncService` uses `PrismaService` for the global organization timezone → add `'modules/ical/sync.service.ts'` to `PRISMA_ALLOWED` (or reuse `OrgInfo` from M3 and keep the allow-list unchanged — **prefer `OrgInfo`**: extend it with `timezone`).

Isolation fixture: `ISOLATION_FIXTURES.feed` inserting an `ical_feed` row; `ROUTE_FIXTURE.push({ match: /^\/v1\/ical\/feeds\//, fixture: 'feed' })`; `/v1/units/:id/ical` already maps to `unit`.

- [ ] **Step 4:** `pnpm --filter @boogbe/api add ical-generator` (needed in T-M4-06), run `pnpm test:int` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(ical): feed management, idempotent sync, 15-minute import job, failing-feed alerts with email [ICS-01..03 ICS-06 NTF-02]"`

---

### Task 5 (T-M4-05) [api]: Conflicts — detection, resolution, calendar flag

**Files:** Create `apps/api/src/modules/ical/{conflicts.service.ts,conflicts.controller.ts}`; modify `ical.module.ts`, `apps/api/src/modules/bookings/booking-source.ts` (`hasConflict`), `BookingHooks` registration (recompute after booking create/update/transition); Test `apps/api/test/ical-conflicts.int.ts`.

**Interfaces:**
- `ConflictsService.recompute(tx: OrgTx, orgId: string, unitId: string): Promise<void>` — for each active booking × ical block overlap on the unit: insert open conflict if none open for the pair (notify admins with email, `dedupeKey: conflict-<bookingId>-<blockId>`); for open conflicts whose pair no longer overlaps (block gone, booking cancelled/moved/finished) → `status='resolved', resolution='cleared'`.
- Registered as `IcalSyncService.afterSync` and as a `BookingHooks` `afterCreate/afterUpdate/afterTransition` (recompute the booking's unit; on update also the previous unit).
- `GET /v1/ical/conflicts?status=open|resolved` (`bookings.read`) → `{ items: SyncConflict[] }`; `POST /v1/ical/conflicts/:id/resolve` (`bookings.write`) body `ResolveConflictInput`:
  - `external` → resolved/external (the stay was handled on the other channel).
  - `cancel_booking` → `PaymentsService.cancelWithRefund(ctx, bookingId, { reason: 'Double-booked with <channel>', refundKobo, refundMethod })` then resolved/cancelled_booking.
  - `moved_booking` → allowed only if the booking no longer overlaps the block (409 `CONFLICT` otherwise: "Move the booking first"), then resolved/moved_booking.
- Calendar booking items: `hasConflict = exists open conflict for booking`.

- [ ] **Step 1: Failing tests** `apps/api/test/ical-conflicts.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { ICAL_FETCHER } from '../src/modules/ical/tokens';
import { IcalSyncService } from '../src/modules/ical/sync.service';
import { newId } from '../src/common/db/ids';

const cal = (events: { uid: string; s: string; e: string }[]) => `BEGIN:VCALENDAR\nVERSION:2.0\n${events.map((x) => `BEGIN:VEVENT\nUID:${x.uid}\nDTSTART;VALUE=DATE:${x.s.replace(/-/g, '')}\nDTEND;VALUE=DATE:${x.e.replace(/-/g, '')}\nSUMMARY:Reserved\nEND:VEVENT`).join('\n')}\nEND:VCALENDAR`;

describe('channel conflicts [ICS-05 CAL-04]', () => {
  let t: TestApp; let admin: Agent; let orgId: string; let unitId: string; let feedId: string; let body = '';
  beforeAll(async () => { t = await createTestApp({ overrides: [[ICAL_FETCHER, { fetch: async () => ({ status: 'ok', body, etag: null, lastModified: null }) }]] }); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id; unitId = await seedUnit(orgId, await seedProperty(orgId));
    admin = (await signInAs(t, 'admin', orgId)).agent;
    const m = await migratorClient(); feedId = newId();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'T','T','T',now())`, [orgId]);
    await m.query(`insert into ical_feed(id, org_id, unit_id, label, channel, url, updated_at) values ($1,$2,$3,'Airbnb','airbnb','https://www.airbnb.com/x.ics',now())`, [feedId, orgId, unitId]);
    await m.end();
  });
  const sync = () => t.app.get(IcalSyncService).syncFeed(orgId, feedId, new Date('2026-10-10T12:00:00Z'));

  it('opens a conflict, flags the calendar, notifies once', async () => {
    const b = await seedBooking(orgId, unitId, await seedGuest(orgId), { checkIn: '2026-11-01', checkOut: '2026-11-04' });
    body = cal([{ uid: 'a1', s: '2026-11-03', e: '2026-11-05' }]);
    await sync(); await sync();
    const list = (await admin.get('/v1/ical/conflicts?status=open').expect(200)).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ booking: { id: b }, block: { start: '2026-11-03', end: '2026-11-05', channel: 'airbnb' } });
    const c = (await admin.get('/v1/calendar?from=2026-11-01&to=2026-11-10').expect(200)).body;
    expect(c.items.find((i: { kind: string }) => i.kind === 'booking').hasConflict).toBe(true);
    expect((await admin.get('/v1/notifications').expect(200)).body.items.filter((n: { kind: string }) => n.kind === 'ical_conflict')).toHaveLength(1);
  });

  it('conflict clears when block vanishes', async () => {
    await seedBooking(orgId, unitId, await seedGuest(orgId), { checkIn: '2026-11-01', checkOut: '2026-11-04' });
    body = cal([{ uid: 'a1', s: '2026-11-03', e: '2026-11-05' }]); await sync();
    body = cal([]); await sync();
    const r = (await admin.get('/v1/ical/conflicts?status=resolved').expect(200)).body.items;
    expect(r[0]).toMatchObject({ resolution: 'cleared' });
  });

  it('resolve as cancel_booking cancels with refund', async () => {
    const b = await seedBooking(orgId, unitId, await seedGuest(orgId), { checkIn: '2026-11-01', checkOut: '2026-11-04' });
    await admin.post(`/v1/bookings/${b}/payments`).send({ kind: 'payment', amountKobo: 5_000_000, method: 'cash', receivedOn: '2026-10-10' }).expect(201);
    body = cal([{ uid: 'a1', s: '2026-11-03', e: '2026-11-05' }]); await sync();
    const c = (await admin.get('/v1/ical/conflicts?status=open').expect(200)).body.items[0];
    await admin.post(`/v1/ical/conflicts/${c.id}/resolve`).send({ action: 'cancel_booking', refundKobo: 5_000_000, refundMethod: 'bank_transfer' }).expect(200);
    expect((await admin.get(`/v1/bookings/${b}`).expect(200)).body).toMatchObject({ status: 'cancelled', paidKobo: 0 });
  });

  it('moved_booking requires the overlap to be gone', async () => {
    const b = await seedBooking(orgId, unitId, await seedGuest(orgId), { checkIn: '2026-11-01', checkOut: '2026-11-04', status: 'confirmed' });
    body = cal([{ uid: 'a1', s: '2026-11-03', e: '2026-11-05' }]); await sync();
    const c = (await admin.get('/v1/ical/conflicts?status=open').expect(200)).body.items[0];
    await admin.post(`/v1/ical/conflicts/${c.id}/resolve`).send({ action: 'moved_booking' }).expect(409);
    await admin.patch(`/v1/bookings/${b}`).send({ checkOut: '2026-11-03' }).expect(200); // shorten: overlap gone → auto-cleared by hook
    expect((await admin.get('/v1/ical/conflicts?status=open').expect(200)).body.items).toHaveLength(0);
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `conflicts.service.ts`:
```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ACTIVE_STATUSES, CHANNEL_LABELS, type ResolveConflictInput, type SyncConflict } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingHooks } from '../bookings/booking-hooks';
import { PaymentsService } from '../payments/payments.service';
import { IcalSyncService } from './sync.service';

const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class ConflictsService implements OnModuleInit {
  constructor(
    private readonly orgDb: OrgDb, private readonly audit: AuditService, private readonly notifications: NotificationsService,
    private readonly sync: IcalSyncService, private readonly bookingHooks: BookingHooks, private readonly payments: PaymentsService,
  ) {}

  onModuleInit() {
    this.sync.afterSync = (tx, orgId, unitId) => this.recompute(tx, orgId, unitId);
    this.bookingHooks.register({
      afterCreate: (tx, ctx, b) => this.recompute(tx, ctx.orgId, b.unit.id),
      afterUpdate: async (tx, ctx, before, after) => { await this.recompute(tx, ctx.orgId, after.unit.id); if (before.unit.id !== after.unit.id) await this.recompute(tx, ctx.orgId, before.unit.id); },
      afterTransition: async (tx, ctx, b) => { const orgId = ctx?.orgId ?? (await tx.$queryRaw<{ o: string }[]>`SELECT app_current_org() AS o`)[0]!.o; await this.recompute(tx, orgId, b.unit.id); },
    });
  }

  async recompute(tx: OrgTx, orgId: string, unitId: string) {
    const pairs = await tx.$queryRaw<{ booking_id: string; ref: string; block_id: string; start: Date; end: Date; summary: string | null; channel: string | null }[]>`
      SELECT b.id AS booking_id, b.ref, k.id AS block_id, k.start, k."end", k.external_summary AS summary, f.channel
      FROM booking b JOIN block k ON k.unit_id = b.unit_id AND k.source = 'ical'
      LEFT JOIN ical_feed f ON f.id = k.feed_id
      WHERE b.unit_id = ${unitId} AND b.status = ANY(${[...ACTIVE_STATUSES]}) AND k.start < b.check_out AND k."end" > b.check_in`;
    const live = new Set(pairs.map((p) => `${p.booking_id}|${p.block_id}`));
    const open = await tx.syncConflict.findMany({ where: { unitId, status: 'open' } });
    for (const c of open) {
      if (!c.blockId || !live.has(`${c.bookingId}|${c.blockId}`)) await tx.syncConflict.updateMany({ where: { id: c.id }, data: { status: 'resolved', resolution: 'cleared', resolvedAt: new Date() } });
    }
    const openKeys = new Set(open.map((c) => `${c.bookingId}|${c.blockId}`));
    for (const p of pairs) {
      if (openKeys.has(`${p.booking_id}|${p.block_id}`)) continue;
      const id = newId();
      await tx.syncConflict.create({ data: { id, unitId, bookingId: p.booking_id, blockId: p.block_id, blockStart: p.start, blockEnd: p.end, blockSummary: p.summary ?? 'External booking', channel: p.channel } as never });
      const ch = p.channel ? CHANNEL_LABELS[p.channel as keyof typeof CHANNEL_LABELS] : 'another channel';
      await this.notifications.notifyRoles(tx, orgId, ['admin', 'frontdesk'], {
        kind: 'ical_conflict', title: `Possible double booking: ${p.ref}`,
        body: `${ch} shows ${iso(p.start)} – ${iso(p.end)} as taken, which overlaps ${p.ref}. Check both and resolve it.`,
        link: `/conflicts`, dedupeKey: `conflict-${p.booking_id}-${p.block_id}`,
      }, { email: true });
    }
  }

  list(ctx: OrgCtx, status: 'open' | 'resolved'): Promise<{ items: SyncConflict[] }> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const rows = await tx.syncConflict.findMany({ where: { status }, orderBy: { createdAt: 'desc' }, take: 100 });
      const bookings = await tx.booking.findMany({ where: { id: { in: rows.map((r) => r.bookingId) } }, include: { guest: true, unit: true } });
      const bm = new Map(bookings.map((b) => [b.id, b]));
      return { items: rows.map((r) => { const b = bm.get(r.bookingId)!; return {
        id: r.id, status: r.status as 'open' | 'resolved', resolution: r.resolution as SyncConflict['resolution'],
        unit: { id: b.unit.id, name: b.unit.name },
        booking: { id: b.id, ref: b.ref, guestName: b.guest.fullName, checkIn: iso(b.checkIn), checkOut: iso(b.checkOut), status: b.status },
        block: { id: r.blockId ?? '', start: iso(r.blockStart), end: iso(r.blockEnd), summary: r.blockSummary, channel: r.channel as SyncConflict['block']['channel'] },
        createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null,
      }; }) };
    });
  }

  async resolve(ctx: OrgCtx, id: string, input: ResolveConflictInput) {
    const c = await this.orgDb.run(ctx.orgId, (tx) => tx.syncConflict.findFirst({ where: { id, status: 'open' } }));
    if (!c) throw notFound('Conflict');
    if (input.action === 'cancel_booking') {
      await this.payments.cancelWithRefund(ctx, c.bookingId, { reason: `Double-booked with ${c.channel ?? 'another channel'}`, refundKobo: input.refundKobo, refundMethod: input.refundMethod });
    }
    return this.orgDb.run(ctx.orgId, async (tx) => {
      if (input.action === 'moved_booking') {
        const b = await tx.booking.findFirst({ where: { id: c.bookingId } });
        if (b && b.unitId === c.unitId && b.checkIn < c.blockEnd && b.checkOut > c.blockStart && ACTIVE_STATUSES.includes(b.status as never)) {
          throw new AppError('CONFLICT', 409, 'Move or shorten the booking first, then mark it resolved');
        }
      }
      const resolution = { external: 'external', cancel_booking: 'cancelled_booking', moved_booking: 'moved_booking' }[input.action];
      await tx.syncConflict.updateMany({ where: { id, status: 'open' }, data: { status: 'resolved', resolution, resolvedAt: new Date(), resolvedByMemberId: ctx.memberId } });
      await this.audit.record(tx, { actor: ctx, action: `conflict.${resolution}`, entity: 'sync_conflict', entityId: id, after: input });
      return { ok: true };
    });
  }
}
```
(`cancelWithRefund` triggers the `afterTransition` hook, which recomputes and marks the conflict `cleared`; `resolve` then finds it no longer open and its `updateMany` affects 0 rows. To record the right resolution, in `resolve` for `cancel_booking` update by `id` without the `status: 'open'` filter: `where: { id }`.)

Controller: `@Controller('ical/conflicts')` — `@Get() @Permission('bookings.read') list(@Query('status') s = 'open')`; `@Post(':id/resolve') @HttpCode(200) @Permission('bookings.write')`. Add `ConflictsService` + controller to `IcalModule` (it imports nothing extra; `PaymentsModule`, `BookingsModule`, `NotificationsModule` are global).

`BookingSourceImpl.items` — add:
```ts
    const conflicts = rows.length ? await tx.syncConflict.findMany({ where: { bookingId: { in: rows.map((r) => r.id) }, status: 'open' }, select: { bookingId: true } }) : [];
    const flagged = new Set(conflicts.map((c) => c.bookingId));
```
and `hasConflict: flagged.has(b.id)`.

Isolation fixture `conflict` + `ROUTE_FIXTURE.push({ match: /^\/v1\/ical\/conflicts\//, fixture: 'conflict' })`.

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(ical): booking/channel conflict detection, auto-clear, resolution and calendar flags [ICS-05 CAL-04]"`

---

### Task 6 (T-M4-06) [api]: Export links and public .ics

**Files:** Create `apps/api/src/modules/ical/{exports.service.ts,exports.controller.ts,public-ical.controller.ts}`; Test `apps/api/test/ical-export.int.ts`.

**Interfaces:**
- `POST /v1/ical/exports` (`ical.write`) `CreateExportInput` → `IcalExport` (idempotent per unit+channel; for a specific channel sets `exclude_feed_id` to that unit's feed of the same channel, if any — and re-links when a feed is added later: `ExportsService.relink(tx, unitId)` called by `FeedsService.create`).
- `POST /v1/ical/exports/:id/rotate` (`ical.write`) → `IcalExport` with new token/url.
- `ExportsService.listIn(tx, unitId): Promise<IcalExport[]>`; URL = `${API_PUBLIC_ORIGIN}/v1/ical/${token}.ics` (new env `API_PUBLIC_ORIGIN`, default `BETTER_AUTH_URL` origin with `app.` → `api.` is fragile — add the env var explicitly: `https://api.boogbe.com`).
- `GET /v1/ical/:token.ics` (`@Public`, `@Throttle({ default: { limit: 30, ttl: 60_000 } })`) → `text/calendar; charset=utf-8`, `Cache-Control: max-age=300`; 404 for unknown token.

- [ ] **Step 1: Failing test** `apps/api/test/ical-export.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';

describe('iCal export [ICS-04]', () => {
  let t: TestApp; let admin: Agent; let orgId: string; let unitId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id; unitId = await seedUnit(orgId, await seedProperty(orgId));
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });

  it('exports bookings and blocks without PII and excludes the channel\'s own events', async () => {
    const soon = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    await seedBooking(orgId, unitId, await seedGuest(orgId, { fullName: 'Secret Name' }), { checkIn: soon(5), checkOut: soon(7) });
    const m = await migratorClient(); const airbnbFeed = newId(); const bdcFeed = newId();
    await m.query(`insert into ical_feed(id, org_id, unit_id, label, channel, url, updated_at) values ($1,$3,$4,'Airbnb','airbnb','https://a/x.ics',now()),($2,$3,$4,'BDC','booking_com','https://b/x.ics',now())`, [airbnbFeed, bdcFeed, orgId, unitId]);
    await m.query(`insert into block(id, org_id, unit_id, start, "end", source, reason, feed_id, external_uid, updated_at) values
      ($1,$3,$4,$5,$6,'ical','external',$7,'from-airbnb',now()), ($2,$3,$4,$8,$9,'ical','external',$10,'from-bdc',now())`,
      [newId(), newId(), orgId, unitId, soon(10), soon(12), airbnbFeed, soon(20), soon(22), bdcFeed]);
    await m.end();
    const ex = (await admin.post('/v1/ical/exports').send({ unitId, channel: 'airbnb' }).expect(201)).body;
    expect(ex.excludeFeedId).toBe(airbnbFeed);
    const token = ex.url.split('/').pop().replace('.ics', '');
    const r = await t.http.get(`/v1/ical/${token}.ics`).expect(200);
    expect(r.headers['content-type']).toContain('text/calendar');
    const body = r.text;
    expect(body).toContain('SUMMARY:Reserved');
    expect(body).toContain(`DTSTART;VALUE=DATE:${soon(20).replace(/-/g, '')}`); // BDC block included
    expect(body).not.toContain(soon(10).replace(/-/g, ''));                   // Airbnb's own block excluded
    expect(body).not.toContain('Secret Name');
  });

  it('rotating invalidates the old url; unknown tokens 404', async () => {
    const ex = (await admin.post('/v1/ical/exports').send({ unitId, channel: 'all' }).expect(201)).body;
    const old = ex.url.split('/').pop();
    const rot = (await admin.post(`/v1/ical/exports/${ex.id}/rotate`).expect(200)).body;
    await t.http.get(`/v1/ical/${old}`).expect(404);
    await t.http.get(`/v1/ical/${rot.url.split('/').pop()}`).expect(200);
    await t.http.get('/v1/ical/nope.ics').expect(404);
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `exports.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import icalGenerator, { ICalCalendarMethod } from 'ical-generator';
import { ACTIVE_STATUSES, addDays, todayIn, type IcalExport } from '@boogbe/shared';
import type { IcalExport as Row } from '@prisma/client';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { PrismaService } from '../../common/db/prisma.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { loadEnv } from '../../env';

const token = () => randomBytes(32).toString('base64url');
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const toExport = (r: Row): IcalExport => ({ id: r.id, unitId: r.unitId, channel: r.channel as IcalExport['channel'], url: `${loadEnv().API_PUBLIC_ORIGIN}/v1/ical/${r.token}.ics`, excludeFeedId: r.excludeFeedId, createdAt: r.createdAt.toISOString(), rotatedAt: r.rotatedAt?.toISOString() ?? null });

@Injectable()
export class ExportsService {
  constructor(private readonly orgDb: OrgDb, private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async listIn(tx: OrgTx, unitId: string) { return (await tx.icalExport.findMany({ where: { unitId }, orderBy: { createdAt: 'asc' } })).map(toExport); }

  async relink(tx: OrgTx, unitId: string) {
    const feeds = await tx.icalFeed.findMany({ where: { unitId, active: true } });
    for (const ex of await tx.icalExport.findMany({ where: { unitId, channel: { not: 'all' } } })) {
      const feed = feeds.find((f) => f.channel === ex.channel) ?? null;
      if (ex.excludeFeedId !== (feed?.id ?? null)) await tx.icalExport.updateMany({ where: { id: ex.id }, data: { excludeFeedId: feed?.id ?? null } });
    }
  }

  create(ctx: OrgCtx, unitId: string, channel: IcalExport['channel']) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      if (!(await tx.unit.findFirst({ where: { id: unitId } }))) throw notFound('Unit');
      let row = await tx.icalExport.findFirst({ where: { unitId, channel } });
      if (!row) {
        row = await tx.icalExport.create({ data: { id: newId(), unitId, channel, token: token() } as never });
        await this.relink(tx, unitId);
        row = (await tx.icalExport.findFirst({ where: { id: row.id } }))!;
        await this.audit.record(tx, { actor: ctx, action: 'ical_export.create', entity: 'ical_export', entityId: row.id, after: { unitId, channel } });
      }
      return toExport(row);
    });
  }

  rotate(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await tx.icalExport.updateMany({ where: { id }, data: { token: token(), rotatedAt: new Date() } });
      if (!r.count) throw notFound('Export');
      await this.audit.record(tx, { actor: ctx, action: 'ical_export.rotate', entity: 'ical_export', entityId: id });
      return toExport((await tx.icalExport.findFirst({ where: { id } }))!);
    });
  }

  /** Public: resolve token via SECURITY DEFINER function, then read under RLS. */
  async render(tok: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ org_id: string; unit_id: string; exclude_feed_id: string | null }[]>`SELECT org_id, unit_id, exclude_feed_id FROM ical_export_lookup(${tok})`;
    const hit = rows[0]; if (!hit) return null;
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: hit.org_id }, select: { name: true, timezone: true } });
    const today = todayIn(org.timezone); const from = addDays(today, -30); const to = addDays(today, 730);
    return this.orgDb.run(hit.org_id, async (tx) => {
      const unit = await tx.unit.findFirstOrThrow({ where: { id: hit.unit_id } });
      const bookings = await tx.booking.findMany({ where: { unitId: unit.id, status: { in: [...ACTIVE_STATUSES] }, checkOut: { gt: day(from) }, checkIn: { lt: day(to) } } });
      const blocks = await tx.block.findMany({ where: { unitId: unit.id, end: { gt: day(from) }, start: { lt: day(to) }, ...(hit.exclude_feed_id && { OR: [{ feedId: null }, { feedId: { not: hit.exclude_feed_id } }] }) } });
      const cal = icalGenerator({ name: `${unit.name} – ${org.name}`, prodId: { company: 'Boogbe', product: 'Calendar', language: 'EN' }, method: ICalCalendarMethod.PUBLISH });
      for (const b of bookings) cal.createEvent({ id: `booking-${b.id}@boogbe`, start: b.checkIn, end: b.checkOut, allDay: true, summary: 'Reserved' });
      for (const k of blocks) cal.createEvent({ id: `block-${k.id}@boogbe`, start: k.start, end: k.end, allDay: true, summary: 'Blocked' });
      return cal.toString();
    });
  }
}
```
(`ExportsService.render` uses `PrismaService` for the security-definer lookup and org name → add `'modules/ical/exports.service.ts'` to `PRISMA_ALLOWED` with the comment "public token lookup".) Add `API_PUBLIC_ORIGIN: z.string().url()` to `env.ts` (default `http://localhost:3060` in `.env.example`).

`exports.controller.ts` (`@Controller('ical/exports')`, `@Post()` create with `CreateExportInput`, `@Post(':id/rotate')`), `public-ical.controller.ts`:
```ts
import { Controller, Get, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/auth/decorators';
import { notFound } from '../../common/http/app-error';
import { ExportsService } from './exports.service';

@Controller('ical')
export class PublicIcalController {
  constructor(private readonly svc: ExportsService) {}
  @Get(':file') @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async ics(@Param('file') file: string, @Res() res: Response) {
    if (!file.endsWith('.ics')) throw notFound('Calendar');
    const body = await this.svc.render(file.slice(0, -4));
    if (!body) throw notFound('Calendar');
    res.setHeader('content-type', 'text/calendar; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=300');
    res.send(body);
  }
}
```
Route order: `ical/feeds`, `ical/exports`, `ical/conflicts` are more specific than `ical/:file` only if registered first — register `PublicIcalController` **last** in `IcalModule.controllers`. Wire `ExportsService` into `FeedsService` (T-M4-04) and call `exports.relink(tx, unitId)` inside `FeedsService.create` and `remove`.

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(ical): per-channel export links without echo, rotation, public .ics [ICS-04]"`

---

### Task 7 (T-M4-07) [ui]: Calendar sync settings, conflicts page, calendar markers

**Files:**
- Create: `apps/app/src/features/ical/{CalendarSyncPanel.tsx,AddFeedForm.tsx,ConflictsPage.tsx,ResolveConflictDialog.tsx,hooks.ts,channel-help.ts}`
- Modify: `apps/app/src/features/inventory/PropertyDetail.tsx` (unit "Calendar sync" button → dialog with `CalendarSyncPanel`), `apps/app/src/features/calendar/CalendarGrid.tsx` (conflict icon on bars with `hasConflict`), `apps/app/src/router.tsx` (`/conflicts`, nav "Conflicts" with open-count badge, `bookings.read`)
- Test: `apps/app/src/features/ical/CalendarSyncPanel.test.tsx`, `apps/app/src/features/ical/ConflictsPage.test.tsx`

**Interfaces:**
- `CalendarSyncPanel({ unitId, canWrite })`: section "Bring bookings in" — feed list (label, channel, host, status chip: Synced 5 min ago / Failing: <error> / Never), "Sync now", "Remove"; `AddFeedForm` (channel select, label, URL with help text from `channel-help.ts`: where to find the export link on Airbnb / Booking.com / VRBO). Section "Send availability out" — for each channel with a feed plus "All channels": export URL with Copy button (`navigator.clipboard.writeText`), Rotate (confirm: "The channel will stop seeing updates until you paste the new link").
- `ConflictsPage`: open conflicts as cards: unit, booking ref/guest/dates vs channel dates, actions "It's handled on <channel>" (external), "Cancel Boogbe booking" (opens refund dialog using `useLedger`), "I moved the booking" (moved_booking; shows API 409 message), link to booking; tab "Resolved".
- Calendar bar with `hasConflict` gets `⚠` prefix in its label and `aria-label` suffix ", possible double booking".

- [ ] **Step 1: Failing tests**

`CalendarSyncPanel.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { CalendarSyncPanel } from './CalendarSyncPanel';

vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: vi.fn(async () => ({
  feeds: [{ id: 'f1', unitId: 'u1', label: 'Airbnb', channel: 'airbnb', urlHost: 'www.airbnb.com', lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(), lastAttemptAt: null, lastStatus: 'error', lastError: 'Calendar link not found (404)', consecutiveFailures: 3, active: true, blockCount: 2 }],
  exports: [{ id: 'e1', unitId: 'u1', channel: 'airbnb', url: 'https://api.boogbe.com/v1/ical/tok.ics', excludeFeedId: 'f1', createdAt: '2026-10-10T00:00:00Z', rotatedAt: null }],
})) }));

describe('CalendarSyncPanel', () => {
  it('shows failing feeds and copies export links', async () => {
    const write = vi.fn(); Object.assign(navigator, { clipboard: { writeText: write } });
    render(<SWRConfig value={{ provider: () => new Map() }}><CalendarSyncPanel unitId="u1" canWrite /></SWRConfig>);
    expect(await screen.findByText(/Failing: Calendar link not found \(404\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy Airbnb link' }));
    expect(write).toHaveBeenCalledWith('https://api.boogbe.com/v1/ical/tok.ics');
  });
});
```
`ConflictsPage.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { ConflictsPage } from './ConflictsPage';

vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: vi.fn(async () => ({ items: [{
  id: 'c1', status: 'open', resolution: null, unit: { id: 'u1', name: 'Kairo' },
  booking: { id: 'b1', ref: 'TAN-2610-0003', guestName: 'Ada', checkIn: '2026-11-01', checkOut: '2026-11-04', status: 'confirmed' },
  block: { id: 'k1', start: '2026-11-03', end: '2026-11-05', summary: 'Reserved', channel: 'airbnb' }, createdAt: '2026-10-10T00:00:00Z', resolvedAt: null,
}] })) }));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }) }));

describe('ConflictsPage', () => {
  it('explains the overlap and offers the three actions', async () => {
    render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter><ConflictsPage /></MemoryRouter></SWRConfig>);
    expect(await screen.findByText(/Airbnb shows 3 Nov 2026 – 5 Nov 2026 as taken/)).toBeInTheDocument();
    for (const name of ["It's handled on Airbnb", 'Cancel Boogbe booking', 'I moved the booking']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement**

`channel-help.ts`:
```ts
import type { Channel } from '@boogbe/shared';
export const IMPORT_HELP: Record<Channel, string> = {
  airbnb: 'Airbnb: Listings → your listing → Availability → Connect calendars → Export calendar. Copy the link.',
  booking_com: 'Booking.com extranet: Rates & Availability → Sync calendars → Export calendar. Copy the link.',
  vrbo: 'VRBO: Calendar → Import/Export → Export calendar. Copy the link.',
  other: 'Paste the https:// iCal (.ics) export link from the other website.',
};
export const EXPORT_HELP: Record<Channel | 'all', string> = {
  airbnb: 'In Airbnb: Availability → Connect calendars → Import calendar. Paste this link and name it "Boogbe".',
  booking_com: 'In Booking.com extranet: Sync calendars → Import calendar. Paste this link.',
  vrbo: 'In VRBO: Calendar → Import/Export → Import calendar. Paste this link.',
  other: 'Paste this link into the other website\'s "import calendar" setting.',
  all: 'Includes every booking and block. Use it for websites that are not listed above.',
};
```
`hooks.ts`:
```ts
import { z } from 'zod';
import { IcalExport, IcalFeed, SyncConflict } from '@boogbe/shared';
import { useApi } from '../../lib/api';
export const useUnitIcal = (unitId: string) => useApi(`/v1/units/${unitId}/ical`, z.object({ feeds: z.array(IcalFeed), exports: z.array(IcalExport) }));
export const useConflicts = (status: 'open' | 'resolved') => useApi(`/v1/ical/conflicts?status=${status}`, z.object({ items: z.array(SyncConflict) }));
```
`AddFeedForm.tsx`:
```tsx
import { useState } from 'react';
import { Channel, CHANNEL_LABELS, IcalFeedInput } from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { IMPORT_HELP } from './channel-help';

export function AddFeedForm({ unitId, onSaved }: { unitId: string; onSaved: () => void }) {
  const [v, setV] = useState({ channel: 'airbnb' as Channel, label: 'Airbnb', url: '' });
  const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault(); setErr(undefined);
      const p = IcalFeedInput.safeParse({ unitId, ...v }); if (!p.success) return setErr(p.error.issues[0]?.message);
      setBusy(true);
      try { await api('/v1/ical/feeds', { method: 'POST', body: p.data }); onSaved(); } catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); } finally { setBusy(false); }
    }}>
      <Field label="Channel"><Select value={v.channel} onChange={(e) => { const c = e.target.value as Channel; setV({ ...v, channel: c, label: CHANNEL_LABELS[c] }); }}>{Channel.options.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}</Select></Field>
      <Field label="Name"><Input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} /></Field>
      <Field label="Calendar link" hint={IMPORT_HELP[v.channel]} error={err}><Input inputMode="url" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value.trim() })} placeholder="https://…" /></Field>
      <Button type="submit" loading={busy}>Connect</Button>
    </form>
  );
}
```
`CalendarSyncPanel.tsx`:
```tsx
import { formatDistanceToNow } from 'date-fns';
import { useState } from 'react';
import { CHANNEL_LABELS, type IcalExport, type IcalFeed } from '@boogbe/shared';
import { Badge, Button, Spinner } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { AddFeedForm } from './AddFeedForm';
import { EXPORT_HELP } from './channel-help';
import { useUnitIcal } from './hooks';

const status = (f: IcalFeed) => f.lastStatus === 'error'
  ? <Badge tone="danger">Failing: {f.lastError}</Badge>
  : f.lastSyncedAt ? <Badge tone="success">Synced {formatDistanceToNow(new Date(f.lastSyncedAt))} ago</Badge> : <Badge>Waiting for first sync</Badge>;

export function CalendarSyncPanel({ unitId, canWrite }: { unitId: string; canWrite: boolean }) {
  const { data, mutate } = useUnitIcal(unitId);
  const [adding, setAdding] = useState(false); const [msg, setMsg] = useState<string>();
  if (!data) return <Spinner />;
  const act = async (p: Promise<unknown>, ok?: string) => { setMsg(undefined); try { await p; if (ok) setMsg(ok); await mutate(); } catch (x) { setMsg(x instanceof ApiError ? x.message : String(x)); } };
  const channels = [...new Set(data.feeds.map((f) => f.channel))];
  const exportFor = (c: IcalExport['channel']) => data.exports.find((e) => e.channel === c);
  return (
    <div id="calendar-sync" className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Bring bookings in</h3>
        {data.feeds.length === 0 && <p className="text-sm text-ink-muted">No channels connected.</p>}
        {data.feeds.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-2 text-sm">
            <span><span className="font-medium">{f.label}</span> · {f.urlHost} · {f.blockCount} dates {status(f)}</span>
            {canWrite && <span className="flex gap-1">
              <Button variant="ghost" onClick={() => act(api(`/v1/ical/feeds/${f.id}/sync`, { method: 'POST' }), 'Synced')}>Sync now</Button>
              <Button variant="ghost" onClick={() => confirm(`Disconnect ${f.label}? Its dates will be removed from Boogbe.`) && act(api(`/v1/ical/feeds/${f.id}`, { method: 'DELETE' }))}>Remove</Button>
            </span>}
          </div>
        ))}
        {canWrite && (adding ? <AddFeedForm unitId={unitId} onSaved={async () => { setAdding(false); await mutate(); }} /> : <Button variant="secondary" onClick={() => setAdding(true)}>Connect a channel</Button>)}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Send availability out</h3>
        {[...channels, 'all' as const].map((c) => {
          const ex = exportFor(c);
          return (
            <div key={c} className="rounded-lg border border-line p-2 text-sm">
              <p className="font-medium">{CHANNEL_LABELS[c]}</p>
              <p className="text-ink-muted">{EXPORT_HELP[c]}</p>
              {ex ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="max-w-full truncate rounded bg-surface-2 px-2 py-1 text-xs">{ex.url}</code>
                  <Button variant="secondary" aria-label={`Copy ${CHANNEL_LABELS[c]} link`} onClick={() => { void navigator.clipboard.writeText(ex.url); setMsg('Link copied'); }}>Copy</Button>
                  {canWrite && <Button variant="ghost" onClick={() => confirm('Make a new link? The old one stops working — paste the new one into the channel.') && act(api(`/v1/ical/exports/${ex.id}/rotate`, { method: 'POST' }), 'New link created')}>New link</Button>}
                </div>
              ) : canWrite && <Button variant="secondary" className="mt-1" onClick={() => act(api('/v1/ical/exports', { method: 'POST', body: { unitId, channel: c } }))}>Create link</Button>}
            </div>
          );
        })}
      </section>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </div>
  );
}
```
`ResolveConflictDialog.tsx` + `ConflictsPage.tsx`:
```tsx
// ConflictsPage.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CHANNEL_LABELS, type SyncConflict } from '@boogbe/shared';
import { Button, Card, Dialog, EmptyState, Spinner } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useConflicts } from './hooks';
import { CancelForConflictForm } from './ResolveConflictDialog';

export function ConflictsPage() {
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const { data, mutate } = useConflicts(tab);
  const [cancel, setCancel] = useState<SyncConflict | null>(null); const [err, setErr] = useState<Record<string, string>>({});
  const act = async (c: SyncConflict, action: 'external' | 'moved_booking') => {
    try { await api(`/v1/ical/conflicts/${c.id}/resolve`, { method: 'POST', body: { action } }); await mutate(); }
    catch (x) { setErr({ ...err, [c.id]: x instanceof ApiError ? x.message : String(x) }); }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Channel conflicts</h1>
        <Button variant={tab === 'open' ? 'primary' : 'secondary'} onClick={() => setTab('open')}>Open</Button>
        <Button variant={tab === 'resolved' ? 'primary' : 'secondary'} onClick={() => setTab('resolved')}>Resolved</Button></div>
      {!data ? <Spinner /> : data.items.length === 0 ? <EmptyState title={tab === 'open' ? 'No conflicts — calendars agree' : 'Nothing resolved yet'} /> : data.items.map((c) => {
        const ch = c.block.channel ? CHANNEL_LABELS[c.block.channel] : 'Another channel';
        return (
          <Card key={c.id} className="flex flex-col gap-2">
            <p className="font-medium">{c.unit.name}: <Link to={`/bookings/${c.booking.id}`} className="text-brand">{c.booking.ref}</Link> ({c.booking.guestName}, {formatDate(c.booking.checkIn)} – {formatDate(c.booking.checkOut)})</p>
            <p className="text-sm">{ch} shows {formatDate(c.block.start)} – {formatDate(c.block.end)} as taken ({c.block.summary}).</p>
            {c.status === 'open' ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => act(c, 'external')}>It's handled on {ch}</Button>
                <Button variant="danger" onClick={() => setCancel(c)}>Cancel Boogbe booking</Button>
                <Button variant="secondary" onClick={() => act(c, 'moved_booking')}>I moved the booking</Button>
              </div>
            ) : <p className="text-sm text-ink-muted">Resolved: {c.resolution?.replace('_', ' ')}</p>}
            {err[c.id] && <p role="alert" className="text-sm text-danger">{err[c.id]}</p>}
          </Card>
        );
      })}
      <Dialog open={!!cancel} onClose={() => setCancel(null)} title="Cancel the Boogbe booking">
        {cancel && <CancelForConflictForm conflict={cancel} onDone={async () => { setCancel(null); await mutate(); }} />}
      </Dialog>
    </div>
  );
}
```
```tsx
// ResolveConflictDialog.tsx
import { useState } from 'react';
import { formatNaira, METHOD_LABELS, PaymentMethod, type SyncConflict } from '@boogbe/shared';
import { Button, Field, Select } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { MoneyInput } from '../inventory/money-input';
import { useLedger } from '../payments/hooks';

export function CancelForConflictForm({ conflict, onDone }: { conflict: SyncConflict; onDone: () => void }) {
  const { data } = useLedger(conflict.booking.id);
  const [refund, setRefund] = useState(0); const [method, setMethod] = useState<PaymentMethod>('bank_transfer'); const [err, setErr] = useState<string>();
  const paid = data?.totals.netPaidKobo ?? 0;
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      try { await api(`/v1/ical/conflicts/${conflict.id}/resolve`, { method: 'POST', body: { action: 'cancel_booking', ...(refund > 0 && { refundKobo: refund, refundMethod: method }) } }); onDone(); }
      catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); }
    }}>
      <p className="text-sm">The guest has paid {formatNaira(paid)}.</p>
      {paid > 0 && <><Field label="Refund"><MoneyInput value={refund} onChange={setRefund} /></Field>
        <Field label="Refund method"><Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>{PaymentMethod.options.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}</Select></Field></>}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button type="submit" variant="danger">Cancel booking</Button>
    </form>
  );
}
```
`CalendarGrid.tsx`: in `label(i)` prefix `'⚠ '` when `i.kind === 'booking' && i.hasConflict`; in the bar `aria-label` append `', possible double booking'` in that case; bar gets `ring-2 ring-danger`.

`PropertyDetail.tsx`: add button "Calendar sync" per unit (visible with `ical.read`) opening a `Dialog` with `<CalendarSyncPanel unitId canWrite={can(role,'ical.write')} />`; honour `?unit=<id>#calendar-sync` deep link from the failing-feed notification by opening that unit's dialog on load.

Router: `/conflicts` → `operator(<ConflictsPage />)`; nav item `{ to: '/conflicts', label: 'Conflicts', icon: TriangleAlert, permission: 'bookings.read' }`.

- [ ] **Step 4:** PASS + build. **Step 5: Commit** `git commit -m "feat(app): calendar sync settings, conflicts page and calendar conflict markers [ICS-01..06 CAL-04]"`

---

### Task 8 (T-M4-08) [infra]: Production go-live for Tanuhomes

This task is a checklist executed by Claude Code with the owner. Each box needs evidence (command output or screenshot) pasted into the PR description.

- [ ] **Step 1: Staging soak** — on staging, connect a real Airbnb export link for one Tanuhomes unit (owner provides). Leave running 24 h. Evidence: `select name, ok, count(*) from job_run where name='ical.import' and started_at > now() - interval '24 hours' group by 1,2;` shows only `ok = true`.
- [ ] **Step 2: Export round-trip** — paste the Boogbe Airbnb export link into Airbnb's "Import calendar" for that unit; create a Boogbe booking 30+ days out; within Airbnb's refresh (can take up to a few hours) confirm the dates show blocked on Airbnb. Record the observed delay in `docs/RUNBOOK.md` under "iCal behaviour".
- [ ] **Step 3: Production prerequisites** — DNS (`app`, `api`), Cloudflare Pages production branch `main`, VPS `.env` for prod with `API_PUBLIC_ORIGIN=https://api.boogbe.com`, R2 bucket, Resend domain verified (SPF/DKIM/DMARC pass — evidence: Resend dashboard screenshot), Sentry DSN, backups cron installed and first backup object present in R2.
- [ ] **Step 4: Merge `dev` → `main`** after CI (including E2E-01..04) is green; deploy succeeds; `/v1/health` returns `{ ok: true, db: true }` on `api.boogbe.com`.
- [ ] **Step 5: Tanuhomes operator** — platform admin creates "Tanuhomes" (`slug tanuhomes`), invites the owner; owner accepts; run `seed-tanuhomes.ts <orgId>` against prod after the owner confirmed every unit's rate, capacity and address in `apps/api/scripts/data/tanuhomes.json`; owner uploads the logo; sets WhatsApp number and contact email.
- [ ] **Step 6: Channels** — for each unit listed on Airbnb/Booking.com: add the import feed; create the per-channel export and paste it into the channel. Evidence: every feed `lastStatus = ok`.
- [ ] **Step 7: Backfill** — enter all future Tanuhomes bookings (from WhatsApp history and notebooks) with payments received so far. Any conflicts raised during backfill are resolved on the Conflicts page.
- [ ] **Step 8: Restore drill** — perform the RUNBOOK restore drill against the first production backup; record it in the RUNBOOK table.
- [ ] **Step 9: Sign-off** — owner confirms in writing (PR comment) that Tanuhomes takes all new bookings in Boogbe from today. Update `docs/COORDINATION.md` T-M4-08 → done with the date.

---

## Self-review notes (completed)
- Coverage: ICS-01 (T3 validation + SSRF, T4 create), ICS-02 (T3 parse, T4 sync + job), ICS-03 (T4 health + alert), ICS-04 (T6), ICS-05 (T5), ICS-06 (T4 sync now), CAL-04 (T5 flag, T7 marker), NTF-02 (T4 `AlertMailer`, used by T4/T5).
- Names: `IcalSyncService.syncFeed/afterSync`, `ConflictsService.recompute/resolve`, `ExportsService.listIn/relink/render`, `ICAL_FETCHER`, `NotificationsService.notifyRoles(..., { email })`, `OrgInfo` (now includes `timezone`), `createTestApp({ overrides })`.
- Known v1 limitation documented: DNS-rebinding window in the fetcher (fixed in M8 security hardening).
