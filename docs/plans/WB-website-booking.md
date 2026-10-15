# WB — Website booking requests (Stage 1 of online booking) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Claim tasks on the board in `docs/COORDINATION.md` as usual.

**Goal:** Guests on tanuhomes.com see live availability and an exact quote from Boogbe and submit a booking request that becomes a short-held tentative booking, with email to the team and the guest.

**Architecture:** A new unauthenticated `modules/public` in the API, keyed by org slug and switched off per org by default, reuses the existing pricing, availability (`CalendarSources`), booking creation, hold-expiry job and M5 outbox. The static Tanuhomes Astro site gains a vanilla-TS booking widget that calls `api.boogbe.com` directly. The app gets settings, a unit toggle and front-desk affordances.

**Tech Stack:** NestJS + Prisma + Postgres (RLS), `@nestjs/throttler`, Cloudflare Turnstile (server verify via `fetch`), Resend through the M5 outbox, React/Vite app, Astro 7 static site with plain TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-15-public-booking-requests-design.md`

**Prerequisites:** T-M5-03 (#71) and T-M5-04 merged to `dev` (this plan uses `TemplatesService`, `VarsService`, `OutboxService`). T-M5-05…07 stay paused until WB is live.

## Spec deviations (decided while planning, 2026-10-15)

1. **"Confirmed" guest email** reuses the existing `booking_confirmation` template, queued with the same dedupe key T-M5-05 will use (`auto-booking_confirmation-<bookingId>`), so it never double-sends when M5-05 lands. Only `website` bookings get it in WB.
2. **Team email** is a fixed system email built in code (like `alert-mailer.ts`), not an editable template: it carries app deep links and guest-supplied text that must not pass through template rendering.
3. **"New website requests" card** goes at the top of `/bookings`; there is no Today page yet. Move it to Today when that page exists.
4. iCal-imported blocks are **hard** unavailability for the public (the back office treats them as warnings).

## Global Constraints

- Every public route resolves `:slug` through `public_org_lookup(slug)`; unknown, suspended or `public_enabled = false` orgs and unlisted/inactive units all return `404 UNAVAILABLE` with message "Online booking is not available".
- Public responses never include guest names, booking refs (other than the requester's own new ref), sources, block reasons or member data.
- `public_hold_minutes` default 120, allowed 15–1440.
- Throttles per IP: units 60/min, availability 60/min, quote 30/min, requests 5 per 10 min.
- Availability window ≤ 90 days; `from` ≥ today in org timezone; stays ≤ 30 nights.
- Money in kobo integers on the wire; ₦ formatting only in UI/emails.
- Request emails never fail the request (queue after the booking row exists, inside the same tx via the outbox).
- App-wide CORS (`APP_ORIGIN`, credentials) is unchanged; `/v1/public/*` uses per-org `public_origins`, no credentials.
- Booking source value is `website`, label "Website".
- No new runtime dependencies in the API or the Tanuhomes site.

## Review Focus

1. **Two guests request the same nights at the same moment** → exactly one `201`, the other `409 DATES_UNAVAILABLE` (test in T-WB-05).
2. **Same phone number submits twice** (fat-finger, refresh) → second request for overlapping nights gets `409`, and the guest row is reused, not duplicated (T-WB-05).
3. **A guest-supplied name/note containing Markdown or links** (`[click](https://evil)`, `**x**`) → appears as plain text in the team email (T-WB-05 `plain()` test).
4. **Hold expires while the front desk has the booking open** → confirm returns `409 CONFLICT`/`INVALID_TRANSITION`, UI shows the refresh message (existing transition guard; T-WB-07 renders the error).
5. **Browser in a different timezone than Lagos** → calendar "today" and blocked nights use the dates the API returns, never `new Date()` local-day maths for availability (T-WB-08 unit test with `TZ=America/New_York`).

## Task overview

| Task | Track | Agent | Depends on |
|---|---|---|---|
| T-WB-01 Migration 0008: public flags, settings, `website` source, `public_org_lookup()` | schema | claude | M5-04 merged |
| T-WB-02 Shared: source, errors, notification kind, public contracts, settings/unit fields, two templates + placeholders | domain, contract | claude | — |
| T-WB-03 Settings + unit `publicListed` API; `createIn` refactor with nullable actor | api | claude | 01, 02 |
| T-WB-04 Public read API: org resolver, CORS, units, availability, quote | api | claude | 03 |
| T-WB-05 Public request API: Turnstile, guest upsert, tentative hold, notification, emails | api | claude | 04 |
| T-WB-06 App: Settings → Online booking, unit "Show on website" | ui | opencode | 02 (stub), merge after 03 |
| T-WB-07 App: Website badge, hold countdown, requests card, Decline | ui | opencode | 02 (stub), merge after 05 |
| T-WB-08 Tanuhomes site: booking widget | site | opencode | 04 merged to staging |
| T-WB-09 Staging verification, prod enable, Alaska-first rollout | infra | planner + owner | all |

---

### Task 1 (T-WB-01) [schema]: Migration 0008 — public booking

**Files:**
- Create: `prisma/migrations/0008_public_booking/migration.sql`
- Modify: `prisma/schema.prisma` (models `Unit`, `OrgSettings`)
- Modify: `docs/DATA_MODEL.md` (`unit.public_listed`, the five `org_settings` columns, `website` in the booking `source` list, `public_org_lookup()`) — this task says so, so the docs edit belongs in this branch
- Test: `apps/api/test/public-schema.int.ts`

**Interfaces:**
- Produces: columns `unit.public_listed`, `org_settings.public_enabled|public_hold_minutes|public_origins|public_site_url|notify_emails`; Prisma fields `publicListed`, `publicEnabled`, `publicHoldMinutes`, `publicOrigins`, `publicSiteUrl`, `notifyEmails`; SQL function `public_org_lookup(p_slug text) RETURNS TABLE(org_id text, timezone text, public_origins text[], public_hold_minutes int)`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/public-schema.int.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';
import { seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';

describe('0008 public booking schema', () => {
  let m: Awaited<ReturnType<typeof migratorClient>>;
  beforeEach(async () => {
    await truncateAll();
    m = await migratorClient();
  });
  afterAll(async () => m?.end());

  it('defaults are off and safe', async () => {
    const org = await seedOrg();
    const unitId = await seedUnit(org.id, await seedProperty(org.id));
    const u = await m.query('select public_listed from unit where id=$1', [unitId]);
    expect(u.rows[0].public_listed).toBe(false);
    const s = await m.query('select public_enabled, public_hold_minutes, public_origins, notify_emails, public_site_url from org_settings where org_id=$1', [org.id]);
    expect(s.rows[0]).toEqual({ public_enabled: false, public_hold_minutes: 120, public_origins: [], notify_emails: [], public_site_url: null });
  });

  it('rejects hold minutes outside 15–1440', async () => {
    const org = await seedOrg();
    await expect(m.query('update org_settings set public_hold_minutes=5 where org_id=$1', [org.id])).rejects.toThrow(/org_settings_public_hold_chk/);
  });

  it('accepts website as a booking source', async () => {
    const org = await seedOrg();
    const unitId = await seedUnit(org.id, await seedProperty(org.id));
    const guestId = await seedGuest(org.id);
    await m.query(
      `insert into booking(id, org_id, ref, unit_id, guest_id, check_in, check_out, guest_count, source, status, computed_total_kobo, final_total_kobo, updated_at)
       values ($1,$2,'W-1',$3,$4,'2027-01-01','2027-01-03',2,'website','tentative',1,1,now())`,
      [newId(), org.id, unitId, guestId],
    );
  });

  it('public_org_lookup only returns active, enabled orgs', async () => {
    const org = await seedOrg();
    const slug = (await m.query('select slug from organization where id=$1', [org.id])).rows[0].slug;
    expect((await m.query('select * from public_org_lookup($1)', [slug])).rows).toEqual([]);
    await m.query(`update org_settings set public_enabled=true, public_origins='{https://tanuhomes.com}' where org_id=$1`, [org.id]);
    expect((await m.query('select * from public_org_lookup($1)', [slug])).rows).toEqual([
      { org_id: org.id, timezone: 'Africa/Lagos', public_origins: ['https://tanuhomes.com'], public_hold_minutes: 120 },
    ]);
    await m.query(`update organization set status='suspended' where id=$1`, [org.id]);
    expect((await m.query('select * from public_org_lookup($1)', [slug])).rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @boogbe/api test:int -- public-schema`
Expected: FAIL — `column "public_listed" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- prisma/migrations/0008_public_booking/migration.sql
ALTER TABLE unit ADD COLUMN public_listed boolean NOT NULL DEFAULT false;

ALTER TABLE org_settings
  ADD COLUMN public_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN public_hold_minutes integer NOT NULL DEFAULT 120,
  ADD COLUMN public_origins      text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN public_site_url     text,
  ADD COLUMN notify_emails       text[]  NOT NULL DEFAULT '{}';
ALTER TABLE org_settings ADD CONSTRAINT org_settings_public_hold_chk CHECK (public_hold_minutes BETWEEN 15 AND 1440);

ALTER TABLE booking DROP CONSTRAINT booking_source_chk;
ALTER TABLE booking ADD CONSTRAINT booking_source_chk
  CHECK (source IN ('whatsapp','phone','walk_in','direct','airbnb','booking_com','website','other'));

-- Public routes have no org context yet; this is the only cross-org read they make (same pattern as ical_export_lookup).
CREATE OR REPLACE FUNCTION public_org_lookup(p_slug text)
RETURNS TABLE (org_id text, timezone text, public_origins text[], public_hold_minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.timezone, s.public_origins, s.public_hold_minutes
  FROM organization o JOIN org_settings s ON s.org_id = o.id
  WHERE o.slug = p_slug AND o.status = 'active' AND s.public_enabled
$$;
ALTER FUNCTION public_org_lookup(text) OWNER TO boogbe_migrator;
REVOKE ALL ON FUNCTION public_org_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_org_lookup(text) TO boogbe_app;
```

In `prisma/schema.prisma` add to `model Unit` after `active`:

```prisma
  publicListed            Boolean         @default(false) @map("public_listed")
```

and to `model OrgSettings` after `logoKey`:

```prisma
  publicEnabled        Boolean      @default(false) @map("public_enabled")
  publicHoldMinutes    Int          @default(120) @map("public_hold_minutes")
  publicOrigins        String[]     @default([]) @map("public_origins")
  publicSiteUrl        String?      @map("public_site_url")
  notifyEmails         String[]     @default([]) @map("notify_emails")
```

- [ ] **Step 4: Apply and run tests**

Run: `pnpm db:migrate:test && pnpm --filter @boogbe/api test:int -- public-schema migrations`
Expected: PASS (and `migrations.int.ts` still green — it checks drift between schema.prisma and SQL).

- [ ] **Step 5: Commit**

```bash
git add prisma docs/DATA_MODEL.md apps/api/test/public-schema.int.ts
git commit -m "feat(schema): 0008 public booking flags, settings, website source [T-WB-01]"
```

---

### Task 2 (T-WB-02) [domain][contract]: Shared enums, errors, contracts, templates

**Files:**
- Modify: `packages/shared/src/contracts/bookings.ts` (source enum + label)
- Modify: `packages/shared/src/errors.ts` (append codes)
- Modify: `packages/shared/src/contracts/notifications.ts` (append kind)
- Modify: `packages/shared/src/contracts/org.ts` (settings fields)
- Modify: `packages/shared/src/contracts/inventory.ts` (unit `publicListed`)
- Create: `packages/shared/src/contracts/public.ts`, `packages/shared/src/contracts/public.test.ts`
- Modify: `packages/shared/src/domain/templates.ts`, `template-defaults.ts`, `templates.test.ts`
- Modify: `packages/shared/src/index.ts` (export public contracts)

**Interfaces:**
- Produces:
  - `BookingSourceEnum` includes `'website'`; `SOURCE_LABELS.website = 'Website'`.
  - `ERROR_CODES` += `'UNAVAILABLE'`, `'VERIFICATION_FAILED'`, `'TOO_MANY_GUESTS'`, `'INVALID_DATES'`.
  - `NotificationKind` += `'website_request'`.
  - `TEMPLATE_KEYS` += `'website_request_received'`, `'website_request_closed'` (both `autoEmail: true`).
  - `PLACEHOLDERS` += `'booking.holdUntil'`, `'operator.website'`.
  - From `contracts/public.ts`: `PublicUnit`, `PublicUnitsResponse`, `AvailabilityQuery`, `AvailabilityResponse`, `PublicQuoteQuery`, `PublicQuoteResponse`, `BookingRequestInput`, `BookingRequestResponse`, `MAX_WINDOW_DAYS = 90`, `MAX_NIGHTS = 30`.
  - `OrgSettingsResponse.settings` += `publicEnabled: boolean, publicHoldMinutes: number, publicOrigins: string[], publicSiteUrl: string | null, notifyEmails: string[]`; `UpdateOrgSettingsInput` accepts the same (all optional).
  - Unit response + `UpdateUnitInput` += `publicListed: boolean` (optional on input).
  - `BookingSummary` += `holdUntil: string | null` (ISO timestamp), so list views can show hold countdowns without per-row detail fetches.

- [ ] **Step 1: Write the failing contract test**

```ts
// packages/shared/src/contracts/public.test.ts
import { describe, expect, it } from 'vitest';
import { AvailabilityQuery, BookingRequestInput, PublicQuoteQuery } from './public';

describe('public contracts', () => {
  it('availability window ≤ 90 days and ordered', () => {
    expect(AvailabilityQuery.safeParse({ from: '2026-11-01', to: '2027-01-30' }).success).toBe(true);
    expect(AvailabilityQuery.safeParse({ from: '2026-11-01', to: '2027-02-01' }).success).toBe(false);
    expect(AvailabilityQuery.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success).toBe(false);
  });
  it('quote coerces guests and caps nights', () => {
    expect(PublicQuoteQuery.parse({ checkIn: '2026-11-01', checkOut: '2026-11-03', guests: '2' }).guests).toBe(2);
    expect(PublicQuoteQuery.safeParse({ checkIn: '2026-11-01', checkOut: '2026-12-05', guests: '2' }).success).toBe(false);
  });
  it('request normalises phone and trims text', () => {
    const r = BookingRequestInput.parse({
      unitId: 'u1', checkIn: '2026-11-01', checkOut: '2026-11-03', guests: 2,
      fullName: '  Ada  Obi ', phone: '0803 000 0000', email: '', note: ' hi ', turnstileToken: 't',
    });
    expect(r).toMatchObject({ fullName: 'Ada  Obi', phone: '+2348030000000', email: undefined, note: 'hi' });
    expect(BookingRequestInput.safeParse({ ...r, phone: '12' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @boogbe/shared test -- public`
Expected: FAIL — cannot find module `./public`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/contracts/public.ts
import { z } from 'zod';
import { isIsoDate, nightsBetween } from '../domain/dates';
import { normalizePhone } from '../domain/phone';
import { PriceLineSchema } from './bookings';

export const MAX_WINDOW_DAYS = 90;
export const MAX_NIGHTS = 30;
const Day = z.string().refine(isIsoDate, 'Use YYYY-MM-DD');

export const PublicUnit = z.object({
  id: z.string(), propertyId: z.string(), propertyName: z.string(), name: z.string(),
  bedrooms: z.number().int(), maxGuests: z.number().int(), nightlyRateKobo: z.number().int(),
});
export type PublicUnit = z.infer<typeof PublicUnit>;
export const PublicUnitsResponse = z.object({ units: z.array(PublicUnit) });

export const AvailabilityQuery = z
  .object({ from: Day, to: Day })
  .refine((q) => q.to > q.from && nightsBetween(q.from, q.to) <= MAX_WINDOW_DAYS, { message: `Window must be 1–${MAX_WINDOW_DAYS} days`, path: ['to'] });
export const AvailabilityResponse = z.object({
  unitId: z.string(), from: Day, to: Day, blockedNights: z.array(Day), checkInTime: z.string(), checkOutTime: z.string(),
});
export type AvailabilityResponse = z.infer<typeof AvailabilityResponse>;

const stay = <T extends { checkIn: string; checkOut: string }>(s: T) => s.checkOut > s.checkIn && nightsBetween(s.checkIn, s.checkOut) <= MAX_NIGHTS;
export const PublicQuoteQuery = z
  .object({ checkIn: Day, checkOut: Day, guests: z.coerce.number().int().min(1).max(20) })
  .refine(stay, { message: `Stays are 1–${MAX_NIGHTS} nights`, path: ['checkOut'] });
export const PublicQuoteResponse = z.object({
  nights: z.number().int(), lines: z.array(PriceLineSchema.pick({ label: true, amountKobo: true, kind: true })),
  totalKobo: z.number().int(), depositKobo: z.number().int(),
});
export type PublicQuoteResponse = z.infer<typeof PublicQuoteResponse>;

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
export const BookingRequestInput = z
  .object({
    unitId: z.string().min(1), checkIn: Day, checkOut: Day, guests: z.number().int().min(1).max(20),
    fullName: z.string().trim().min(2).max(100),
    phone: z.string().transform((v, c) => normalizePhone(v) ?? (c.addIssue({ code: 'custom', message: 'Enter a valid phone number' }), z.NEVER)),
    email: z.union([z.literal(''), z.string().trim().email().max(150)]).optional().transform((v) => (v ? v : undefined)),
    note: optionalText(1000),
    turnstileToken: z.string().min(1).max(2048),
  })
  .refine(stay, { message: `Stays are 1–${MAX_NIGHTS} nights`, path: ['checkOut'] });
export type BookingRequestInput = z.infer<typeof BookingRequestInput>;
export const BookingRequestResponse = z.object({ ref: z.string(), holdUntil: z.string(), totalKobo: z.number().int() });
export type BookingRequestResponse = z.infer<typeof BookingRequestResponse>;
```

Append-only edits:
- `contracts/bookings.ts`: `BookingSourceEnum = z.enum(['whatsapp', 'phone', 'walk_in', 'direct', 'airbnb', 'booking_com', 'website', 'other'])`; add `website: 'Website'` to `SOURCE_LABELS`. If the app's New Booking form lists sources from `SOURCE_LABELS`, filter `website` out there (front desk never picks it): `Object.entries(SOURCE_LABELS).filter(([k]) => k !== 'website')`.
- `errors.ts`: append `'UNAVAILABLE', 'VERIFICATION_FAILED', 'TOO_MANY_GUESTS', 'INVALID_DATES'` to `ERROR_CODES`.
- `contracts/notifications.ts`: append `'website_request'` to `NotificationKind`.
- `contracts/org.ts`: add to `OrgSettingsResponse.settings`: `publicEnabled: z.boolean(), publicHoldMinutes: z.number().int(), publicOrigins: z.array(z.string()), publicSiteUrl: z.string().nullable(), notifyEmails: z.array(z.string())`. Add to the settings update input: `publicEnabled: z.boolean().optional(), publicHoldMinutes: z.number().int().min(15).max(1440).optional(), publicOrigins: z.array(z.string().url().transform((u) => new URL(u).origin)).max(5).optional(), publicSiteUrl: z.string().url().startsWith('https://').nullable().optional(), notifyEmails: z.array(z.string().email()).max(5).optional()`.
- `contracts/inventory.ts`: unit response `publicListed: z.boolean()`; unit update input `publicListed: z.boolean().optional()`.
- `contracts/bookings.ts`: add `holdUntil: z.string().nullable()` to `BookingSummary` (additive).
- `domain/templates.ts`: append to `TEMPLATE_KEYS` `'website_request_received', 'website_request_closed'`; labels `website_request_received: 'Website request received'`, `website_request_closed: 'Website request not confirmed'`; append `'booking.holdUntil', 'operator.website'` to `PLACEHOLDERS`; `SAMPLE_VARS` add `'booking.holdUntil': '1 Nov 2026, 4:30 pm'`, `'operator.website': 'https://tanuhomes.com'`.
- `domain/template-defaults.ts`:

```ts
  website_request_received: {
    emailSubject: 'We received your request – {{booking.ref}}',
    emailBody: 'Hi {{guest.firstName}},\n\nThank you for your booking request.\n\n**{{unit.name}}**, {{property.name}}\n{{booking.checkIn}} – {{booking.checkOut}} ({{booking.nights}} nights, {{booking.guests}} guests)\n\nQuoted total: {{money.total}}\nRefundable caution deposit: {{money.deposit}}\n\nWe are holding these dates for you until {{booking.holdUntil}} while we confirm. We will contact you with payment details.\n\nReference: **{{booking.ref}}**\n\nQuestions? Call or WhatsApp {{operator.phone}}.\n\n{{operator.name}}',
    whatsappBody: 'Hi {{guest.firstName}}, we received your request for {{unit.name}} ({{booking.checkIn}} – {{booking.checkOut}}). Ref {{booking.ref}}. Dates held until {{booking.holdUntil}}. – {{operator.name}}',
    autoEmail: true,
  },
  website_request_closed: {
    emailSubject: 'About your request – {{booking.ref}}',
    emailBody: 'Hi {{guest.firstName}},\n\nWe could not confirm your request for {{unit.name}} ({{booking.checkIn}} – {{booking.checkOut}}), so the dates have been released.\n\nYou are welcome to choose other dates on our website: {{operator.website}}\n\nOr call or WhatsApp {{operator.phone}} and we will help.\n\n{{operator.name}}',
    whatsappBody: 'Hi {{guest.firstName}}, we could not confirm your request {{booking.ref}} for {{unit.name}}. Call or WhatsApp {{operator.phone}} and we will help with other dates. – {{operator.name}}',
    autoEmail: true,
  },
```

- `templates.test.ts`: the `autoEmail` false-list assertion stays `['pre_arrival_reminder']` (both new keys are `true`); key-coverage tests pass once defaults and labels exist.
- `index.ts`: `export * from './contracts/public';`

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @boogbe/shared test && pnpm -r typecheck`
Expected: PASS. Typecheck will flag `VarsService.forBooking` missing the two new placeholders if T-M5-03 is merged; add them in T-WB-03 (same PR is fine if this task lands first: fill `'booking.holdUntil': ''`, `'operator.website': ''` there now and T-WB-03 makes them real).

- [ ] **Step 5: Commit**

```bash
git add packages/shared apps/api/src/modules/messaging/vars.service.ts apps/app/src
git commit -m "feat(shared): website source, public contracts, request templates [T-WB-02]"
```

---

### Task 3 (T-WB-03) [api]: Settings + unit toggle API; `createIn` with a nullable actor

**Files:**
- Modify: `apps/api/src/modules/org/*` (settings read/update — the service that builds `OrgSettingsResponse`)
- Modify: `apps/api/src/modules/inventory/units.service.ts` (+ mapper) for `publicListed`
- Modify: `apps/api/src/modules/bookings/bookings.service.ts`, `booking-hooks.ts`
- Modify: `apps/api/src/modules/ical/conflicts.service.ts:33`
- Modify: `apps/api/src/modules/messaging/vars.service.ts`
- Test: `apps/api/test/public-settings.int.ts`, extend `apps/api/test/bookings.int.ts`

**Interfaces:**
- Consumes: T-WB-01 columns; T-WB-02 contracts.
- Produces:
  - `BookingsService.createIn(tx: OrgTx, actor: OrgCtx | null, org: { orgId: string; timezone: string }, input: CreateBookingInput, opts?: { holdMinutes?: number }): Promise<Booking>` — the body of today's `create` minus `orgDb.run`. With `actor === null`: no override allowed, capacity never overridable, `createdByMemberId = null`, status event `actorMemberId = null`, audit actor `{ userId: null, memberId: null }`, and **iCal overlaps are refused** with `409 DATES_UNAVAILABLE`.
  - `create(ctx, input)` becomes `this.orgDb.run(ctx.orgId, (tx) => this.createIn(tx, ctx, { orgId: ctx.orgId, timezone: ctx.timezone }, input))`.
  - `nextRef(tx, timezone: string)` (was `ctx`).
  - `BookingHook.afterCreate?(tx, ctx: OrgCtx | null, booking)`.
  - `toSummary` (booking.mapper.ts) maps `holdUntil: b.holdUntil ?? null`.
  - `VarsService.forBooking` fills `'booking.holdUntil'` (hold in org timezone, `d MMM yyyy, h:mm a`, `''` when null) and `'operator.website'` (`org_settings.public_site_url ?? ''`).

- [ ] **Step 1: Failing tests**

```ts
// apps/api/test/public-settings.int.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';

describe('online booking settings', () => {
  let t: TestApp;
  let orgId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => t.close());
  beforeEach(async () => { await truncateAll(); orgId = (await seedOrg()).id; });

  it('admin reads and updates public settings; origins are normalised', async () => {
    const { agent } = await signInAs(t, 'admin', orgId);
    const r = await agent.patch('/v1/org/settings').send({
      publicEnabled: true, publicHoldMinutes: 90, publicOrigins: ['https://tanuhomes.com/'],
      publicSiteUrl: 'https://tanuhomes.com', notifyEmails: ['desk@tanuhomes.com'],
    });
    expect(r.status).toBe(200);
    expect(r.body.settings).toMatchObject({ publicEnabled: true, publicHoldMinutes: 90, publicOrigins: ['https://tanuhomes.com'], notifyEmails: ['desk@tanuhomes.com'] });
  });

  it('front desk cannot change public settings', async () => {
    const { agent } = await signInAs(t, 'frontdesk', orgId);
    expect((await agent.patch('/v1/org/settings').send({ publicEnabled: true })).status).toBe(403);
  });

  it('unit publicListed toggles', async () => {
    const unitId = await seedUnit(orgId, await seedProperty(orgId));
    const { agent } = await signInAs(t, 'admin', orgId);
    const r = await agent.patch(`/v1/units/${unitId}`).send({ publicListed: true });
    expect(r.status).toBe(200);
    expect(r.body.publicListed).toBe(true);
  });
});
```

Add to `bookings.int.ts` a test that `createIn` with `actor = null` writes `created_by_member_id = null`, `source = 'website'`, and refuses an iCal-overlapping stay with `DATES_UNAVAILABLE`:

```ts
it('createIn without an actor (public) refuses iCal overlaps and records no member', async () => {
  const svc = t.app.get(BookingsService);
  const guestId = await seedGuest(orgId);
  await seedIcalBlock(orgId, unitId, soon(10), soon(12)); // helper: insert block source='ical'
  await expect(t.app.get(OrgDb).run(orgId, (tx) => svc.createIn(tx, null, { orgId, timezone: 'Africa/Lagos' },
    { unitId, guestId, checkIn: soon(10), checkOut: soon(11), guestCount: 2, source: 'website', status: 'tentative' } as never, { holdMinutes: 120 }),
  )).rejects.toMatchObject({ code: 'DATES_UNAVAILABLE' });
  const b = await t.app.get(OrgDb).run(orgId, (tx) => svc.createIn(tx, null, { orgId, timezone: 'Africa/Lagos' },
    { unitId, guestId, checkIn: soon(20), checkOut: soon(22), guestCount: 2, source: 'website', status: 'tentative' } as never, { holdMinutes: 120 }));
  expect(b.source).toBe('website');
  const hold = new Date(b.holdUntil!).getTime() - Date.now();
  expect(hold).toBeGreaterThan(119 * 60_000);
  expect(hold).toBeLessThanOrEqual(120 * 60_000);
});
```

(If `seedIcalBlock` does not exist, add it to `test/helpers/inventory.ts` using the insert from `ical-export.int.ts:39-42`.)

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @boogbe/api test:int -- public-settings bookings`
Expected: FAIL (unknown fields stripped / `createIn` not a function).

- [ ] **Step 3: Implement**

`booking-hooks.ts`: change `afterCreate?(tx: OrgTx, ctx: OrgCtx | null, booking: Booking)`. `conflicts.service.ts:33`: `afterCreate: (tx, _ctx, b) => this.recompute(tx, b.orgId ?? /* booking has no orgId field? */ ...)` — use the org id already available: change to `(tx, ctx, b) => this.recompute(tx, ctx?.orgId ?? orgStore.getStore()!.orgId, b.unit.id)` importing `orgStore` from `common/db/org-db.service` (it is what `OrgDb.run` sets). If `orgStore` is not exported, export it.

`bookings.service.ts`:

```ts
  async nextRef(tx: OrgTx, timezone: string): Promise<string> {
    const s = await tx.orgSettings.findFirstOrThrow();
    const n = await this.orgDb.nextNumber(tx, 'booking');
    const yymm = todayIn(timezone).slice(2, 7).replace('-', '');
    return `${s.bookingPrefix}-${yymm}-${String(n).padStart(4, '0')}`;
  }

  create(ctx: OrgCtx, input: CreateBookingInput): Promise<Booking> {
    return this.orgDb.run(ctx.orgId, (tx) => this.createIn(tx, ctx, { orgId: ctx.orgId, timezone: ctx.timezone }, input));
  }

  /** Shared by the app (actor = member) and the public request route (actor = null). */
  async createIn(
    tx: OrgTx,
    actor: OrgCtx | null,
    org: { orgId: string; timezone: string },
    input: CreateBookingInput,
    opts: { holdMinutes?: number } = {},
  ): Promise<Booking> {
    if (input.finalTotalKobo !== undefined && !(actor && can(actor.role, 'bookings.override')))
      throw forbidden('You cannot change prices');
    const { unit, fees } = await this.loadPricingInputs(tx, input.unitId);
    if (!(await tx.guest.findFirst({ where: { id: input.guestId, anonymisedAt: null } }))) {
      throw new AppError('VALIDATION_FAILED', 400, 'Guest not found');
    }
    if (actor) this.checkCapacity(actor, input.guestCount, unit.maxGuests, input.capacityOverrideReason);
    else if (input.guestCount > unit.maxGuests) throw new AppError('TOO_MANY_GUESTS', 422, `This apartment sleeps ${unit.maxGuests}`);
    await this.blocks.assertUnitFree(tx, input.unitId, input.checkIn, input.checkOut);
    const warnings = await this.icalWarnings(tx, input.unitId, input.checkIn, input.checkOut);
    if (warnings.length && !actor) throw new AppError('DATES_UNAVAILABLE', 409, 'Those dates are not available');
    if (warnings.length && !input.acknowledgeIcalOverlap) {
      throw new AppError('ICAL_OVERLAP', 409, 'These dates overlap a booking on another channel', { warnings });
    }
    let price = quote({ nightlyRateKobo: kobo(unit.nightlyRateKobo), fees, checkIn: input.checkIn, checkOut: input.checkOut, guestCount: input.guestCount });
    if (input.finalTotalKobo !== undefined) price = applyOverride(price, input.finalTotalKobo);

    const s = await tx.orgSettings.findFirstOrThrow();
    const holdMs = (opts.holdMinutes ?? s.holdHours * 60) * 60_000;
    const id = newId();
    const ref = await this.nextRef(tx, org.timezone);
    await tx.booking.create({
      data: {
        id, ref, unitId: input.unitId, guestId: input.guestId,
        checkIn: day(input.checkIn), checkOut: day(input.checkOut), guestCount: input.guestCount,
        source: input.source, status: input.status,
        holdUntil: input.status === 'tentative' ? new Date(Date.now() + holdMs) : null,
        computedTotalKobo: BigInt(price.computedTotalKobo), finalTotalKobo: BigInt(price.finalTotalKobo), depositKobo: BigInt(price.depositKobo),
        overrideReason: input.finalTotalKobo !== undefined ? input.overrideReason : null,
        capacityOverrideReason: input.guestCount > unit.maxGuests ? input.capacityOverrideReason : null,
        icalWarningAck: warnings.length > 0,
        notes: input.notes ?? null,
        createdByMemberId: actor?.memberId ?? null,
      } as never,
    });
    await this.writeLines(tx, id, price);
    await tx.bookingStatusEvent.create({
      data: { id: newId(), bookingId: id, fromStatus: null, toStatus: input.status, actorMemberId: actor?.memberId ?? null } as never,
    });
    const booking = await this.getIn(tx, org.orgId, id);
    await this.audit.record(tx, {
      actor: actor ?? { userId: null, memberId: null },
      action: 'booking.create', entity: 'booking', entityId: id,
      after: { ref, unitId: input.unitId, checkIn: input.checkIn, checkOut: input.checkOut, finalTotalKobo: price.finalTotalKobo, overrideReason: input.overrideReason, source: input.source },
    });
    await this.hooks.run('afterCreate', tx, actor, booking);
    return booking;
  }
