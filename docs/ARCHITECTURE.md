# Boogbe — Architecture

**Status:** Draft for owner review · 2026-10-09
**Reference implementation:** `~/Projects/Unclutter/unclutterdesk` (same author, same stack). Where this document says "as Unclutter", read the named file there and follow its pattern.

---

## 1. System overview

```
                 Cloudflare (DNS, TLS, WAF, CDN)
                 │
   app.boogbe.com│  Cloudflare Pages ── apps/app (React SPA, static)
                 │
   api.boogbe.com│  proxied ──► edgdmedia VPS
                 │               nginx (Cloudflare real-IP, origin cert)
                 │                 └─► PM2: boogbe-api     (NestJS, port 3060)
                 │                     PM2: boogbe-worker  (same build, BOOGBE_ROLE=worker: crons)
                 │                     PostgreSQL 16 (local, db: boogbe / boogbe_staging)
                 │
                 └─ R2 bucket boogbe-files (logos, receipts, task photos, PDFs, DB backups)
   External: Resend (email), Sentry (errors), Airbnb/Booking.com iCal URLs
```

- **Domains** (assumed; owner to confirm): `app.boogbe.com` (SPA), `api.boogbe.com` (API), `staging-app.boogbe.com`, `staging-api.boogbe.com`. App and API are **same-site** subdomains, so Better Auth cookies use `Domain=.boogbe.com; SameSite=Lax; Secure; HttpOnly`.
- **Environments:** `local` (Postgres via Docker or Homebrew), `staging` (VPS, `dev` branch), `production` (VPS, `main` branch). Staging and production share the VPS with separate databases, PM2 names, nginx server blocks and env files.

## 2. Repository layout (pnpm workspace)

```
boogbe/
├── AGENTS.md / CLAUDE.md           # rules for AI agents (OpenCode + Claude Code)
├── apps/
│   ├── api/                        # NestJS 10 + Prisma 5
│   │   └── src/
│   │       ├── main.ts             # mounts Better Auth handler before body parser
│   │       ├── worker.ts           # entry for BOOGBE_ROLE=worker (ScheduleModule only)
│   │       ├── env.ts              # zod-validated env
│   │       ├── common/
│   │       │   ├── auth/           # better-auth instance, session guard, permission decorator
│   │       │   ├── db/             # PrismaService, OrgDb (RLS-scoped access), org-context
│   │       │   ├── http/           # zod validation pipe, error filter, request-id
│   │       │   ├── audit/          # AuditService + interceptor
│   │       │   ├── files/          # R2 client, signed URLs
│   │       │   └── pdf/            # pdfkit helpers, branded layout
│   │       ├── modules/
│   │       │   ├── platform/  org/  members/
│   │       │   ├── properties/  units/  owners/  fees/  blocks/
│   │       │   ├── guests/  bookings/  calendar/
│   │       │   ├── payments/  receipts/
│   │       │   ├── ical/            # import cron, export controller, conflicts
│   │       │   ├── messaging/       # templates, renderer, email (Resend), whatsapp links, log
│   │       │   ├── tasks/
│   │       │   ├── expenses/  statements/  owner-portal/
│   │       │   ├── notifications/
│   │       │   └── audit/
│   │       ├── tenant-isolation.spec.ts   # static check (as Unclutter)
│   │       └── route-permissions.spec.ts  # every route declares a permission
│   │   └── test/                   # integration tests against real Postgres
│   └── app/                        # React 18 + Vite + React Router + SWR + Tailwind 4
│       └── src/
│           ├── routes/             # admin/, frontdesk shares admin routes, housekeeper/, owner/, platform/, auth/
│           ├── features/           # calendar/, bookings/, payments/, …  (components + hooks per feature)
│           ├── lib/                # api client (typed from shared), auth client, formatters
│           └── components/         # shell, nav, layout
├── packages/
│   ├── shared/                     # zod schemas (API contracts), enums, pure domain logic
│   │   └── src/
│   │       ├── contracts/          # one file per module: request/response schemas
│   │       ├── domain/             # pricing.ts, ledger.ts, revenue.ts, allocation.ts, dates.ts, money.ts
│   │       └── permissions.ts      # role → permission map (single source of truth)
│   └── ui/                         # design tokens + primitives (Button, Input, Sheet, Table…)
├── prisma/
│   ├── schema.prisma
│   └── migrations/                 # includes raw SQL for RLS, exclusion constraints, grants
├── deploy/                         # nginx confs, deploy.sh, backup.sh, restore.md
├── ecosystem.config.js             # PM2: boogbe-api, boogbe-worker (+ staging variants)
└── docs/
```

## 3. Backend

