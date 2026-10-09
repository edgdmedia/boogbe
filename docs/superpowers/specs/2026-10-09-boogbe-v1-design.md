# Boogbe v1 (Phase A) — Design Spec

**Date:** 2026-10-09 · **Status:** Approved · **Process:** superpowers brainstorming → this spec → writing-plans

This spec is the agreed design. Detail lives in the linked documents; where they disagree, **this spec wins** and the other document must be fixed.

## 1. Shared understanding

**What the owner said**
- Build the booking platform once, as a SaaS others can subscribe to — not a Tanuhomes-only tool. Product name: **Boogbe by EDGD Media**.
- External calendar sync via iCal only; no Airbnb/Booking.com API.
- v1 = operator back office (A); guest online booking later (B).
- v1 must include: core calendar/bookings/guests/iCal, payments ledger, owner statements, guest messaging, housekeeping tasks.
- Onboarding is by the owner, invite-only; billing/subscriptions come later.
- Roles: admin/manager, front desk, housekeeper, property owner.
- Pricing: base rate + fees, computed total editable with a reason.
- Management fee configurable per property (% gross or % net, plus optional fixed fee).
- Messaging: automatic email + WhatsApp click-to-send.
- Owners: a whole property may have one owner, or different units may have different owners.
- Stack: React frontend on Cloudflare, Node (NestJS) backend on **edgdmedia's VPS**, following Unclutter Desk; add Postgres RLS; use Better Auth.
- Builders: Claude Code alongside OpenCode. All docs and plans must let any AI pick up and build.

**Assumptions (owner may correct)**
- Market: Nigerian short-let operators, starting in Lagos; NGN; Africa/Lagos timezone; WhatsApp-first guests.
- Operators run ~1–50 units; one owner per unit (joint owners as one record).
- Statement revenue is recognised per night stayed (accrual), not cash received.
- Domains `app.boogbe.com` / `api.boogbe.com` (domain not yet confirmed).
- Email via Resend from a platform sending domain.

**Success criteria**
- Tanuhomes runs all bookings in Boogbe from M4.
- Zero double bookings (database-enforced).
- A second operator is onboarded at M8 with zero code changes.
- Monthly owner statements in under 10 minutes of admin time.

## 2. Scope
In/out of scope exactly as [`PRD.md` §5](../../PRD.md). Functional requirements with IDs and acceptance criteria: [`FRD.md`](../../FRD.md).

## 3. Architecture (summary — full: [`ARCHITECTURE.md`](../../ARCHITECTURE.md))
- pnpm monorepo: `apps/api` (NestJS + Prisma), `apps/app` (React SPA), `packages/shared` (zod contracts + pure domain logic), `packages/ui`.
- SPA on Cloudflare Pages; API + worker (crons) as two PM2 processes behind nginx on the edgdmedia VPS; Postgres 16 on the VPS; R2 for files and backups; Resend for email.
- **Auth:** Better Auth with organization (operator = organization) and admin plugins; role re-checked from the DB on every request.
- **Tenant isolation:** `OrgDb` (transaction with `set_config('app.org_id')` + Prisma extension injecting `orgId`) **and** forced Postgres RLS under a non-bypass runtime role; static and integration guards in CI.
- **Integrity:** exclusion constraint prevents overlapping active bookings; unit row lock for block checks; append-only ledger and audit; per-operator counters for numbering; email outbox.

## 4. Data model (summary — full: [`DATA_MODEL.md`](../../DATA_MODEL.md))
Operator settings; properties → units; owners with effective-dated unit ownership (property default owner, unit override); unit fees; blocks (manual + iCal); guests; bookings with snapshotted price lines and status events; append-only payments (payment/refund/deposit received/returned/withheld/void); iCal feeds, exports, conflicts; message templates + outbox; tasks + photos; expenses + allocations; statements (draft → finalised snapshot → paid); notifications; audit log; files.

## 5. User experience (by role)
- **Admin / front desk:** calendar grid (units × dates; mobile list view), booking flow (unit+dates → clash check → guest → computed total with override → tentative/confirmed), booking page (lines, payments, balance, messages, check-in/out, cancel/refund), guests, money dashboard; admin also owners, statements, settings, team, audit.
- **Housekeeper (mobile):** today/upcoming tasks, start/done with notes and photos, report issue.
- **Owner (read-only):** own units' calendar and occupancy, month-to-date revenue, finalised statements.
- **Platform admin:** create/suspend operators, invite first admin.
- **Automations:** iCal import every 15 min with clash alerts; turnover task on checkout; confirmation/receipt/check-in emails; tentative hold expiry; monthly draft statements on the 1st.

## 6. Milestones
| # | Delivers | Exit criteria |
|---|---|---|
| M0 | Foundation: monorepo, Better Auth + orgs + invites, OrgDb + RLS + guards, app shell, CI, deploy (staging + prod), platform admin | E2E-01 passes on staging |
| M1 | Properties, units, owners/ownership, fees, manual blocks, calendar grid | Tanuhomes' 6 apartments configured on staging |
| M2 | Guests, bookings, pricing, statuses, holds, audit | E2E-02, E2E-03; race test green |
| M3 | Payments ledger, deposits, refunds, receipts, money dashboard | E2E-04 |
| M4 | iCal import/export, conflicts, notifications | **Tanuhomes live in production** |
| M5 | Templates, outbox, automatic emails, WhatsApp links, message log | E2E-07 |
| M6 | Tasks, turnover automation, housekeeper app | E2E-05 |
| M7 | Expenses, allocation, statements + PDF, owner portal | E2E-06; reconciliation test |
| M8 | Security review, restore drill, perf check, privacy export/delete, second operator | Second operator live, no code changes |

Dependency graph and agent split: [`COORDINATION.md`](../../COORDINATION.md).

## 7. Testing
As [`TESTING.md`](../../TESTING.md): TDD throughout; domain unit tests in `packages/shared`; API integration tests against real Postgres as the RLS-bound role; mandatory cross-tenant, RLS, race, immutability, reconciliation, iCal-fixture and permission-matrix suites; Playwright journeys E2E-01…07; CI gates on every PR.

## 8. Error handling
- API errors use a single envelope with stable codes (`packages/shared/src/errors.ts`); the app maps codes to plain-English messages.
- Expected conflicts (dates unavailable, invalid status transition, last admin) are 409/422 with details the UI can act on.
- External failures (iCal fetch, email send) never fail the user's action: they are recorded (feed health, outbox status), retried, and surfaced as notifications.
- Unexpected errors → 500 with request id; Sentry with PII scrubbing.

## 9. Open items for the owner (do not block M0)
1. Confirm domain (`boogbe.com` assumed) and that Cloudflare manages its DNS.
2. edgdmedia VPS access details (host, SSH user) as GitHub secrets; confirm Postgres 16 can be installed there.
3. Resend account for the platform sending domain.
4. Confirm statement revenue basis (accrual per night, D-017).

## 10. Next step
After owner approval of this spec: superpowers `writing-plans` produces `docs/plans/M0-foundation.md` … `M8-hardening.md` with task IDs, and the task board in `COORDINATION.md` is populated.
