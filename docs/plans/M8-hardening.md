# M8 — Hardening & Second Operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Claim each task in `docs/COORDINATION.md` before starting.

**Goal:** Make Boogbe safe to sell: guest data export/anonymisation (NDPA), closed security gaps (DNS rebinding, dependency and secret scanning, PII-scrubbed error reporting), structured logs and stale-job alerts, verified performance at target scale, accessibility pass, an automated restore check, a written security review — then onboard a second operator with **zero code changes**. Exit: second operator live; all M8 checks green in CI.

**Architecture:** No new subsystems. Privacy endpoints live in `modules/guests`; the fetcher gains a DNS-pinning `undici` dispatcher; logging moves to `nestjs-pino`; a `HealthJob` (worker) alerts the platform admin when a cron hasn't succeeded within its expected window; performance and restore checks are scripts under `apps/api/scripts/` wired into CI (perf: nightly workflow) and the runbook.

**Tech Stack:** as M7, plus `nestjs-pino`, `pino-http`, `undici`, `@axe-core/playwright`, `autocannon` (dev), `gitleaks` GitHub Action.

**Spec:** NFR-02..09, PRD success metric "second operator with zero code changes".

**Depends on:** M0–M7 complete.

## Global Constraints

- Anonymising a guest: `full_name → 'Removed guest'`, `phone_e164 → '+000' || short id`, `email → NULL`, `notes → NULL`, `anonymised_at = now()`; bookings, payments and statements keep their numbers (financial records are retained); outbound message bodies for that guest are replaced with `'[removed]'`.
- Logs never contain: passwords, tokens, cookies, `authorization` headers, guest phone/email, bank account numbers. Redaction paths are tested.
- Performance target (NFR-02): p95 < 300 ms for `GET /v1/calendar` (31 days, 50 units), `GET /v1/bookings`, `GET /v1/bookings/:id`, `GET /v1/guests?q=` at 50 units / 10,000 bookings / 8,000 guests, 10 concurrent connections, on a 2 vCPU VPS-equivalent.
- Stale-job windows: `ical.import` 20 min, `messaging.dispatch` 5 min, `bookings.expireHolds` 30 min, `tasks.turnoverSweep` 2 h, `backup.nightly` 26 h.

## Review Focus

1. **Anonymised guest still searchable** by old phone/name → must not be (T-M8-01 test).
2. **iCal host that resolves public at check time and private at connect time** (DNS rebinding) → blocked (T-M8-02 test with a fake resolver sequence).
3. **Stack traces with request bodies** reaching Sentry/logs → scrubbed (T-M8-03 redaction test).
4. **Worker silently dead** (no PM2 crash, crons not running) → platform admin emailed within the window (T-M8-03 test).
5. **Second operator sees any Tanuhomes data** → final cross-tenant E2E with two real operators (T-M8-08).

## Parallel split

| Task | Track | Agent | Depends on |
|---|---|---|---|
| T-M8-01 Guest data export + anonymise | api+ui | Claude Code | M7 |
| T-M8-02 Security hardening (rebinding, scanning, headers, cookies) | api/infra | Claude Code | M7 |
| T-M8-03 Logs, Sentry scrubbing, stale-job alerts | api/infra | Claude Code | M7 |
| T-M8-04 Performance seed + benchmark + index fixes | infra | Claude Code | M7 |
| T-M8-05 Accessibility pass (axe) | ui | OpenCode | M7 |
| T-M8-06 Automated restore check | infra | OpenCode | M7 |
| T-M8-07 Security review document | docs | Claude Code | T-M8-02, T-M8-03 |
| T-M8-08 Second operator onboarding (exit) | ops | Claude Code + owner | all |

---

### Task 1 (T-M8-01) [api][ui]: Guest data export and anonymisation (NDPA)

**Files:** Modify `apps/api/src/modules/guests/{guests.service.ts,guests.controller.ts}`; Create `apps/app/src/features/guests/PrivacyActions.tsx`; Create `docs/PRIVACY.md`; Test `apps/api/test/guest-privacy.int.ts`.