```

If `AuditEntry.actor` is typed as `OrgCtx`, widen it to `{ userId: string | null; memberId: string | null }` (columns `actor_user_id`/`actor_member_id` are nullable — the holds job already writes events with no actor; check the `audit_log` DDL and add `DROP NOT NULL` in a follow-up `[schema]` task only if they are not nullable).

Settings: in the org settings service, map the five new fields in the response and accept them in the update (admin-only route is already guarded by the existing `org.settings` permission). Normalise `publicOrigins` via the contract transform (origin only, deduplicate with `[...new Set()]`).

Bookings list: in `booking.mapper.ts` `toSummary`, add `holdUntil: b.holdUntil ?? null` (the full `Booking` already carries it); add an assertion to the existing list test in `bookings.int.ts` that a tentative booking's summary has a non-null `holdUntil` and a confirmed one has `null`.

Units: map `publicListed` in the unit mapper; accept it in `update`; audit as part of the existing unit update audit entry.

`vars.service.ts`: add

```ts
      'booking.holdUntil': b.holdUntil ? formatInTz(b.holdUntil, org.timezone) : '',
      'operator.website': s.publicSiteUrl ?? '',
```

with a local helper using `Intl.DateTimeFormat('en-NG', { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })` (use `org.timezone` if `OrgInfo` exposes it; otherwise read `tx.organization.findFirstOrThrow({ select: { timezone: true } })`).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @boogbe/api test:int && pnpm -r typecheck`
Expected: full suite green (existing booking tests prove the `create` refactor is behaviour-preserving).

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): public settings, unit listing, createIn with nullable actor [T-WB-03]"
```

---

### Task 4 (T-WB-04) [api]: Public read API — resolver, CORS, units, availability, quote

**Files:**
- Create: `apps/api/src/modules/public/public.module.ts`, `public-org.service.ts`, `public-cors.ts`, `public.controller.ts`, `public-read.service.ts`
- Modify: `apps/api/src/app.module.ts` (import `PublicModule`), `apps/api/src/build-app.ts` (mount CORS before the global `cors`)
- Test: `apps/api/test/public-read.int.ts`

**Interfaces:**
- Consumes: `public_org_lookup`, `BookingsService.loadPricingInputs`, `quote` (shared), `BlocksService.items` + `CalendarSources.all()`.
- Produces:
  - `PublicOrgService.resolve(slug: string): Promise<{ orgId: string; timezone: string; origins: string[]; holdMinutes: number }>` (throws `UNAVAILABLE`), 30 s in-memory cache; `PublicOrgService.listedUnit(tx, unitId)` (throws `UNAVAILABLE` unless `active && publicListed`).
  - `publicCors(resolver)` express middleware for `/v1/public/:slug/*`.
  - Routes: `GET /v1/public/:slug/units`, `GET /v1/public/:slug/units/:unitId/availability`, `GET /v1/public/:slug/units/:unitId/quote`.

- [ ] **Step 1: Failing tests**

```ts
// apps/api/test/public-read.int.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';

const soon = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
async function enable(orgId: string, unitIds: string[]) {
  const m = await migratorClient();
  await m.query(`update org_settings set public_enabled=true, public_origins='{https://tanuhomes.com}' where org_id=$1`, [orgId]);
  await m.query(`update unit set public_listed=true where id = any($1)`, [unitIds]);
  const slug = (await m.query('select slug from organization where id=$1', [orgId])).rows[0].slug as string;
  await m.end();
  return slug;
}

describe('public read API', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => t.close());
  beforeEach(async () => truncateAll());

  it('is UNAVAILABLE until enabled, and for unlisted units', async () => {
    const org = await seedOrg();
    const unitId = await seedUnit(org.id, await seedProperty(org.id));
    const m = await migratorClient();
    const slug = (await m.query('select slug from organization where id=$1', [org.id])).rows[0].slug;
    await m.end();
    expect((await t.http.get(`/v1/public/${slug}/units`)).body.error.code).toBe('UNAVAILABLE');
    await enable(org.id, []);
    expect((await t.http.get(`/v1/public/${slug}/units`)).body.units).toEqual([]);
    expect((await t.http.get(`/v1/public/${slug}/units/${unitId}/availability?from=${soon(1)}&to=${soon(30)}`)).status).toBe(404);
    expect((await t.http.get('/v1/public/no-such-org/units')).body.error.code).toBe('UNAVAILABLE');
  });

  it('availability lists blocked nights only, with no guest data', async () => {
    const org = await seedOrg();
    const unitId = await seedUnit(org.id, await seedProperty(org.id));
    await seedBooking(org.id, unitId, await seedGuest(org.id, { fullName: 'Secret Name' }), { checkIn: soon(5), checkOut: soon(7) });
    const slug = await enable(org.id, [unitId]);
    const r = await t.http.get(`/v1/public/${slug}/units/${unitId}/availability?from=${soon(1)}&to=${soon(30)}`);
    expect(r.status).toBe(200);
    expect(r.body.blockedNights).toEqual([soon(5), soon(6)]);
    expect(JSON.stringify(r.body)).not.toMatch(/Secret|ref|guest/i);
  });

  it('another org’s unit is UNAVAILABLE through this slug', async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const ua = await seedUnit(a.id, await seedProperty(a.id));
    const ub = await seedUnit(b.id, await seedProperty(b.id));
    await enable(b.id, [ub]);
    const slugA = await enable(a.id, [ua]);
    expect((await t.http.get(`/v1/public/${slugA}/units/${ub}/quote?checkIn=${soon(3)}&checkOut=${soon(5)}&guests=2`)).status).toBe(404);
  });

  it('quote matches back-office pricing and flags conflicts', async () => {
    const org = await seedOrg();
    const unitId = await seedUnit(org.id, await seedProperty(org.id), { rateKobo: 15_000_000, maxGuests: 2 });
    const slug = await enable(org.id, [unitId]);
    const ok = await t.http.get(`/v1/public/${slug}/units/${unitId}/quote?checkIn=${soon(3)}&checkOut=${soon(5)}&guests=2`);
    expect(ok.body).toMatchObject({ nights: 2, totalKobo: 30_000_000 });
    const tooMany = await t.http.get(`/v1/public/${slug}/units/${unitId}/quote?checkIn=${soon(3)}&checkOut=${soon(5)}&guests=3`);
    expect(tooMany.body.error.code).toBe('TOO_MANY_GUESTS');
    const past = await t.http.get(`/v1/public/${slug}/units/${unitId}/quote?checkIn=2020-01-01&checkOut=2020-01-03&guests=1`);
    expect(past.body.error.code).toBe('INVALID_DATES');
  });

  it('CORS reflects only listed origins, without credentials', async () => {
    const org = await seedOrg();
    const slug = await enable(org.id, []);
    const ok = await t.http.get(`/v1/public/${slug}/units`).set('Origin', 'https://tanuhomes.com');
    expect(ok.headers['access-control-allow-origin']).toBe('https://tanuhomes.com');
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();
    const bad = await t.http.get(`/v1/public/${slug}/units`).set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    const pre = await t.http.options(`/v1/public/${slug}/requests`).set('Origin', 'https://tanuhomes.com').set('Access-Control-Request-Method', 'POST');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-methods']).toMatch(/POST/);
  });
});
```

(Use whatever option names `seedBooking` takes today — check `test/helpers/inventory.ts:71`.)

- [ ] **Step 2: Run to see failures**

Run: `pnpm --filter @boogbe/api test:int -- public-read`
Expected: FAIL — 404 Cannot GET.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/public/public-org.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/db/prisma.service'; // the root client used by ExportsService.render
import type { OrgTx } from '../../common/db/org-db.service';
import { AppError } from '../../common/http/app-error';

export interface PublicOrg { orgId: string; timezone: string; origins: string[]; holdMinutes: number }
export const unavailable = () => new AppError('UNAVAILABLE', 404, 'Online booking is not available');

@Injectable()
export class PublicOrgService {
  private cache = new Map<string, { at: number; org: PublicOrg | null }>();
  constructor(private readonly prisma: PrismaService) {}

  async find(slug: string): Promise<PublicOrg | null> {
    const hit = this.cache.get(slug);
    if (hit && Date.now() - hit.at < 30_000) return hit.org;
    const [row] = await this.prisma.$queryRaw<{ org_id: string; timezone: string; public_origins: string[]; public_hold_minutes: number }[]>`
      SELECT * FROM public_org_lookup(${slug})`;
    const org = row ? { orgId: row.org_id, timezone: row.timezone, origins: row.public_origins, holdMinutes: row.public_hold_minutes } : null;
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(slug, { at: Date.now(), org });
    return org;
  }

  async resolve(slug: string): Promise<PublicOrg> {
    const org = await this.find(slug);
    if (!org) throw unavailable();
    return org;
  }

  async listedUnit(tx: OrgTx, unitId: string) {
    const unit = await tx.unit.findFirst({ where: { id: unitId, active: true, publicListed: true }, include: { property: true } });
    if (!unit) throw unavailable();
    return unit;
  }
}
```

(Match the actual name of the root Prisma provider used in `exports.service.ts:101` — it calls `this.prisma.$queryRaw`.)

```ts
// apps/api/src/modules/public/public-cors.ts
import type { NextFunction, Request, Response } from 'express';
import type { PublicOrgService } from './public-org.service';

/** Per-org allow-list for /v1/public/:slug/*. Runs before the app-wide CORS, which only knows APP_ORIGIN. */
export function publicCors(orgs: PublicOrgService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const slug = req.path.split('/')[1];
    const origin = req.headers.origin;
    if (slug && origin) {
      const org = await orgs.find(slug).catch(() => null);
      if (org?.origins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
          res.setHeader('Access-Control-Allow-Headers', 'content-type');
          res.setHeader('Access-Control-Max-Age', '600');
          return res.status(204).end();
        }
      }
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    (req as Request & { publicRoute?: boolean }).publicRoute = true;
    next();
  };
}
```

`build-app.ts` — mount before `http.use(cors(...))`, and make the global CORS skip public routes:

```ts
  http.use('/v1/public', publicCors(app.get(PublicOrgService)));
  http.use((req, res, next) => ((req as { publicRoute?: boolean }).publicRoute ? next() : cors({ origin: [env.APP_ORIGIN], credentials: true })(req, res, next)));