### 3.1 Framework conventions
- NestJS module per domain area; controller → service → `OrgDb`. Controllers are thin.
- **Validation:** zod schemas from `packages/shared/contracts` via a `ZodValidationPipe` (`nestjs-zod`). No class-validator.
- **API style:** REST under `/v1`. JSON. Cursor pagination `?cursor=&limit=` (max 100). Dates as `YYYY-MM-DD`, timestamps ISO-8601 UTC, money as integer kobo with field suffix `Kobo`.
- **Errors:** `{ "error": { "code": "DATES_UNAVAILABLE", "message": "…", "details": {…} } }`. Codes are an enum in `packages/shared/src/errors.ts`.
- **Rate limiting:** `@nestjs/throttler` in-memory; API stays **single PM2 instance** (as Unclutter `ecosystem.config.js`, for the same reason).

### 3.2 Authentication — Better Auth
- `better-auth` with plugins: `organization` (operators, members, invitations, active org on session), `admin` (platform admin role), and email+password. Prisma adapter, `provider: "postgresql"`, `transaction: true`.
- Organization plugin roles defined with `createAccessControl` mirroring `packages/shared/src/permissions.ts`: `admin`, `frontdesk`, `housekeeper`, `landlord` (UI label "Property owner"). Better Auth's built-in `owner`/`member` roles are **not** used — `owner` is a privileged Better Auth role name, so property owners use `landlord`. `creatorRole: "admin"`. Platform admin = Better Auth **admin plugin** `user.role = "admin"` (the organization plugin has no cross-org admin).
- Mounted in `main.ts` on the Express instance at `/v1/auth/*` using `toNodeHandler(auth)` **before** Nest's JSON body parser (`bodyParser: false` on `NestFactory.create`, then add `express.json()` for other routes).
- Invitation emails sent via the messaging module's mailer through the plugin's `sendInvitationEmail` hook.
- `SessionGuard` (global): resolves session via `auth.api.getSession({ headers })`, loads the **member row from the DB** for `session.activeOrganizationId` (role is never trusted from the session payload — as Unclutter `roles.guard.ts`), checks org not suspended, attaches `req.ctx = { userId, orgId, role, memberId }`.
- `@Permission('bookings.write')` decorator + `PermissionGuard` using the shared map. `@Public()` for public routes (iCal export, health). A spec asserts every route has exactly one of the two.
- Lockout (AUTH-02): Better Auth rate-limit config for `/sign-in/email` + a small `login_attempt` table checked in a `before` hook (as Unclutter's lockout).

### 3.3 Tenant isolation — two layers
1. **Application layer.** Services never receive the raw Prisma client. They receive `OrgDb`, obtained via `this.orgDb.for(req.ctx)`, which:
   - runs work inside an interactive transaction that first executes `SELECT set_config('app.org_id', $orgId, true)` (transaction-local);
   - uses a Prisma client extension that injects `orgId` into `where` for reads/updates/deletes and into `data` for creates on tenant models (as Unclutter's `$extends` pattern, ARCHITECTURE §2.2 there).
   - Updates by unique id use `updateMany({ where: { id, orgId } })` (Unclutter lesson: `update({ where: { id } })` silently drops the tenant filter).
2. **Database layer.** Every tenant table: `ALTER TABLE … ENABLE ROW LEVEL SECURITY; ALTER TABLE … FORCE ROW LEVEL SECURITY;` with policy
   `USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true))`.
   If `app.org_id` is unset, `current_setting(…, true)` returns NULL and **no rows match**.
   - Roles: `boogbe_migrator` (owns schema; `BYPASSRLS` because FORCE RLS binds owners; runs migrations, backups and test setup; never used at runtime), `boogbe_app` (runtime; `NOBYPASSRLS`; not table owner; DML grants only; no UPDATE/DELETE on `payment`, `audit_log`, `statement` snapshots).
   - Better Auth tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`) are global (no RLS); access to them goes only through Better Auth or the `members`/`platform` modules.
- **Workers/crons** iterate active organizations (global table) and call `orgDb.forOrg(orgId)` per operator — they never run unscoped queries on tenant tables.
- **Guards in CI:** `tenant-isolation.spec.ts` (static: service methods taking `orgId` must use it; no module imports `PrismaClient`/`PrismaService` directly except `common/db`), `rls-coverage.spec.ts` (queries `pg_class`/`pg_policies`: every table with an `org_id` column has RLS enabled+forced and a policy), and per-endpoint cross-tenant integration tests.

### 3.4 Domain logic placement
Pure, deterministic logic lives in `packages/shared/src/domain` so both apps use identical maths and it is trivially unit-testable:
- `money.ts` — kobo helpers, `formatNaira`, half-up rounding, bps percentage.
- `dates.ts` — date-only arithmetic, nights, ranges, overlap, operator-timezone "today".
- `pricing.ts` — `quote(unit, fees, stay, guests) → PriceLine[]`.
- `ledger.ts` — `balance(lines, payments)`, `depositHeld(payments)`.
- `revenue.ts` — per-night recognition by month (OWN-03).
- `allocation.ts` — expense split (OWN-02).
- `statement.ts` — `computeStatement(inputs) → StatementFigures` (OWN-04).

### 3.5 Concurrency & integrity
- Booking create/move: within the org transaction, `SELECT … FROM unit WHERE id = $1 FOR UPDATE`, check manual blocks, insert booking; the **exclusion constraint** (`btree_gist`) is the final guard for booking-vs-booking. Constraint violation `23P01` maps to 409 `DATES_UNAVAILABLE`.
- Numbering (receipts, statements, booking refs): per-operator counters row (`org_counter`) incremented with `UPDATE … RETURNING` inside the transaction.
- Idempotency: crons use natural keys (`turnover` task unique on `booking_id`; statement unique on `(owner_id, period)`; ical block unique on `(feed_id, external_uid)`).

### 3.6 Background work (`boogbe-worker`)
`@nestjs/schedule` crons, registered only when `BOOGBE_ROLE=worker`. Each run writes a `job_run` row (name, org, started, finished, ok, error).

| Job | Schedule | Notes |
|---|---|---|
| `ical.import` | every 5 min tick; each feed due every 15 min (jittered by feed id) | concurrency 4, timeout 15 s |
| `bookings.expireHolds` | every 10 min | BKG-08 |
| `messaging.dispatch` | every 1 min | sends queued emails from `outbound_message` (status queued→sent/failed, retries 3 with backoff) |
| `messaging.preArrival` | hourly; acts at 10:00 operator tz | MSG-03 |
| `tasks.turnoverSweep` | hourly | HSK-02 fallback when checkout not marked |
| `statements.monthly` | hourly; acts on 1st 06:00 operator tz | OWN-06 |
| `backup.nightly` | 02:30 Africa/Lagos | runs `deploy/backup.sh` → R2 |

Emails are **queued** in a table (transactional outbox) inside the business transaction, then dispatched by the worker — no lost or duplicate emails on rollback.

### 3.7 Files
R2 via `@aws-sdk/client-s3`; private bucket; keys `org/<orgId>/<kind>/<uuid>.<ext>`; downloads via 5-minute presigned URLs issued only after a permission check. Uploads: API issues presigned PUT (max size per kind), client uploads directly, then confirms.

### 3.8 PDFs
`pdfkit` (as Unclutter) with a shared branded layout: operator logo, name, contact; Naira formatting; A4. Receipts generated on demand; finalised statements rendered once and stored.

### 3.9 Email
Resend REST API (as Unclutter `modules/notifications/mail`). Platform sending domain `mail.boogbe.com`; from `"<Operator name> via Boogbe" <bookings@mail.boogbe.com>`; reply-to operator email. Per-operator sending domains: later (Unclutter `sending-domain` module is the template).

## 4. Frontend

- React 18, Vite 5, React Router, SWR for data, `react-hook-form` + `@hookform/resolvers/zod` using shared schemas, Tailwind 4, `lucide-react`, `date-fns`. (Same family as Unclutter `apps/app`.)
- API client: thin `fetch` wrapper with `credentials: 'include'`, typed request/response from `packages/shared/contracts`, maps error codes to messages.
- Auth: `better-auth/react` client with `organizationClient` + `adminClient`; org switcher in shell.
- Route areas by role: `/` admin+frontdesk shell (calendar default), `/hk` housekeeper, `/owner` owner portal, `/platform` platform admin, `/auth/*`. A role landing redirect sends each user to their area.
- Mobile-first layouts; bottom nav on narrow screens; calendar grid horizontally scrollable with sticky unit column.
- Code-split per area (housekeeper bundle budget NFR-07).

## 5. Deployment

- **API:** GitHub Actions (`deploy-api.yml`, as Unclutter) → verify (typecheck, unit, integration with Postgres service container) → SSH → `deploy/deploy.sh`: `git pull` → `pnpm install --frozen-lockfile` → `prisma generate` → build → **pg_dump pre-deploy backup (abort on failure)** → `prisma migrate deploy` (as `boogbe_migrator`) → `pm2 reload` → health-check wait. Copy Unclutter's `deploy.sh` hardening (pipefail, env parsing without sourcing, PM2 path verification, health wait).
- **App:** `deploy-app.yml` → build → Cloudflare Pages (`wrangler pages deploy`). `_headers` with CSP.
- **nginx:** copy Unclutter `deploy/nginx/*` (Cloudflare real-IP, IP list updater); only Cloudflare IPs allowed to the origin.
- **Secrets** (GitHub + server `.env`): `DATABASE_URL` (app role), `DATABASE_MIGRATE_URL` (migrator), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_ORIGIN`, `RESEND_API_KEY`, `R2_*`, `SENTRY_DSN`, `PROD_SSH_HOST/USER/KEY`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`.

## 6. Phase B hooks (do not build in v1, do not block)
- Public, unauthenticated, rate-limited availability/quote endpoints will live in `modules/public/` and use `orgDb.forOrg(orgIdFromSlug)`.
- `apps/tenant-router` (Cloudflare Worker, as Unclutter) for `<slug>.boogbe.com` and custom domains.
- Paystack: `payment.method = 'paystack'` and `payment.externalRef` already exist so webhook-settled payments slot into the same ledger.
