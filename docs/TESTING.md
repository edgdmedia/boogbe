# Boogbe — Testing Strategy

**Rule:** TDD. Write the failing test first, see it fail for the right reason, then implement (superpowers `test-driven-development`). No PR merges with failing or skipped tests.

## Layers

| Layer | Tool | Where | What |
|---|---|---|---|
| Domain unit | Vitest | `packages/shared/src/domain/*.test.ts` | pricing, ledger, revenue recognition, allocation, statement maths, dates/timezones, money rounding. Fixture tables; property-style tests for invariants (allocations sum to total; recognised revenue over all months = booking revenue). |
| API unit | Vitest | `apps/api/src/**/*.spec.ts` | services with mocked `OrgDb` where logic is non-trivial; guards; pipes; template renderer; iCal parser. |
| API integration | Vitest + real Postgres | `apps/api/test/**/*.int.ts` | HTTP via supertest against a booted Nest app, connected as **`boogbe_app`** (so RLS is real). Each test file gets a fresh schema via `prisma migrate reset` once + transaction-per-test truncation helper. |
| Static guards | Vitest | `apps/api/src/*.spec.ts` | `tenant-isolation.spec.ts`, `route-permissions.spec.ts`, `rls-coverage.spec.ts` (integration DB). |
| App component | Vitest + Testing Library + jsdom | `apps/app/src/**/*.test.tsx` | forms validate with shared schemas, calendar rendering, role-based nav. |
| End-to-end | Playwright | `e2e/*.spec.ts` | against local API + app with seeded data. |

## Mandatory test suites

1. **Cross-tenant suite** (`apps/api/test/isolation.int.ts`): seeds operators A and B; for **every** route in the route table (`test-support/routes.ts`, generated from Nest's router), a user of A tries to read/write B's resource ids → expects 404 (never 200/403 leaking existence). New routes are picked up automatically.
2. **RLS direct test:** connect as `boogbe_app`, no `app.org_id` set → `SELECT count(*)` on every tenant table returns 0; with A set → B's rows invisible; insert with B's org_id under A's context → fails.
3. **Double-booking race:** 20 concurrent create requests for overlapping dates on one unit → exactly 1 succeeds, 19 get 409.
4. **Ledger immutability:** app role `UPDATE payment` / `DELETE payment` → permission denied.
5. **Statement reconciliation:** generated fixture month — Σ statement gross across owners + operator-owned units = Σ recognised revenue for the org.
6. **iCal fixtures:** `apps/api/test/fixtures/ical/` — real-shaped Airbnb, Booking.com, VRBO exports; all-day vs datetime events; timezone-less; cancelled events; malformed; > 2 MB; HTTP 304/404/timeout.
7. **Permission matrix:** table-driven test over FRD AUTH-09 matrix for each role × capability.

## E2E journeys (Playwright)
- E2E-01 Platform admin creates operator → invite → admin accepts → lands on empty calendar.
- E2E-02 Admin adds property, unit, fee → creates booking from calendar cell → sees price breakdown.
- E2E-03 Overlapping booking refused with clear message.
- E2E-04 Record part-payment → balance updates → receipt PDF downloads.
- E2E-05 Checkout → turnover task appears for housekeeper on mobile viewport (360×740) → mark done with photo.
- E2E-06 Generate and finalise owner statement → owner logs in → downloads PDF; cannot see other owner's unit.
- E2E-07 WhatsApp button opens correct `wa.me` URL with rendered text.

## Commands (target, defined in M0)
```
pnpm test            # all unit tests
pnpm test:int        # API integration (needs TEST_DATABASE_URL, migrator + app roles)
pnpm test:e2e        # Playwright
pnpm typecheck
pnpm lint
```

## CI gates
PR to `dev` or `main` must pass: typecheck, lint, unit, integration (Postgres 16 service container with roles created by `deploy/sql/roles.sql`), migrations apply from scratch, Playwright E2E smoke (E2E-01..04) on `main` PRs.

## Definition of done (per task)
- FRD acceptance criteria for the referenced IDs are covered by tests.
- Typecheck, lint, all tests green locally.
- Docs updated if behaviour/schema/contract changed.
- `docs/COORDINATION.md` task row updated.