```

```ts
// apps/api/src/modules/public/public-read.service.ts
import { Injectable } from '@nestjs/common';
import { eachNight, quote, todayIn, type IsoDate } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { AppError } from '../../common/http/app-error';
import { BookingsService } from '../bookings/bookings.service';
import { CalendarSources } from '../calendar/calendar-sources';
import { kobo } from '../inventory/mappers';
import { PublicOrgService, type PublicOrg } from './public-org.service';

const invalid = (m: string) => new AppError('INVALID_DATES', 422, m);

@Injectable()
export class PublicReadService {
  constructor(private readonly orgDb: OrgDb, private readonly orgs: PublicOrgService, private readonly bookings: BookingsService, private readonly sources: CalendarSources) {}

  units(org: PublicOrg) {
    return this.orgDb.run(org.orgId, async (tx) => {
      const rows = await tx.unit.findMany({ where: { active: true, publicListed: true }, include: { property: true }, orderBy: [{ property: { sortOrder: 'asc' } }, { sortOrder: 'asc' }] });
      return { units: rows.map((u) => ({ id: u.id, propertyId: u.propertyId, propertyName: u.property.name, name: u.name, bedrooms: u.bedrooms, maxGuests: u.maxGuests, nightlyRateKobo: kobo(u.nightlyRateKobo) })) };
    });
  }