**Interfaces:**
- `GET /v1/guests/:id/export` (`guests.write`) → JSON `{ guest, bookings: [{ ref, unit, checkIn, checkOut, status, totalKobo }], payments: [{ receivedOn, kind, amountKobo, method }], messages: [{ createdAt, channel, subject, status }] }` with `Content-Disposition: attachment; filename="guest-<id>.json"`; audited `guest.export`.
- `POST /v1/guests/:id/anonymise` (`guests.write`, admin only — check `ctx.role === 'admin'` → else 403) body `{ confirm: 'REMOVE' }` → `{ ok: true }`; refuses if the guest has a booking in status `tentative|confirmed|checked_in` (422 "Cancel or finish their active bookings first"); audited `guest.anonymise` (no PII in `before`).
- Guest list/match/search exclude `anonymised_at IS NOT NULL` (already in M2 for list/match; ensure `/v1/bookings?q=` also excludes matches on anonymised guests' old values — they no longer exist after anonymisation, so this is automatic).

- [ ] **Step 1: Failing test** `apps/api/test/guest-privacy.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';

describe('guest privacy [NFR-05]', () => {
  let t: TestApp; let admin: Agent; let orgId: string; let guestId: string; let unitId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id;
    unitId = await seedUnit(orgId, await seedProperty(orgId));
    guestId = await seedGuest(orgId, { fullName: 'Adaeze Okafor', phoneE164: '+2348031234567' });
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });

  it('exports everything held about a guest', async () => {
    await seedBooking(orgId, unitId, guestId, { checkIn: '2026-09-01', checkOut: '2026-09-03', status: 'checked_out' });
    const r = await admin.get(`/v1/guests/${guestId}/export`).expect(200);
    expect(r.headers['content-disposition']).toContain(`guest-${guestId}.json`);
    expect(r.body.guest.fullName).toBe('Adaeze Okafor');
    expect(r.body.bookings).toHaveLength(1);
  });

  it('refuses while bookings are active; anonymises and keeps financial records', async () => {
    const active = await seedBooking(orgId, unitId, guestId, { checkIn: '2030-01-01', checkOut: '2030-01-03', status: 'confirmed' });
    await admin.post(`/v1/guests/${guestId}/anonymise`).send({ confirm: 'REMOVE' }).expect(422);
    const m = await migratorClient(); await m.query(`update booking set status='checked_out' where id=$1`, [active]); await m.end();
    await admin.post(`/v1/guests/${guestId}/anonymise`).send({ confirm: 'REMOVE' }).expect(200);
    expect((await admin.get('/v1/guests?q=Adaeze').expect(200)).body.items).toEqual([]);
    expect((await admin.get('/v1/guests/match?phone=%2B2348031234567').expect(200)).body.items).toEqual([]);
    const b = (await admin.get(`/v1/bookings/${active}`).expect(200)).body;
    expect(b.guest.fullName).toBe('Removed guest');
  });

  it('frontdesk cannot anonymise', async () => {
    await (await signInAs(t, 'frontdesk', orgId)).agent.post(`/v1/guests/${guestId}/anonymise`).send({ confirm: 'REMOVE' }).expect(403);
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** in `GuestsService`:
```ts
  async exportData(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const g = await tx.guest.findFirst({ where: { id } });
      if (!g) throw notFound('Guest');
      const bookings = await tx.booking.findMany({ where: { guestId: id }, include: { unit: true, payments: true } });
      const messages = await tx.outboundMessage.findMany({ where: { bookingId: { in: bookings.map((b) => b.id) } }, orderBy: { createdAt: 'asc' } });
      await this.audit.record(tx, { actor: ctx, action: 'guest.export', entity: 'guest', entityId: id });
      return {
        guest: { id: g.id, fullName: g.fullName, phoneE164: g.phoneE164, email: g.email, notes: g.notes, createdAt: g.createdAt.toISOString() },
        bookings: bookings.map((b) => ({ ref: b.ref, unit: b.unit.name, checkIn: b.checkIn.toISOString().slice(0, 10), checkOut: b.checkOut.toISOString().slice(0, 10), status: b.status, totalKobo: Number(b.finalTotalKobo) })),
        payments: bookings.flatMap((b) => b.payments.map((p) => ({ bookingRef: b.ref, receivedOn: p.receivedOn.toISOString().slice(0, 10), kind: p.kind, amountKobo: Number(p.amountKobo), method: p.method }))),
        messages: messages.map((m) => ({ createdAt: m.createdAt.toISOString(), channel: m.channel, subject: m.subject, status: m.status })),
      };
    });
  }

  anonymise(ctx: OrgCtx, id: string) {
    if (ctx.role !== 'admin') throw forbidden('Only an admin can remove guest data');
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const g = await tx.guest.findFirst({ where: { id, anonymisedAt: null } });
      if (!g) throw notFound('Guest');
      if (await tx.booking.findFirst({ where: { guestId: id, status: { in: ['tentative', 'confirmed', 'checked_in'] } } })) throw new AppError('INVALID_TRANSITION', 422, 'Cancel or finish their active bookings first');
      await tx.guest.updateMany({ where: { id }, data: { fullName: 'Removed guest', phoneE164: `+000${id.slice(-8)}`, email: null, notes: null, anonymisedAt: new Date() } });
      const bookingIds = (await tx.booking.findMany({ where: { guestId: id }, select: { id: true } })).map((b) => b.id);
      await tx.outboundMessage.updateMany({ where: { bookingId: { in: bookingIds } }, data: { recipient: '[removed]', bodyText: '[removed]', bodyHtml: null, subject: '[removed]' } });
      await this.audit.record(tx, { actor: ctx, action: 'guest.anonymise', entity: 'guest', entityId: id });
      return { ok: true };
    });
  }
```
(`+000…` is not valid E.164 per the zod schema, which is fine: it is never accepted as input; DB column has no format constraint.) Controller: `GET :id/export` (`guests.write`, sets the header via `@Res({ passthrough: true })`), `POST :id/anonymise` (`guests.write`, body `z.object({ confirm: z.literal('REMOVE') })`, 200).

UI `PrivacyActions.tsx` on `GuestDetail` (admin only): "Download data" (anchor to export URL) and "Remove guest data" (dialog: type REMOVE to confirm; shows the 422 message).

`docs/PRIVACY.md`: what Boogbe stores about guests/owners/staff, why (NDPA 2023 lawful basis: contract performance; legitimate interest for financial records), retention (financial records 6 years; anonymise on request), sub-processors (Cloudflare, Resend, Sentry, the VPS provider), how an operator handles a data request (export / remove buttons), breach contact. Operators link to it from their own privacy notices.

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(privacy): guest data export and anonymisation; privacy document [NFR-05]"`

---

### Task 2 (T-M8-02) [api][infra]: Security hardening

**Files:** Modify `apps/api/src/modules/ical/fetcher.ts` (pinned dispatcher), `apps/api/src/build-app.ts` (helmet config, `x-powered-by` off), `.github/workflows/ci.yml` (audit + gitleaks), Create `.gitleaks.toml`; Test `apps/api/src/modules/ical/fetcher-rebind.spec.ts`, `apps/api/test/security-headers.int.ts`.