  /** Every night any calendar source occupies (bookings incl. tentative, manual and iCal blocks). */
  async blockedNights(tx: OrgTx, unitId: string, from: IsoDate, to: IsoDate): Promise<IsoDate[]> {
    const nights = new Set<IsoDate>();
    for (const s of this.sources.all()) {
      const items = await s.items(tx, [unitId], from, to, null as never);
      for (const it of items) {
        if (it.kind === 'booking' && it.status === 'cancelled') continue;
        for (const n of eachNight(it.start, it.end)) if (n >= from && n < to) nights.add(n);
      }
    }
    return [...nights].sort();
  }

  availability(org: PublicOrg, unitId: string, from: IsoDate, to: IsoDate) {
    if (from < todayIn(org.timezone)) throw invalid('Dates must be today or later');
    return this.orgDb.run(org.orgId, async (tx) => {
      await this.orgs.listedUnit(tx, unitId);
      const s = await tx.orgSettings.findFirstOrThrow();
      return { unitId, from, to, blockedNights: await this.blockedNights(tx, unitId, from, to), checkInTime: s.checkInTime, checkOutTime: s.checkOutTime };
    });
  }

  quote(org: PublicOrg, unitId: string, checkIn: IsoDate, checkOut: IsoDate, guests: number) {
    if (checkIn < todayIn(org.timezone)) throw invalid('Dates must be today or later');
    return this.orgDb.run(org.orgId, async (tx) => {
      const unit = await this.orgs.listedUnit(tx, unitId);
      if (guests > unit.maxGuests) throw new AppError('TOO_MANY_GUESTS', 422, `This apartment sleeps ${unit.maxGuests}`);
      if ((await this.blockedNights(tx, unitId, checkIn, checkOut)).length) throw new AppError('DATES_UNAVAILABLE', 409, 'Those dates are not available');
      const { fees } = await this.bookings.loadPricingInputs(tx, unitId);
      const r = quote({ nightlyRateKobo: kobo(unit.nightlyRateKobo), fees, checkIn, checkOut, guestCount: guests });
      return { nights: r.nights, lines: r.lines.map((l) => ({ kind: l.kind, label: l.label, amountKobo: l.amountKobo })), totalKobo: r.finalTotalKobo, depositKobo: r.depositKobo };
    });
  }
}
```

Check the `CalendarSource.items` implementations before relying on `ctx`: `BlocksService.items` ignores it; the bookings source may use `ctx` for owner/housekeeper redaction — if it dereferences `ctx`, pass a synthetic `{ role: 'frontdesk' }`-shaped object instead of `null`, and never return its labels (we only read `start`/`end`/`status`). If cancelled bookings are already excluded by the source, the `status` check is harmless.

```ts
// apps/api/src/modules/public/public.controller.ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AvailabilityQuery, PublicQuoteQuery } from '@boogbe/shared';
import { Public } from '../../common/auth/decorators';
import { parse } from '../../common/http/zod'; // the existing zod-parse helper other controllers use
import { PublicOrgService } from './public-org.service';
import { PublicReadService } from './public-read.service';

@Controller('public/:slug')
export class PublicController {
  constructor(private readonly orgs: PublicOrgService, private readonly read: PublicReadService) {}

  @Get('units') @Public() @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async units(@Param('slug') slug: string) {
    return this.read.units(await this.orgs.resolve(slug));
  }

  @Get('units/:unitId/availability') @Public() @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async availability(@Param('slug') slug: string, @Param('unitId') unitId: string, @Query() q: unknown) {
    const { from, to } = parse(AvailabilityQuery, q);
    return this.read.availability(await this.orgs.resolve(slug), unitId, from, to);
  }

  @Get('units/:unitId/quote') @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async quote(@Param('slug') slug: string, @Param('unitId') unitId: string, @Query() q: unknown) {
    const { checkIn, checkOut, guests } = parse(PublicQuoteQuery, q);
    return this.read.quote(await this.orgs.resolve(slug), unitId, checkIn, checkOut, guests);
  }
}
```

Map zod failures on `checkOut`/`to` to `INVALID_DATES` (422) inside the controller if the shared `parse` helper returns `VALIDATION_FAILED`; the widget only needs to distinguish dates from other errors. `PublicModule` imports `BookingsModule`, `CalendarModule` (or wherever `CalendarSources` is exported) and provides/exports `PublicOrgService`, `PublicReadService`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @boogbe/api test:int`
Expected: green, including `isolation.int.ts` (public routes are `kind: 'public'` and are skipped by the sweep; the cross-org case is covered above) and `guards.int.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/api && git commit -m "feat(api): public units, availability and quote with per-org CORS [T-WB-04]"
```

---

### Task 5 (T-WB-05) [api]: Public booking requests, notification and emails

**Files:**
- Create: `apps/api/src/modules/public/turnstile.ts`, `public-requests.service.ts`, `website-mail.ts`
- Modify: `apps/api/src/modules/public/public.controller.ts`, `public.module.ts`, `apps/api/src/env.ts`, `.env.example`
- Test: `apps/api/test/public-requests.int.ts`, `apps/api/src/modules/public/website-mail.test.ts`

**Interfaces:**
- Consumes: `PublicOrgService`, `PublicReadService.blockedNights`, `BookingsService.createIn`, `BookingHooks`, `NotificationsService.notifyRoles`, `OutboxService.queueEmail`, `TemplatesService.getIn`, `VarsService.forBooking`.
- Produces:
  - `TURNSTILE_VERIFIER` token; `interface TurnstileVerifier { verify(token: string, ip: string | undefined): Promise<boolean> }`; real impl posts to `https://challenges.cloudflare.com/turnstile/v0/siteverify`.
  - `POST /v1/public/:slug/requests` → `201 BookingRequestResponse`.
  - `plain(s: string): string` and `teamEmail(b, opts): { subject: string; bodyMarkdown: string }` in `website-mail.ts`.
  - Booking hooks for `source === 'website'`: on transition `tentative → confirmed` queue `booking_confirmation` (dedupe `auto-booking_confirmation-<id>`); on `tentative → cancelled` queue `website_request_closed` (dedupe `website_request_closed-<id>`).

- [ ] **Step 1: Failing tests**

```ts
// apps/api/src/modules/public/website-mail.test.ts
import { describe, expect, it } from 'vitest';
import { plain, teamEmail } from './website-mail';

describe('team email', () => {
  it('neutralises markdown and links in guest text', () => {
    expect(plain('[click](https://evil.example) **bold**\nnext')).toBe('click (https://evil.example) bold next');
  });
  it('contains deep link, wa.me link and hold expiry', () => {
    const m = teamEmail(
      { id: 'b1', ref: 'TAN-2611-0001', unitName: '1 bedroom', propertyName: 'Destiny', checkIn: '1 Nov 2026', checkOut: '3 Nov 2026', nights: 2, guests: 2, total: '₦350,000', guestName: 'Ada [x](https://e)', phone: '+2348030000000', email: 'ada@example.ng', note: '**late** arrival', holdUntil: '1 Nov 2026, 4:30 pm' },
      { appOrigin: 'https://app.boogbe.com' },
    );
    expect(m.subject).toBe('New website request: Destiny · 1 bedroom, 1 Nov 2026 – 3 Nov 2026 (TAN-2611-0001)');
    expect(m.bodyMarkdown).toContain('[Confirm in Boogbe](https://app.boogbe.com/bookings/b1)');
    expect(m.bodyMarkdown).toContain('[WhatsApp the guest](https://wa.me/2348030000000');
    expect(m.bodyMarkdown).toContain('Ada x (https://e)');
    expect(m.bodyMarkdown).not.toContain('**late**');
  });
});
```