**Interfaces:**
- `IcalFetcher` default `fetchImpl` uses an `undici` `Agent` whose `connect.lookup` re-runs `assertPublicHost` on the resolved address at connect time: `new Agent({ connect: { lookup: (host, opts, cb) => dns.lookup(host, { all: true }, (err, addrs) => { if (err) return cb(err); const bad = addrs.find((a) => !isPublic(a.address)); if (bad) return cb(new UnsafeUrlError('That address is not allowed')); cb(null, addrs); }) } })`.
- CI: `pnpm audit --prod --audit-level=high` (fails on high/critical) and `gitleaks/gitleaks-action@v2`.
- Response headers on API: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`; no `X-Powered-By`.
- Session cookie in production: `Secure; HttpOnly; SameSite=Lax; Domain=.boogbe.com` — asserted with `NODE_ENV=production` test env override of `useSecureCookies`.

- [ ] **Step 1: Failing tests**

`fetcher-rebind.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { pinnedLookup } from './fetcher';

describe('DNS rebinding protection [ICS-01]', () => {
  it('rejects at connect time when the second resolution is private', async () => {
    const answers = [[{ address: '34.1.1.1', family: 4 }], [{ address: '127.0.0.1', family: 4 }]];
    const fakeDns = (_h: string, _o: unknown, cb: (e: Error | null, a: { address: string; family: number }[]) => void) => cb(null, answers.shift()!);
    const lookup = pinnedLookup(fakeDns as never);
    const first = await new Promise((res) => lookup('evil.example', {}, (e, a) => res(e ?? a)));
    expect(first).toEqual([{ address: '34.1.1.1', family: 4 }]);
    const second = await new Promise((res) => lookup('evil.example', {}, (e) => res(e)));
    expect((second as Error).message).toBe('That address is not allowed');
  });
});
```
`security-headers.int.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';