```ts
// apps/api/test/public-requests.int.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { addMember, seedOrg, seedUser } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';
import { TURNSTILE_VERIFIER } from '../src/modules/public/turnstile';
import { BookingHoldsJob } from '../src/modules/bookings/booking-holds.job';

const soon = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
let pass = true;
const fakeTurnstile = { verify: async () => pass };

describe('public booking requests', () => {
  let t: TestApp;
  let slug: string;
  let orgId: string;
  let unitId: string;
  beforeAll(async () => { t = await createTestApp({ overrides: [[TURNSTILE_VERIFIER, fakeTurnstile]] }); });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await truncateAll();
    pass = true;
    orgId = (await seedOrg()).id;
    unitId = await seedUnit(orgId, await seedProperty(orgId), { maxGuests: 2 });
    await addMember(orgId, (await seedUser('desk@op.ng')).id, 'frontdesk');
    const m = await migratorClient();
    await m.query(`update org_settings set public_enabled=true, public_hold_minutes=120, notify_emails='{team@op.ng}' where org_id=$1`, [orgId]);
    await m.query(`update organization set contact_email='hello@op.ng' where id=$1`, [orgId]);
    await m.query(`update unit set public_listed=true where id=$1`, [unitId]);
    slug = (await m.query('select slug from organization where id=$1', [orgId])).rows[0].slug;
    await m.end();
  });
  const body = (o: Record<string, unknown> = {}) => ({ unitId, checkIn: soon(5), checkOut: soon(7), guests: 2, fullName: 'Ada Obi', phone: '08030000000', email: 'ada@example.ng', turnstileToken: 'tok', ...o });

  it('creates a tentative website booking held for public_hold_minutes, notifies and queues emails', async () => {
    const r = await t.http.post(`/v1/public/${slug}/requests`).send(body());
    expect(r.status).toBe(201);
    expect(r.body.ref).toMatch(/-\d{4}-\d{4}$/);
    const m = await migratorClient();
    const b = (await m.query('select status, source, hold_until, created_by_member_id, notes from booking where ref=$1', [r.body.ref])).rows[0];
    expect(b).toMatchObject({ status: 'tentative', source: 'website', created_by_member_id: null });
    expect(new Date(b.hold_until).getTime() - Date.now()).toBeGreaterThan(119 * 60_000);
    const mail = (await m.query('select recipient, template_key from outbound_message where org_id=$1 order by recipient', [orgId])).rows;
    expect(mail).toEqual([
      { recipient: 'ada@example.ng', template_key: 'website_request_received' },
      { recipient: 'hello@op.ng', template_key: null },
      { recipient: 'team@op.ng', template_key: null },
    ]);
    const n = (await m.query(`select kind from notification where org_id=$1`, [orgId])).rows;
    expect(n).toEqual([{ kind: 'website_request' }]);
    await m.end();
  });

  it('reuses the guest by phone and refuses overlapping nights', async () => {
    expect((await t.http.post(`/v1/public/${slug}/requests`).send(body())).status).toBe(201);
    const again = await t.http.post(`/v1/public/${slug}/requests`).send(body({ checkIn: soon(6), checkOut: soon(8) }));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DATES_UNAVAILABLE');
    const m = await migratorClient();
    expect((await m.query('select count(*)::int c from guest where org_id=$1', [orgId])).rows[0].c).toBe(1);
    await m.end();
  });

  it('two simultaneous requests: one wins', async () => {
    const [a, b] = await Promise.all([
      t.http.post(`/v1/public/${slug}/requests`).send(body()),
      t.http.post(`/v1/public/${slug}/requests`).send(body({ phone: '08031111111' })),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it('rejects failed Turnstile and too many guests', async () => {
    pass = false;
    expect((await t.http.post(`/v1/public/${slug}/requests`).send(body())).body.error.code).toBe('VERIFICATION_FAILED');
    pass = true;
    expect((await t.http.post(`/v1/public/${slug}/requests`).send(body({ guests: 3 }))).body.error.code).toBe('TOO_MANY_GUESTS');
  });

  it('expiry and confirmation email the guest once', async () => {
    const r1 = await t.http.post(`/v1/public/${slug}/requests`).send(body());
    const r2 = await t.http.post(`/v1/public/${slug}/requests`).send(body({ checkIn: soon(10), checkOut: soon(12), phone: '08032222222', email: 'bo@example.ng' }));
    const m = await migratorClient();
    await m.query(`update booking set hold_until=now() - interval '1 minute' where ref=$1`, [r1.body.ref]);
    await t.app.get(BookingHoldsJob).run();
    const { agent } = await (await import('./helpers/users')).signInAs(t, 'frontdesk', orgId);
    const id2 = (await m.query('select id from booking where ref=$1', [r2.body.ref])).rows[0].id;
    expect((await agent.post(`/v1/bookings/${id2}/transition`).send({ to: 'confirmed' })).status).toBe(201);
    const keys = (await m.query(`select recipient, template_key from outbound_message where template_key in ('website_request_closed','booking_confirmation') order by template_key`)).rows;
    expect(keys).toEqual([
      { recipient: 'bo@example.ng', template_key: 'booking_confirmation' },
      { recipient: 'ada@example.ng', template_key: 'website_request_closed' },
    ]);
    await m.end();
  });

  it('throttles to 5 requests per 10 minutes per IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await t.http.post(`/v1/public/${slug}/requests`).set('X-Forwarded-For', '203.0.113.9').send(body({ checkIn: soon(20 + i * 3), checkOut: soon(21 + i * 3), phone: `0803444444${i}` }))).status);
    expect(codes.at(-1)).toBe(429);
  });
});
```

(The test env sets the throttler limit to 10 000 — `app.module.ts:33`; the per-route `@Throttle` overrides it, so the 429 test is real. If the transition route path or status code differs, match `bookings.controller.ts`.)

- [ ] **Step 2: Run to see failures**

Run: `pnpm --filter @boogbe/api test -- website-mail && pnpm --filter @boogbe/api test:int -- public-requests`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`env.ts` add: `TURNSTILE_SECRET_KEY: blankIsUnset(z.string().optional()),` and in `superRefine`: production requires it **only when** you want public requests — keep it optional and have the real verifier return `false` when unset (requests then fail closed with `VERIFICATION_FAILED`). Add `TURNSTILE_SECRET_KEY=` to `.env.example`.

```ts
// apps/api/src/modules/public/turnstile.ts
export const TURNSTILE_VERIFIER = Symbol('TURNSTILE_VERIFIER');
export interface TurnstileVerifier { verify(token: string, ip: string | undefined): Promise<boolean> }

export class CloudflareTurnstile implements TurnstileVerifier {
  constructor(private readonly secret: string | undefined) {}
  async verify(token: string, ip: string | undefined) {
    if (!this.secret) return false;
    const form = new URLSearchParams({ secret: this.secret, response: token, ...(ip && { remoteip: ip }) });
    try {
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
      return ((await r.json()) as { success?: boolean }).success === true;
    } catch {
      return false;
    }
  }
}
```

```ts
// apps/api/src/modules/public/website-mail.ts
/** Guest-typed text goes into Markdown: strip anything the renderer would turn into formatting or links. */
export const plain = (s: string) =>
  s.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1 ($2)').replace(/[*_`[\]]/g, '').replace(/\s*\n\s*/g, ' ').trim();

export interface TeamEmailBooking {
  id: string; ref: string; unitName: string; propertyName: string; checkIn: string; checkOut: string; nights: number; guests: number;
  total: string; guestName: string; phone: string; email?: string; note?: string; holdUntil: string;
}

export function teamEmail(b: TeamEmailBooking, opts: { appOrigin: string }) {
  const wa = `https://wa.me/${b.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello ${plain(b.guestName)}, thank you for your booking request ${b.ref}.`)}`;
  const lines = [
    `New booking request from the website.`,
    `**${plain(b.propertyName)} · ${plain(b.unitName)}**\n${b.checkIn} – ${b.checkOut} (${b.nights} nights, ${b.guests} guests)\nQuoted total: ${b.total}`,
    `Guest: ${plain(b.guestName)}\nPhone: ${b.phone}${b.email ? `\nEmail: ${plain(b.email)}` : ''}${b.note ? `\nNote: ${plain(b.note)}` : ''}`,
    `**Held until ${b.holdUntil}.** Confirm or decline before then, or the dates are released.`,
    `[Confirm in Boogbe](${opts.appOrigin}/bookings/${b.id})`,
    `[WhatsApp the guest](${wa})`,
  ];
  return {
    subject: `New website request: ${plain(b.propertyName)} · ${plain(b.unitName)}, ${b.checkIn} – ${b.checkOut} (${b.ref})`,
    bodyMarkdown: lines.join('\n\n'),
  };
}
```

```ts
// apps/api/src/modules/public/public-requests.service.ts
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { formatNaira, nightsBetween, type Booking, type BookingRequestInput } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';
import { AppError } from '../../common/http/app-error';
import { env } from '../../env';
import { BookingsService } from '../bookings/bookings.service';
import { BookingHooks } from '../bookings/booking-hooks';
import { NotificationsService } from '../notifications/notifications.service';
import { OutboxService } from '../messaging/outbox.service';
import { TemplatesService } from '../messaging/templates.service';
import { VarsService } from '../messaging/vars.service';
import { PublicOrgService, type PublicOrg } from './public-org.service';
import { PublicReadService } from './public-read.service';
import { TURNSTILE_VERIFIER, type TurnstileVerifier } from './turnstile';
import { teamEmail } from './website-mail';

@Injectable()
export class PublicRequestsService implements OnModuleInit {
  constructor(
    private readonly orgDb: OrgDb,
    private readonly orgs: PublicOrgService,
    private readonly read: PublicReadService,
    private readonly bookings: BookingsService,
    private readonly hooks: BookingHooks,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
    private readonly templates: TemplatesService,
    private readonly vars: VarsService,
    @Inject(TURNSTILE_VERIFIER) private readonly turnstile: TurnstileVerifier,
  ) {}

  onModuleInit() {
    this.hooks.register({
      afterTransition: async (tx, _ctx, b, from) => {
        if (b.source !== 'website' || from !== 'tentative' || !b.guest.email) return;
        if (b.status === 'confirmed') await this.guestEmail(tx, b, 'booking_confirmation', `auto-booking_confirmation-${b.id}`);
        if (b.status === 'cancelled') await this.guestEmail(tx, b, 'website_request_closed', `website_request_closed-${b.id}`);
      },
    });
  }

  private async guestEmail(tx: OrgTx, b: Booking, key: 'booking_confirmation' | 'website_request_closed' | 'website_request_received', dedupeKey: string) {
    const orgId = (await tx.orgSettings.findFirstOrThrow()).orgId;
    const tpl = await this.templates.getIn(tx, key);
    await this.outbox.queueEmail(tx, {
      bookingId: b.id, templateKey: key, to: b.guest.email!, subject: tpl.emailSubject, bodyMarkdown: tpl.emailBody,
      vars: await this.vars.forBooking(tx, orgId, b.id), dedupeKey,
    });
  }

  async create(slug: string, input: BookingRequestInput, ip: string | undefined) {
    const org: PublicOrg = await this.orgs.resolve(slug);
    if (!(await this.turnstile.verify(input.turnstileToken, ip))) throw new AppError('VERIFICATION_FAILED', 400, 'Please try again');
    return this.orgDb.run(org.orgId, async (tx) => {
      await this.orgs.listedUnit(tx, input.unitId);
      const guestId = await this.upsertGuest(tx, input);
      const b = await this.bookings.createIn(
        tx, null, { orgId: org.orgId, timezone: org.timezone },
        { unitId: input.unitId, guestId, checkIn: input.checkIn, checkOut: input.checkOut, guestCount: input.guests, source: 'website', status: 'tentative', notes: input.note ? `Website request: ${input.note}` : 'Website request' } as never,
        { holdMinutes: org.holdMinutes },
      );
      await this.notifyTeam(tx, org, b, input);
      if (b.guest.email) await this.guestEmail(tx, b, 'website_request_received', `website_request_received-${b.id}`);
      return { ref: b.ref, holdUntil: b.holdUntil!, totalKobo: b.finalTotalKobo };
    });
  }

  private async upsertGuest(tx: OrgTx, input: BookingRequestInput): Promise<string> {
    const g = await tx.guest.findFirst({ where: { phoneE164: input.phone, anonymisedAt: null }, orderBy: { createdAt: 'asc' } });
    if (g) {
      if (!g.email && input.email) await tx.guest.update({ where: { id: g.id }, data: { email: input.email } });
      return g.id;
    }
    const id = newId();
    await tx.guest.create({ data: { id, fullName: input.fullName, phoneE164: input.phone, email: input.email ?? null } as never });
    return id;
  }

  private async notifyTeam(tx: OrgTx, org: PublicOrg, b: Booking, input: BookingRequestInput) {
    await this.notifications.notifyRoles(tx, org.orgId, ['admin', 'frontdesk'], {
      kind: 'website_request', title: `Website request: ${b.ref}`, body: `${b.unit.name}, ${b.checkIn} – ${b.checkOut}`, link: `/bookings/${b.id}`, dedupeKey: `website_request:${b.id}`,
    });
    const v = await this.vars.forBooking(tx, org.orgId, b.id);
    const o = await tx.organization.findFirstOrThrow({ where: { id: org.orgId }, select: { contactEmail: true } });
    const s = await tx.orgSettings.findFirstOrThrow();
    const to = [...new Set([o.contactEmail, ...s.notifyEmails].filter((x): x is string => !!x))];
    const m = teamEmail(
      { id: b.id, ref: b.ref, unitName: v['unit.name'], propertyName: v['property.name'], checkIn: v['booking.checkIn'], checkOut: v['booking.checkOut'],
        nights: nightsBetween(b.checkIn, b.checkOut), guests: b.guestCount, total: formatNaira(b.finalTotalKobo), guestName: input.fullName,
        phone: input.phone, email: input.email, note: input.note, holdUntil: v['booking.holdUntil'] },
      { appOrigin: env.APP_ORIGIN },
    );
    for (const addr of to) await this.outbox.queueEmail(tx, { bookingId: b.id, to: addr, subject: m.subject, bodyMarkdown: m.bodyMarkdown, dedupeKey: `website_request_team-${b.id}-${addr}` });
  }
}
```