describe('security headers [NFR-04]', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  it('sets hardening headers and hides the framework', async () => {
    const r = await t.http.get('/v1/health');
    expect(r.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement**

`fetcher.ts` additions:
```ts
import { lookup as dnsLookupCb } from 'node:dns';
import { Agent } from 'undici';

type LookupCb = (err: Error | null, addrs: { address: string; family: number }[]) => void;
export function pinnedLookup(dnsImpl: (h: string, o: object, cb: LookupCb) => void = (h, o, cb) => dnsLookupCb(h, { ...o, all: true }, cb as never)) {
  return (host: string, opts: object, cb: LookupCb) => dnsImpl(host, opts, (err, addrs) => {
    if (err) return cb(err, []);
    if (!addrs.length || addrs.some((a) => !isPublic(a.address))) return cb(new UnsafeUrlError('That address is not allowed'), []);
    cb(null, addrs);
  });
}
const pinnedAgent = new Agent({ connect: { lookup: pinnedLookup() as never }, headersTimeout: 15_000, bodyTimeout: 15_000 });
export const safeFetch: FetchImpl = (url, init) => fetch(url, { ...init, dispatcher: pinnedAgent } as RequestInit);
```
and make `new IcalFetcher()` default `fetchImpl = safeFetch`. (`isPublic` is already defined in this file.)

`build-app.ts`: `http.disable('x-powered-by'); http.use(helmet({ hsts: { maxAge: 31_536_000, includeSubDomains: true }, referrerPolicy: { policy: 'no-referrer' }, crossOriginResourcePolicy: { policy: 'same-site' }, contentSecurityPolicy: false }));` (CSP is not meaningful for a JSON API; the SPA's CSP is in `_headers`).

`.github/workflows/ci.yml` `verify` job, after install: `- run: pnpm audit --prod --audit-level=high`; new job:
```yaml
  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
```
`.gitleaks.toml`: `[allowlist] paths = ['''deploy/sql/roles.sql''', '''\.env\.example''']` (local-only passwords).

Cookie check: `apps/api/test/cookies.int.ts` builds the app with `NODE_ENV=production`, `COOKIE_DOMAIN=.boogbe.test`, signs in and asserts the `set-cookie` header contains `Secure`, `HttpOnly`, `SameSite=Lax`, `Domain=.boogbe.test`. (Use `createTestApp({ env: {...} })` — extend the helper to merge env overrides before `buildApp`.)

- [ ] **Step 4:** PASS (and CI green with audit + gitleaks). **Step 5: Commit** `git commit -m "chore(security): DNS-pinned iCal fetch, hardened headers, audit and secret scanning in CI [NFR-04 ICS-01]"`

---

### Task 3 (T-M8-03) [api][infra]: Structured logs, Sentry scrubbing, stale-job alerts

**Files:** Modify `apps/api/src/app.module.ts`, `worker.module.ts`, `main.ts`, `worker.ts`; Create `apps/api/src/common/observability/{logger.ts,sentry.ts,redact.ts}`, `apps/api/src/modules/platform/health.job.ts`, `platform.crons.ts`; Test `apps/api/src/common/observability/redact.spec.ts`, `apps/api/test/health-job.int.ts`.

**Interfaces:**
- `REDACT_PATHS` (pino) = `['req.headers.authorization','req.headers.cookie','res.headers["set-cookie"]','*.password','*.newPassword','*.token','*.phoneE164','*.phone','*.email','*.accountNumber','*.bodyText','*.bodyHtml']`; `scrub(obj)` generic deep-redactor used for Sentry `beforeSend` (replaces values of those keys with `'[redacted]'`, strips request `data` entirely).
- `LoggerModule.forRoot({ pinoHttp: { level, redact: REDACT_PATHS, genReqId: (req) => req.id, customProps: (req) => ({ orgId: req.ctx?.orgId, userId: req.ctx?.userId }) } })`.
- Sentry init (`@sentry/nestjs`) in `main.ts`/`worker.ts` when `SENTRY_DSN` set: `sendDefaultPii: false`, `beforeSend: (e) => scrub(e)`.
- `HealthJob.run(now?)` every 10 min (worker): for each window in Global Constraints, `SELECT max(finished_at) FROM job_run WHERE name = $1 AND ok` — if older than window (and the job ran at least once ever), email every platform admin (`user.role = 'admin'`) with subject `Boogbe job stale: <name>`; dedupe via an in-memory `Map<name, lastAlertAt>` (≥ 1 alert / name / 6 h). Also `once('health.check')` row so the health job itself is observable.
- `backup.nightly` writes a `job_run` row: `deploy/backup.sh` ends with `psql "$URL" -c "insert into job_run(id,name,started_at,finished_at,ok) values (gen_random_uuid()::text,'backup.nightly',now(),now(),true)"`.

- [ ] **Step 1: Failing tests**

`redact.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { scrub } from './redact';

describe('scrub [NFR-04 NFR-08]', () => {
  it('redacts secrets and guest PII at any depth and drops request bodies', () => {
    const out = scrub({ message: 'x', request: { headers: { cookie: 'a', authorization: 'b', 'user-agent': 'ua' }, data: { password: 'p' } }, extra: { guest: { phoneE164: '+234', email: 'a@b', fullName: 'Ada' }, accountNumber: '0123456789' } });
    expect(out).toEqual({ message: 'x', request: { headers: { cookie: '[redacted]', authorization: '[redacted]', 'user-agent': 'ua' } }, extra: { guest: { phoneE164: '[redacted]', email: '[redacted]', fullName: 'Ada' }, accountNumber: '[redacted]' } });
  });
});
```
`health-job.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedUser } from './helpers/users';
import { HealthJob } from '../src/modules/platform/health.job';
import { MAILER } from '../src/common/mail/mail.module';
import type { MemoryMailer } from '../src/common/mail/mailer';

describe('stale job alerts [NFR-08]', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await truncateAll(); });

  it('emails platform admins once when a job stops succeeding', async () => {
    const admin = await seedUser(t, { platformAdmin: true });
    const m = await migratorClient();
    await m.query(`insert into job_run(id, name, started_at, finished_at, ok) values ('j1','messaging.dispatch', now() - interval '1 hour', now() - interval '1 hour', true)`);
    await m.end();
    const mailer = t.app.get<MemoryMailer>(MAILER); mailer.sent.length = 0;
    const job = t.app.get(HealthJob);
    await job.run(); await job.run();
    const alerts = mailer.sent.filter((x) => x.to === admin.email && x.subject === 'Boogbe job stale: messaging.dispatch');
    expect(alerts).toHaveLength(1);
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `redact.ts`:
```ts
const KEYS = new Set(['authorization', 'cookie', 'set-cookie', 'password', 'newPassword', 'token', 'phoneE164', 'phone', 'email', 'accountNumber', 'bodyText', 'bodyHtml']);
export const REDACT_PATHS = ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', ...[...KEYS].map((k) => `*.${k}`)];
export function scrub<T>(v: T): T {
  if (Array.isArray(v)) return v.map(scrub) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === 'data' || k === 'cookies' || k === 'query_string') continue; // request bodies & raw cookies never leave
      out[k] = KEYS.has(k) ? '[redacted]' : scrub(val);
    }
    return out as T;
  }
  return v;
}
```
`health.job.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/db/prisma.service';
import { JobRunner } from '../../common/jobs/job-runner';
import { MAILER } from '../../common/mail/mail.module';
import type { Mailer } from '../../common/mail/mailer';

const WINDOWS_MIN: Record<string, number> = { 'ical.import': 20, 'messaging.dispatch': 5, 'bookings.expireHolds': 30, 'tasks.turnoverSweep': 120, 'backup.nightly': 26 * 60 };

@Injectable()
export class HealthJob {
  private readonly lastAlert = new Map<string, number>();
  constructor(private readonly prisma: PrismaService, private readonly runner: JobRunner, @Inject(MAILER) private readonly mailer: Mailer) {}
  async run(now = new Date()) {
    await this.runner.once('health.check', async () => {
      const admins = await this.prisma.user.findMany({ where: { role: 'admin' }, select: { email: true } });
      for (const [name, minutes] of Object.entries(WINDOWS_MIN)) {
        const last = await this.prisma.jobRun.findFirst({ where: { name, ok: true }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } });
        if (!last?.finishedAt) continue; // never ran yet (fresh install)
        if (now.getTime() - last.finishedAt.getTime() <= minutes * 60_000) continue;
        if (now.getTime() - (this.lastAlert.get(name) ?? 0) < 6 * 3_600_000) continue;
        this.lastAlert.set(name, now.getTime());
        for (const a of admins) await this.mailer.send({ to: a.email, subject: `Boogbe job stale: ${name}`, text: `${name} last succeeded ${last.finishedAt.toISOString()}. Check the worker: pm2 logs boogbe-prod-worker`, html: `<p><strong>${name}</strong> last succeeded ${last.finishedAt.toISOString()}.</p><p>Check the worker: <code>pm2 logs boogbe-prod-worker</code></p>` });
      }
    });
  }
}
```
(`messaging.dispatch` and `ical.import` now run per tick through `JobRunner` — confirm `MessagingCrons` wraps `dispatch` in `runner.once('messaging.dispatch', …)`; `IcalImportJob` uses `forEachActiveOrg('ical.import')`, which writes per-org rows — the health query uses the latest of any of them, which is correct.) Register `HealthJob` in `PlatformModule` (exported) and `PlatformCrons` (`*/10 * * * *`) in the worker. Logger + Sentry wiring per Interfaces; replace `Logger` usages remain compatible (Nest `Logger` routes through pino via `app.useLogger(app.get(Logger))`).

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(ops): structured redacted logs, Sentry scrubbing, stale-job alerts to platform admins [NFR-08]"`

---

### Task 4 (T-M8-04) [infra]: Performance seed, benchmark and index fixes

**Files:** Create `apps/api/scripts/perf-seed.ts`, `apps/api/scripts/perf-bench.ts`, `.github/workflows/perf.yml`; possibly a migration `00xx_perf_indexes`.

**Interfaces:**
- `perf-seed.ts <orgSlug>` — creates (idempotently, in batches of 500 via `createMany`) 5 properties × 10 units, 8,000 guests, 10,000 bookings over the past 18 months and next 6 months without overlaps (sequential per unit with random gaps), lines, and payments for 80 % of them; prints the admin credentials it created (`perf-admin@boogbe.test`).
- `perf-bench.ts` — signs in, then runs `autocannon` (10 connections, 20 s) against the four endpoints; prints p50/p95/p99; exits 1 if any p95 ≥ 300 ms.
- `perf.yml` — nightly on `main` (and `workflow_dispatch`): Postgres service, migrate, seed, start API in production mode, run bench, upload results.

- [ ] **Step 1: Implement seed** `apps/api/scripts/perf-seed.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { createAuth } from '../src/common/auth/auth';
import { MemoryMailer } from '../src/common/mail/mailer';
import { loadEnv } from '../src/env';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_MIGRATE_URL } } }); // migrator: BYPASSRLS for bulk load
let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const slug = process.argv[2] ?? 'perf';
  const env = loadEnv({ ...process.env, PLATFORM_ADMIN_EMAILS: 'perf-admin@boogbe.test' });
  let org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) org = await prisma.organization.create({ data: { id: uuidv7(), name: 'Perf Operator', slug } });
  const orgId = org.id;
  await prisma.orgSettings.upsert({ where: { orgId }, update: {}, create: { orgId, receiptPrefix: 'PRF', statementPrefix: 'PRF', bookingPrefix: 'PRF' } });
  const auth = createAuth({ prisma, mailer: new MemoryMailer(), env });
  let user = await prisma.user.findUnique({ where: { email: 'perf-admin@boogbe.test' } });
  if (!user) user = (await auth.api.signUpEmail({ body: { email: 'perf-admin@boogbe.test', password: 'perf-admin-password', name: 'Perf Admin' } })).user as never;
  if (!(await prisma.member.findFirst({ where: { organizationId: orgId, userId: user!.id } }))) await prisma.member.create({ data: { id: uuidv7(), organizationId: orgId, userId: user!.id, role: 'admin' } });
  if (await prisma.booking.count({ where: { orgId } }) >= 10_000) { console.log('already seeded'); return; }

  const units: { id: string }[] = [];
  for (let p = 0; p < 5; p++) {
    const propertyId = uuidv7();
    await prisma.property.create({ data: { id: propertyId, orgId, name: `Property ${p + 1}`, address: 'Lekki, Lagos' } });
    for (let u = 0; u < 10; u++) {
      const id = uuidv7(); units.push({ id });
      await prisma.unit.create({ data: { id, orgId, propertyId, name: `Unit ${p + 1}-${u + 1}`, bedrooms: 2, maxGuests: 4, nightlyRateKobo: BigInt(10_000_000 + Math.floor(rnd() * 20_000_000)) } });
      await prisma.unitOwnership.create({ data: { id: uuidv7(), orgId, unitId: id, ownerId: null, effectiveFrom: new Date('2024-01-01') } });
    }
  }
  const guests = Array.from({ length: 8000 }, (_, i) => ({ id: uuidv7(), orgId, fullName: `Guest ${i} ${['Okafor', 'Bakare', 'Adeyemi', 'Eze', 'Bello'][i % 5]}`, phoneE164: `+23480${String(10_000_000 + i).padStart(8, '0')}` }));
  for (let i = 0; i < guests.length; i += 500) await prisma.guest.createMany({ data: guests.slice(i, i + 500) });

  const start = new Date(); start.setUTCMonth(start.getUTCMonth() - 18);
  const bookings: object[] = []; const lines: object[] = []; const payments: object[] = []; let n = 0;
  for (const u of units) {
    const d = new Date(start);
    while (bookings.length < (units.indexOf(u) + 1) * 200) {
      d.setUTCDate(d.getUTCDate() + Math.floor(rnd() * 3));
      const nights = 1 + Math.floor(rnd() * 5);
      const ci = iso(d); d.setUTCDate(d.getUTCDate() + nights); const co = iso(d);
      const id = uuidv7(); const total = BigInt(nights * 15_000_000);
      const past = co < iso(new Date());
      bookings.push({ id, orgId, ref: `PRF-${String(++n).padStart(6, '0')}`, unitId: u.id, guestId: guests[Math.floor(rnd() * guests.length)]!.id, checkIn: new Date(ci), checkOut: new Date(co), guestCount: 2, source: 'whatsapp', status: past ? 'checked_out' : 'confirmed', computedTotalKobo: total, finalTotalKobo: total });
      lines.push({ id: uuidv7(), orgId, bookingId: id, position: 0, kind: 'accommodation', label: `${nights} nights`, quantity: nights, unitAmountKobo: 15_000_000n, amountKobo: total, refundable: false, recognition: 'per_night' });
      if (rnd() < 0.8) payments.push({ id: uuidv7(), orgId, bookingId: id, kind: 'payment', amountKobo: total, method: 'bank_transfer', receivedOn: new Date(ci) });
    }
  }
  for (let i = 0; i < bookings.length; i += 500) {
    await prisma.booking.createMany({ data: bookings.slice(i, i + 500) as never });
    await prisma.bookingLine.createMany({ data: lines.slice(i, i + 500) as never });
  }
  for (let i = 0; i < payments.length; i += 500) await prisma.payment.createMany({ data: payments.slice(i, i + 500) as never });
  console.log(`seeded ${bookings.length} bookings, ${guests.length} guests, ${units.length} units for ${slug}`);
}
main().finally(() => prisma.$disconnect());
```
- [ ] **Step 2: Bench** `apps/api/scripts/perf-bench.ts`:
```ts
import autocannon from 'autocannon';

const BASE = process.env.PERF_BASE ?? 'http://127.0.0.1:3060';
async function signIn() {
  const r = await fetch(`${BASE}/v1/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: process.env.APP_ORIGIN ?? 'http://localhost:5173' }, body: JSON.stringify({ email: 'perf-admin@boogbe.test', password: 'perf-admin-password' }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const orgs = await (await fetch(`${BASE}/v1/me`, { headers: { cookie } })).json();
  await fetch(`${BASE}/v1/auth/organization/set-active`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: process.env.APP_ORIGIN ?? 'http://localhost:5173' }, body: JSON.stringify({ organizationId: orgs.memberships[0].orgId }) });
  return cookie;
}
async function main() {
  const cookie = await signIn();
  const list = await (await fetch(`${BASE}/v1/bookings?limit=1`, { headers: { cookie } })).json();
  const today = new Date().toISOString().slice(0, 10); const to = new Date(Date.now() + 31 * 86_400_000).toISOString().slice(0, 10);
  const targets = { calendar: `/v1/calendar?from=${today}&to=${to}`, bookings: '/v1/bookings?limit=30', booking: `/v1/bookings/${list.items[0].id}`, guests: '/v1/guests?q=okafor' };
  let failed = false;
  for (const [name, path] of Object.entries(targets)) {
    const r = await autocannon({ url: `${BASE}${path}`, connections: 10, duration: 20, headers: { cookie } });
    const p95 = r.latency.p97_5 ?? r.latency.p99; // autocannon reports p97_5; use it as a conservative p95
    console.log(`${name.padEnd(9)} p50=${r.latency.p50}ms p95≈${p95}ms p99=${r.latency.p99}ms rps=${r.requests.average} non2xx=${r.non2xx}`);
    if (p95 >= 300 || r.non2xx > 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
void main();
```
(Rate limiting: run the API with `NODE_ENV=production` but a raised throttler limit via `THROTTLE_LIMIT=100000` env — add `THROTTLE_LIMIT` to `env.ts` (default 120) and use it in `ThrottlerModule.forRoot`.)

- [ ] **Step 3: Run locally and fix** — `pnpm --filter @boogbe/api exec tsx scripts/perf-seed.ts perf && pnpm --filter @boogbe/api build && NODE_ENV=production THROTTLE_LIMIT=100000 node apps/api/dist/main.js & pnpm --filter @boogbe/api exec tsx scripts/perf-bench.ts`. Expected likely hotspots and their fixes (apply only those the bench proves necessary; each fix gets a migration and a before/after number in the PR):
  - `GET /v1/bookings` hydrate + `decorate` per booking → replace the per-booking `entriesFor` with one query (already batched) and ensure index `payment(org_id, booking_id)` exists (`@@index([orgId, bookingId, createdAt])` covers it).
  - `TasksService.hydrate` next-arrival query per row → batch with one `DISTINCT ON (unit_id)` query.
  - Calendar: index `booking(org_id, unit_id, check_in)` exists; add `CREATE INDEX booking_unit_range ON booking USING gist (unit_id, daterange(check_in, check_out, '[)'))` if the range filter dominates (the exclusion constraint already creates a gist index — verify with `EXPLAIN ANALYZE` that it is used).
  - Guest search: trigram index exists; ensure the query uses `ILIKE` on `full_name` (it does) and add `CREATE INDEX guest_phone_trgm ON guest USING gin (phone_e164 gin_trgm_ops)` for the phone `LIKE '%…%'`.
- [ ] **Step 4: CI** `.github/workflows/perf.yml`:
```yaml
name: Perf
on: { schedule: [{ cron: '0 2 * * *' }], workflow_dispatch: {} }
jobs:
  bench:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres }
        ports: ['5433:5432']
        options: --health-cmd "pg_isready -U postgres" --health-interval 5s --health-retries 10
    env:
      DATABASE_URL: postgresql://boogbe_app:app@localhost:5433/boogbe_dev
      DATABASE_MIGRATE_URL: postgresql://boogbe_migrator:migrator@localhost:5433/boogbe_dev
      BETTER_AUTH_SECRET: perf-secret-perf-secret-perf-secret-perf-1
      BETTER_AUTH_URL: http://localhost:5173
      APP_ORIGIN: http://localhost:5173
      API_PUBLIC_ORIGIN: http://127.0.0.1:3060
      THROTTLE_LIMIT: '100000'
      R2_ENDPOINT: https://example.invalid
      R2_BUCKET: x
      R2_ACCESS_KEY_ID: x
      R2_SECRET_ACCESS_KEY: x
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: |
          PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -f deploy/sql/roles.sql
          PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -f deploy/sql/db-init.sql
      - run: pnpm --filter @boogbe/api prisma:generate && DATABASE_URL=$DATABASE_MIGRATE_URL pnpm --filter @boogbe/api prisma:migrate:deploy
      - run: pnpm --filter @boogbe/api exec tsx scripts/perf-seed.ts perf
      - run: pnpm --filter @boogbe/api build
      - run: (NODE_ENV=production node apps/api/dist/main.js &) && sleep 5 && pnpm --filter @boogbe/api exec tsx scripts/perf-bench.ts
```
(`NODE_ENV=production` requires R2 env — dummy values are fine because the bench never touches files.)

- [ ] **Step 5: Commit** `git commit -m "test(perf): 10k-booking seed, autocannon benchmark with p95 gate, nightly perf workflow [NFR-02]"`

---

### Task 5 (T-M8-05) [ui]: Accessibility pass

**Files:** Create `e2e/a11y.spec.ts`; fix violations in `apps/app/src/**`; update `docs/TESTING.md` (a11y suite).

- [ ] **Step 1: Failing test** `e2e/a11y.spec.ts`:
```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { resetDb } from './fixtures';
import { createUnit, onboardOperator } from './helpers';

test.beforeAll(() => resetDb());

const PAGES = ['/calendar', '/bookings', '/guests', '/money', '/tasks', '/settings', '/settings/properties', '/settings/team', '/settings/messages', '/statements', '/expenses', '/conflicts'];

test('core pages have no serious or critical axe violations [NFR-06]', async ({ page, browser }) => {
  const admin = await onboardOperator(page, browser, 'tanu-a11y');
  await createUnit(admin, { property: 'The Rock', unit: 'Kairo', rateNaira: '200000' });
  for (const path of PAGES) {
    await admin.goto(path);
    await admin.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page: admin }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${path}: ${v.id} (${v.nodes.length})`);
    expect(bad, bad.join('\n')).toEqual([]);
  }
  await admin.goto('/auth/sign-in');
});

test('sign-in and accept-invite pages pass axe', async ({ page }) => {
  await page.goto('/auth/sign-in');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
});
```
- [ ] **Step 2:** `pnpm add -Dw @axe-core/playwright && pnpm test:e2e -- a11y` → expect failures; list them in the PR.
- [ ] **Step 3: Fix** each violation at its source. Known likely ones and their fixes: icon-only buttons without names (add `aria-label`), colour contrast of `text-ink-muted` on `bg-surface-2` (darken `--color-ink-muted` to `#4f6166` in light mode), calendar grid cells without accessible names (add `aria-label="<unit> <date> free"`), dialogs missing focus return (store `document.activeElement` on open and restore on close in `Dialog`), form fields without labels in filters (use `aria-label`). Also verify keyboard-only flow for creating a booking (Tab order, Enter on the guest listbox).
- [ ] **Step 4:** a11y suite PASS; add it to the `e2e` CI job. **Step 5: Commit** `git commit -m "fix(a11y): resolve axe serious/critical issues; add accessibility suite [NFR-06]"`

---

### Task 6 (T-M8-06) [infra]: Automated restore check

**Files:** Create `deploy/restore-check.sh`; modify `docs/RUNBOOK.md`; cron entry.

**Interfaces:** `deploy/restore-check.sh <prod|staging>` — downloads the newest R2 backup, restores into a throw-away database `boogbe_restore_check`, runs sanity queries (row counts for `organization`, `booking`, `payment`; `max(created_at)` within 26 h; `select count(*) from payment p where not exists (select 1 from booking b where b.id = p.booking_id)` = 0), records a `job_run` row `backup.restore_check` (ok/err) in the **live** DB, drops the temp DB. Exit non-zero on any failure. Monthly cron (1st, 03:00 Lagos). `HealthJob` window for `backup.restore_check`: 32 days.

- [ ] **Step 1: Implement** `deploy/restore-check.sh`:
```bash
#!/bin/bash
set -euo pipefail
INSTANCE="${1:?usage: restore-check.sh prod|staging}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"; cd "$DIR"
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
URL="$(env_get DATABASE_MIGRATE_URL)"; URL="${URL%%\?*}"
BASE="${URL%/*}"; TMPDB="boogbe_restore_check"
export AWS_ACCESS_KEY_ID="$(env_get R2_ACCESS_KEY_ID)" AWS_SECRET_ACCESS_KEY="$(env_get R2_SECRET_ACCESS_KEY)" AWS_DEFAULT_REGION=auto
ENDPOINT="$(env_get R2_ENDPOINT)"; BUCKET="$(env_get R2_BUCKET)"
record() { psql "$URL" -qtc "insert into job_run(id,name,started_at,finished_at,ok,error) values (gen_random_uuid()::text,'backup.restore_check',now(),now(),$1,$2)"; }
trap 'record false "'"'"'restore check failed (see logs)'"'"'"; psql "$BASE/postgres" -qtc "drop database if exists $TMPDB" || true' ERR
KEY=$(aws s3 ls "s3://$BUCKET/backups/$INSTANCE/" --recursive --endpoint-url "$ENDPOINT" | sort | tail -1 | awk '{print $4}')
[ -n "$KEY" ] || { echo "no backups found"; exit 1; }
TMP=$(mktemp); aws s3 cp "s3://$BUCKET/$KEY" "$TMP" --endpoint-url "$ENDPOINT" --only-show-errors
psql "$BASE/postgres" -qtc "drop database if exists $TMPDB"; psql "$BASE/postgres" -qtc "create database $TMPDB"
pg_restore --no-owner --no-acl -d "$BASE/$TMPDB" "$TMP"; rm -f "$TMP"
q() { psql "$BASE/$TMPDB" -Atqc "$1"; }
ORGS=$(q "select count(*) from organization"); BOOKINGS=$(q "select count(*) from booking")
FRESH=$(q "select coalesce(max(created_at) > now() - interval '26 hours', false) from audit_log")
ORPHANS=$(q "select count(*) from payment p where not exists (select 1 from booking b where b.id = p.booking_id)")
echo "backup=$KEY orgs=$ORGS bookings=$BOOKINGS fresh=$FRESH orphan_payments=$ORPHANS"
[ "$ORGS" -gt 0 ] && [ "$ORPHANS" = 0 ] || { echo "sanity check failed"; false; }
[ "$FRESH" = t ] || echo "warning: no audit activity in the last 26h (quiet period or stale backup)"
psql "$BASE/postgres" -qtc "drop database $TMPDB"
record true NULL
echo "restore check ok"
```
(`boogbe_migrator` has `CREATEDB`, so it can create/drop the temp database. Add `backup.restore_check: 32 * 24 * 60` to `HealthJob` windows.)
- [ ] **Step 2: Verify on staging** — run `bash deploy/restore-check.sh staging`; paste output into the PR. Add cron: `0 2 1 * * /home/boogbe/app/deploy/restore-check.sh prod >> /home/boogbe/app/logs/restore-check.log 2>&1`. Update RUNBOOK: the monthly drill is now automated; the manual drill table remains for quarterly full-restore rehearsals.
- [ ] **Step 3: Commit** `git commit -m "chore(ops): automated monthly restore check with sanity queries [NFR-03]"`

---

### Task 7 (T-M8-07) [docs]: Security review

**Files:** Create `docs/SECURITY.md`.

- [ ] **Step 1:** Run the `security-review` skill (Claude Code) over the whole repo, plus a manual pass with this checklist; record each item as *Pass / Fixed in <PR> / Accepted risk (reason)*:
  1. Tenant isolation: OrgDb-only access, RLS forced on every tenant table (`rls.int.ts`), cross-tenant sweep green, security-definer functions (`ical_export_lookup`, `claim_outbound`) return ids only and are `REVOKE`d from `PUBLIC`.
  2. AuthN: invite-only sign-up, lockout, reset token expiry, session revocation on reset, cookie flags (T-M8-02 test).
  3. AuthZ: every route has an access rule (`route-permissions.spec.ts`), DB-checked roles, landlord/housekeeper row scoping (portal, my-tasks).
  4. Input handling: zod on every body/query, Prisma parameterisation, raw SQL reviewed (`$queryRaw` tagged templates only — grep for `$queryRawUnsafe`/`$executeRawUnsafe`: must be zero).
  5. SSRF: iCal fetcher (public-IP check + DNS pinning + redirect re-check + size/time caps).
  6. Files: presigned URLs 5 min, kind/size/type checks, private bucket, no user-controlled keys.
  7. Output: emails escape template HTML; PDFs contain no secrets; `.ics` exports no PII.
  8. Secrets & supply chain: gitleaks, `pnpm audit`, lockfile, pinned GitHub Actions major versions.
  9. Infra: origin reachable only from Cloudflare IPs; SSH key-only; Postgres listens on localhost; backups encrypted at rest (R2) and tested.
  10. Logging/PII: redaction test, Sentry scrubbing.
  11. Abuse: rate limits on auth, invitations, public `.ics`, sync-now.
- [ ] **Step 2:** For each "Accepted risk" add an owner-visible note and a revisit date. Commit `git commit -m "docs(security): v1 security review and threat model [NFR-04]"`.

---

### Task 8 (T-M8-08) [ops]: Second operator onboarding — exit gate

Checklist executed by Claude Code with the owner; each box needs evidence in the PR description.

- [ ] **Step 1: Pre-flight** — CI green on `main` (unit, integration, E2E-01..07, a11y, perf nightly last run green), `docs/SECURITY.md` has no open "Fix before launch" items, restore check ran OK this month.
- [ ] **Step 2: Isolation rehearsal on staging** — create two operators ("Tanuhomes Staging" with seeded data, "Operator Two"), sign in as Operator Two's admin, and confirm with the browser and with `curl`-equivalent requests (`admin.request` in a Playwright script `e2e/two-operators.spec.ts`) that every list endpoint returns only Operator Two's rows and that fetching three known Tanuhomes ids (booking, guest, statement) returns 404. Commit the spec; it joins the E2E suite permanently.
- [ ] **Step 3: Onboard the real second operator in production** — platform admin creates the operator, invites its admin; operator admin configures properties/units/fees/owners themselves (no data entry by EDGD beyond help); connects at least one iCal feed; records a first booking and payment. **No code changes or migrations are deployed for this operator** — if anything blocks them, log it as a new FRD item and fix it as a normal task after the exit decision.
- [ ] **Step 4: Two-week check** — after 14 days: both operators active; zero cross-tenant incidents; zero double bookings (`select count(*) from sync_conflict where status='open' and created_at < now() - interval '2 days'` reviewed); job health alerts all resolved.
- [ ] **Step 5: Sign-off** — owner confirms in the PR; update `docs/COORDINATION.md` T-M8-08 → done; add a `docs/DECISIONS.md` entry recording v1 completion and what Phase B starts with.

---

## Self-review notes (completed)
- Coverage: NFR-02 (T4), NFR-03 (T6), NFR-04 (T2, T3, T7), NFR-05 (T1), NFR-06 (T5), NFR-07 (done in M6, re-checked by CI size script), NFR-08 (T3), NFR-09 (formatting helpers since M0; a11y suite checks `lang="en-NG"`). PRD exit metric: T8.
- New env: `THROTTLE_LIMIT`. New jobs: `health.check`, `backup.restore_check`. New files: `docs/PRIVACY.md`, `docs/SECURITY.md`, `e2e/a11y.spec.ts`, `e2e/two-operators.spec.ts`.