Notes for the implementer:
- Guest lookup by phone fills a missing **email** only; an existing guest's name is never blank, so it is left as the front desk recorded it (spec §5 "name/email only if empty" is satisfied).
- Reply-To: the T-M5-04 dispatcher already sets `replyTo: org.email` on every outbound email (`message-dispatch.job.ts`), which covers spec §6 — no change here.
- `Booking.guest.email` / `Booking.source` / `Booking.holdUntil` — use the actual field names from `booking.mapper.ts`; if the mapped guest lacks `email`, read it from `tx.guest`.
- `orgId` inside `guestEmail`: prefer passing `orgId` as a parameter if `orgSettings` does not expose `orgId` in the mapped type — it does in Prisma (`orgId` is the PK).
- Make sure the existing `notifyMember` call in `booking-holds.job.ts` is skipped when `created_by_member_id` is null (it already is), so expiry of a website hold notifies nobody in-app; the closed email covers the guest.
- Concurrency: two simultaneous requests both pass `listedUnit`, then `createIn` → `assertUnitFree` takes `FOR UPDATE` on the unit row; the second waits and gets `DATES_UNAVAILABLE`. The exclusion constraint is the backstop — map a Prisma exclusion violation (`23P01`) to `409 DATES_UNAVAILABLE` if the error filter does not already.

Controller addition:

```ts
  @Post('requests') @Public() @HttpCode(201) @Throttle({ default: { limit: 5, ttl: 600_000 } })
  create(@Param('slug') slug: string, @Body() body: unknown, @Req() req: Request) {
    return this.requests.create(slug, parse(BookingRequestInput, body), req.ip);
  }
```

Module providers: `{ provide: TURNSTILE_VERIFIER, useFactory: () => new CloudflareTurnstile(env.TURNSTILE_SECRET_KEY) }`, `PublicRequestsService`; imports `MessagingModule`, `NotificationsModule`, `BookingsModule`.

Also register the new route in the route-permission listing if `guards.int.ts`/`security.int.ts` enumerate public routes explicitly (search for `ical` in those files and add the four `/v1/public/...` paths next to it).

- [ ] **Step 4: Run all API tests**

Run: `pnpm --filter @boogbe/api test && pnpm --filter @boogbe/api test:int && pnpm -r typecheck && pnpm lint`
Expected: all green.

- [ ] **Step 5: Commit + PR**

```bash
git add apps/api .env.example && git commit -m "feat(api): public booking requests with Turnstile, holds, team and guest emails [T-WB-05]"
```

Open the PR to `dev`; reviewer: opencode.

---

### Task 6 (T-WB-06) [ui]: Settings → Online booking; unit "Show on website"

**Files:**
- Create: `apps/app/src/routes/settings/OnlineBooking.tsx`, `apps/app/src/routes/settings/OnlineBooking.test.tsx`
- Modify: `apps/app/src/router.tsx` (route `/settings/online-booking`), settings nav (where `/settings/team` is linked), `apps/app/src/features/inventory/UnitForm.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /v1/org/settings` with the five new fields; unit `publicListed`.

- [ ] **Step 1: Failing test** (follow the pattern in `PropertyDetail.test.tsx` for mocking the API client)

```tsx
// apps/app/src/routes/settings/OnlineBooking.test.tsx
it('saves online booking settings', async () => {
  mockGet('/v1/org/settings', settingsFixture({ publicEnabled: false, publicHoldMinutes: 120, publicOrigins: [], publicSiteUrl: null, notifyEmails: [] }));
  const patch = mockPatch('/v1/org/settings', (b) => ({ ...settingsFixture(b) }));
  render(<OnlineBooking />);
  await user.click(await screen.findByLabelText('Accept booking requests from your website'));
  await user.clear(screen.getByLabelText('Hold requested dates for (minutes)'));
  await user.type(screen.getByLabelText('Hold requested dates for (minutes)'), '90');
  await user.type(screen.getByLabelText('Website address'), 'https://tanuhomes.com');
  await user.type(screen.getByLabelText('Also email new requests to'), 'desk@tanuhomes.com');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(patch).toHaveBeenCalledWith({ publicEnabled: true, publicHoldMinutes: 90, publicSiteUrl: 'https://tanuhomes.com', publicOrigins: ['https://tanuhomes.com', 'https://www.tanuhomes.com'], notifyEmails: ['desk@tanuhomes.com'] });
});
```

- [ ] **Step 2: Run** `pnpm --filter @boogbe/app test -- OnlineBooking` → FAIL.

- [ ] **Step 3: Implement** with existing form primitives:
  - Toggle "Accept booking requests from your website".
  - Number field "Hold requested dates for (minutes)" (15–1440, helper "Unconfirmed requests are released after this.").
  - "Website address" (https URL). On save, `publicOrigins` = that origin plus its `www.` twin (or the bare twin if the user typed `www.`).
  - "Also email new requests to" (comma-separated, up to 5).
  - Read-only "Your booking slug: `<slug>`" with copy button (for the site config).
  - Admin only (hide nav item for other roles, same check the Team page uses).
  - `UnitForm.tsx`: checkbox "Show on website" bound to `publicListed`, helper "Guests can see availability and request this apartment on your website."

- [ ] **Step 4: Run** `pnpm --filter @boogbe/app test && pnpm --filter @boogbe/app typecheck` → PASS.

- [ ] **Step 5: Commit** `feat(app): online booking settings and unit listing toggle [T-WB-06]`; PR after T-WB-03 is on `dev`; reviewer: claude.

---

### Task 7 (T-WB-07) [ui]: Front desk — Website badge, hold countdown, requests card, Decline

**Files:**
- Create: `apps/app/src/features/bookings/HoldCountdown.tsx`, `HoldCountdown.test.tsx`, `WebsiteRequestsCard.tsx`, `WebsiteRequestsCard.test.tsx`
- Modify: `BookingsPage.tsx` (card on top; badge in rows), `BookingDetail.tsx` (badge + countdown), `StatusActions.tsx` (Decline preset), calendar booking chip (badge), notification item icon for `website_request`

**Interfaces:**
- Consumes: `GET /v1/bookings?source=website&status=tentative&limit=20` (existing list filters) whose `BookingSummary` rows carry `holdUntil` (T-WB-02/03); booking `source`; existing `POST /v1/bookings/:id/transition` with `{ to: 'confirmed' }` for Confirm; existing `POST /v1/bookings/:id/cancel` with `CancelBookingInput` `{ reason }` (reason ≥ 3 chars, no refund fields) for Decline — `TransitionInput.to` does not accept `cancelled`. The cancel path calls `transitionIn(…, 'cancelled')`, so T-WB-05's closed-email hook fires.

- [ ] **Step 1: Failing tests**

```tsx
// HoldCountdown.test.tsx
it('shows minutes left and turns urgent under 15 minutes', () => {
  vi.useFakeTimers().setSystemTime(new Date('2026-11-01T10:00:00Z'));
  const { rerender } = render(<HoldCountdown holdUntil="2026-11-01T11:30:00Z" />);
  expect(screen.getByText('Held 1 h 30 min')).toBeInTheDocument();
  rerender(<HoldCountdown holdUntil="2026-11-01T10:10:00Z" />);
  expect(screen.getByText('Held 10 min')).toHaveAttribute('data-urgent', 'true');
  rerender(<HoldCountdown holdUntil="2026-11-01T09:59:00Z" />);
  expect(screen.getByText('Hold expired')).toBeInTheDocument();
});
```

```tsx
// WebsiteRequestsCard.test.tsx
it('lists open website requests soonest-expiry first and hides when empty', async () => {
  mockGet('/v1/bookings', { items: [summary({ ref: 'B', holdUntil: '2026-11-01T12:00:00Z' }), summary({ ref: 'A', holdUntil: '2026-11-01T11:00:00Z' })], nextCursor: null });
  render(<WebsiteRequestsCard />);
  const rows = await screen.findAllByRole('link', { name: /TAN-/ });
  expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('A'), expect.stringContaining('B')]);
});
it('renders nothing with no requests', async () => {
  mockGet('/v1/bookings', { items: [], nextCursor: null });
  const { container } = render(<WebsiteRequestsCard />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**
  - `HoldCountdown`: re-renders every 30 s; `data-urgent` when < 15 min.
  - `WebsiteRequestsCard`: title "New website requests"; rows show ref, apartment, dates, guest, total and `HoldCountdown`, each linking to `/bookings/:id`. It polls every 60 s, matching how the notifications bell refreshes.
  - "Website" badge wherever a booking source is shown, styled like the other status chips.
  - Decline in `StatusActions` for `tentative` **website** bookings: reuse the existing cancel dialog path (`POST /v1/bookings/:id/cancel`), opened with preset reasons "Dates not available" / "Could not reach guest" / "Other (type it)" and the refund section hidden (a website request has no payments). A `409` shows "This request changed. Refresh to see the latest."

- [ ] **Step 4: Run** `pnpm --filter @boogbe/app test && typecheck` → PASS.

- [ ] **Step 5: Commit** `feat(app): website request badge, hold countdown, requests card, decline [T-WB-07]`; PR after T-WB-05 is on `dev`; reviewer: claude.

---

### Task 8 (T-WB-08) [site]: Tanuhomes booking widget (repo `~/Projects/tanuhomes`)

Work on a branch `boogbe-widget` from the Tanuhomes `main`, PR to `main` there. Owner reviews; planner deploys.

**Files:**
- Modify: `src/lib/property-schema.ts` (optional `boogbe`), `src/lib/site.ts` (config), `src/pages/short-lets/[slug].astro` (use widget when linked), `src/pages/privacy.astro`, `src/scripts/track.ts`
- Create: `src/components/BookingWidget.astro`, `src/scripts/booking.ts`, `src/scripts/booking-core.ts`, `src/scripts/booking-core.test.ts`
- Modify: `package.json` (add `vitest` as a **devDependency** only if no test runner exists; the "no new dependencies" rule is about runtime)

**Interfaces:**
- Consumes: `GET /v1/public/:slug/units/:id/availability`, `/quote`, `POST /v1/public/:slug/requests` (contracts in T-WB-02).
- Produces (pure, tested): in `booking-core.ts`
  - `monthGrid(month: string /* YYYY-MM */): (string | null)[]` — Monday-first cells.
  - `selectDate(sel: { checkIn?: string; checkOut?: string }, day: string, blocked: Set<string>): { checkIn?: string; checkOut?: string }` — first tap sets check-in. A second tap after it sets check-out, but only if no blocked night falls in `[checkIn, day)`; otherwise that day becomes the new check-in. Tapping on or before the check-in restarts the selection.
  - `naira(kobo: number): string` → `₦150,000`.
  - `errorMessage(code: string): string`.

- [ ] **Step 1: Failing tests**

```ts
// src/scripts/booking-core.test.ts
import { describe, expect, it } from 'vitest';
import { errorMessage, monthGrid, naira, selectDate } from './booking-core';

describe('booking core', () => {
  it('builds a Monday-first grid', () => {
    const g = monthGrid('2026-11'); // 1 Nov 2026 is a Sunday
    expect(g.slice(0, 7)).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(g.filter(Boolean)).toHaveLength(30);
  });
  it('selects a range and refuses ranges across blocked nights', () => {
    const blocked = new Set(['2026-11-05']);
    let s = selectDate({}, '2026-11-03', blocked);
    expect(s).toEqual({ checkIn: '2026-11-03' });
    expect(selectDate(s, '2026-11-05', blocked)).toEqual({ checkIn: '2026-11-03', checkOut: '2026-11-05' }); // checkout morning may be a blocked night
    expect(selectDate(s, '2026-11-07', blocked)).toEqual({ checkIn: '2026-11-07' });
    s = { checkIn: '2026-11-03', checkOut: '2026-11-04' };
    expect(selectDate(s, '2026-11-10', blocked)).toEqual({ checkIn: '2026-11-10' });
  });
  it('formats naira from kobo', () => expect(naira(15_000_000)).toBe('₦150,000'));
  it('maps API errors to guest copy', () => {
    expect(errorMessage('DATES_UNAVAILABLE')).toBe('Those dates were just taken. Please choose other dates.');
    expect(errorMessage('RATE_LIMITED')).toBe('Couldn’t reach booking right now. Please try again shortly or message us on WhatsApp.');
  });
});
```

Also run the suite once with `TZ=America/New_York` (Review Focus 5): `TZ=America/New_York npx vitest run src/scripts` — date helpers must use string arithmetic on `YYYY-MM-DD` / `Date.UTC`, never local `getDate()`.

- [ ] **Step 2: Run** `npx vitest run src/scripts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/scripts/booking-core.ts
const pad = (n: number) => String(n).padStart(2, '0');
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`)];
}

export function selectDate(sel: { checkIn?: string; checkOut?: string }, day: string, blocked: Set<string>) {
  if (!sel.checkIn || sel.checkOut || day <= sel.checkIn) return blocked.has(day) ? {} : { checkIn: day };
  for (let d = sel.checkIn; d < day; d = addDays(d, 1)) if (blocked.has(d)) return blocked.has(day) ? {} : { checkIn: day };
  return { checkIn: sel.checkIn, checkOut: day };
}

export const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;

const MESSAGES: Record<string, string> = {
  DATES_UNAVAILABLE: 'Those dates were just taken. Please choose other dates.',
  TOO_MANY_GUESTS: 'Too many guests for this apartment. Please choose fewer guests or another apartment.',
  INVALID_DATES: 'Please choose check-in and check-out dates from today onwards (up to 30 nights).',
  VERIFICATION_FAILED: 'We couldn’t verify the request. Please try again.',
  VALIDATION_FAILED: 'Please check your name and phone number.',
};
export const errorMessage = (code: string) => MESSAGES[code] ?? 'Couldn’t reach booking right now. Please try again shortly or message us on WhatsApp.';
```

`site.ts` additions:

```ts
export const BOOGBE_API = import.meta.env.PUBLIC_BOOGBE_API ?? 'https://api.boogbe.com';
export const BOOGBE_SLUG = import.meta.env.PUBLIC_BOOGBE_SLUG ?? 'tanuhomes';
export const TURNSTILE_SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? '';
```

`property-schema.ts`: add `boogbe: z.object({ units: z.array(z.object({ label: z.string().min(1), unitId: z.string().min(1) })).min(1) }).optional()`.

`[slug].astro`: `{p.boogbe && TURNSTILE_SITE_KEY ? <BookingWidget property={p} /> : <RateCard property={p} />}`.

`BookingWidget.astro` server-renders:
- The current `RateCard` markup inside `<noscript>` and inside a `[data-fallback]` block. The script hides that block once availability loads, and shows it again on any network error.
- A `<div data-booking data-api data-slug data-units='[…]' data-property-name data-wa>` root, with placeholders: apartment toggle (`role="radiogroup"`), month nav buttons, two `role="grid"` month tables, guests `<select>`, quote `<dl>`, form fields (name, phone `type=tel`, email, note), `<div class="cf-turnstile" data-sitekey data-size="flexible" data-appearance="interaction-only">`, submit button "Request to book", the hold copy "Submitting holds these dates for 2 hours while Tanuhomes confirms. Payment details follow on WhatsApp. An unconfirmed request is released automatically.", and a `role="status"` live region.
- Load Turnstile with `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer is:inline>`.

`booking.ts` (client) wiring, using `booking-core.ts`:
1. On load, read `data-*`, pick the first unit, and fetch availability for `[today, today+90)`. Navigating months past the window fetches the next 90-day window and merges it into `blocked`.
2. Render the grids. Each cell is a `<button>` with `aria-label="Mon 3 Nov, available"` (or `unavailable`); blocked nights get `aria-disabled` and a strike-through; arrow keys move focus. Swiping left or right on the grid container changes month (pointer events, 40 px threshold).
3. On a complete selection plus guests, `GET quote` and render the lines, the "Refundable caution deposit" line and the **Total**. If the quote fails with `DATES_UNAVAILABLE`, refetch availability and clear the selection.
4. On submit, disable the button, read the Turnstile token from `turnstile.getResponse()`, and `POST requests`. On `201`, replace the form with: "Request sent. Reference **{ref}**. We're holding your dates until {local time}." plus a WhatsApp button whose `waLink` text includes the ref. On error, show `errorMessage(code)` in the live region, keep the WhatsApp fallback visible and call `turnstile.reset()`.
5. Call `track('booking_quote', {property, unit})` and `track('booking_request', {property, unit})` through the existing `track.ts` API.

`privacy.astro`: add a section headed "Booking requests". It explains that if you use **Request to book**, your name, phone, optional email, dates and note are sent to Tanuhomes' booking system (Boogbe, operated by EDGD Media) to hold the dates and reply to you; that Cloudflare Turnstile checks the request is not automated; and that you can ask Tanuhomes to correct or delete these details.

CSS: reuse the existing tokens and `.button` classes in the site stylesheet. The calendar cells should be at least 44 px tall on mobile.

- [ ] **Step 4: Verify**
  - `npx vitest run src/scripts && TZ=America/New_York npx vitest run src/scripts && npm run build`: PASS. The build must also pass with no `boogbe` key on any property (RateCard everywhere).
  - Then link Alaska to a staging unit, run `PUBLIC_BOOGBE_API=https://staging-api.boogbe.com PUBLIC_BOOGBE_SLUG=<staging slug> PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run dev`, and use Playwright to walk pick dates → quote → request → ref shown. `1x000…AA` is Cloudflare's always-pass test key; the staging API needs the matching test secret `1x0000000000000000000000000000000AA`.

- [ ] **Step 5: Commit** `feat: Boogbe booking widget on linked properties` and open a PR to Tanuhomes `main`.

---

### Task 9 (T-WB-09) [infra]: Staging verification and rollout (planner + owner)

- [ ] **Staging:** deploy `dev` to staging. Set `TURNSTILE_SECRET_KEY` to the always-pass test secret. In the staging app, enable online booking for the staging org with origins `http://localhost:4321`, and list one unit. Run the T-WB-08 Playwright walk. Confirm that the team and guest emails appear in the outbound log and that an expired hold sends "Request not confirmed".
- [ ] **Turnstile (owner):** in the Cloudflare dashboard, create a Turnstile widget for `tanuhomes.com` and `www.tanuhomes.com` in the "Managed" mode. Put the site key in the Tanuhomes build env as `PUBLIC_TURNSTILE_SITE_KEY` and the secret on the API server's `.env` as `TURNSTILE_SECRET_KEY`. Restart the API with PM2.
- [ ] **Release:** open a dev→main release PR, then follow the manual deploy (RUNBOOK). Migration 0008 runs.
- [ ] **Tanuhomes data (owner + planner):** in app.boogbe.com, check the six properties and their apartments: Alaska 1-bed ₦150,000; Destiny 1-bed ₦175,000 and 2-bed ₦210,000; Ebony 1-bed ₦120,000 and 2-bed ₦140,000; Kairo ₦200,000; Lumina 1-bed ₦180,000 and 2-bed ₦220,000; Veyra 2-bed ₦150,000. Each needs the ₦100,000 refundable caution deposit fee. Then go to Settings → Online booking: enable it, set website `https://tanuhomes.com`, set notify emails, and set "Show on website" on **Alaska only**.
- [ ] **Site:** add `boogbe.units` to `alaska.json` with the production unit id, then build and deploy the Tanuhomes site (`npm run deploy`). Make a real request on a far-future date, check both emails, decline it, and check the "closed" email.
- [ ] **Watch for 3–5 days.** Then list the other units, add `boogbe` to the other five property JSONs, and deploy.
- [ ] **Board:** mark WB done and resume T-M5-05.

---

## Self-review notes (completed)

- **Spec coverage:**
  - §4 data → T-WB-01
  - §5 API → T-WB-04, T-WB-05
  - §5 settings/CORS → T-WB-03, T-WB-04
  - §6 emails → T-WB-02 templates, T-WB-05 triggers (deviations 1–2 recorded)
  - §7 front desk → T-WB-07 (deviation 3)
  - §8 site → T-WB-08
  - §9 tests → each task
  - §10 rollout → T-WB-09
  - §11 ownership → agent column
- **Type consistency:** `createIn(tx, actor, { orgId, timezone }, input, { holdMinutes })` is used the same way in T-WB-03 and T-WB-05. `PublicOrg { orgId, timezone, origins, holdMinutes }` is shared by T-WB-04 and T-WB-05. Template keys and placeholders are defined in T-WB-02 and used in T-WB-03 and T-WB-05.
- **Review fixes (opencode on #72):** Decline uses the cancel route; `holdUntil` added to `BookingSummary`; DATA_MODEL.md in T-WB-01; Reply-To and guest-name notes in T-WB-05.
- **Known lookups for implementers:** these names must be confirmed against `dev` (each is flagged inline): the root Prisma provider, the shared zod `parse` helper, the `seedBooking` options, the transition route path, the audit actor type, and `orgStore` export.
