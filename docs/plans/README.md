# Implementation plans — index

All plans follow the approved spec `docs/superpowers/specs/2026-10-09-boogbe-v1-design.md`. Execute with superpowers `subagent-driven-development` or `executing-plans`. Claim tasks on the board in `docs/COORDINATION.md` — copy a milestone's rows from this index onto the board when the milestone starts.

## When OpenCode joins

- **M0** — Claude Code only (sets up every shared surface). OpenCode may review PRs.
- **From M1** — OpenCode takes the **ui** (and some e2e/infra) tasks; Claude Code takes **domain/schema/api**. A UI task may start against a local stub as soon as its milestone's contracts task (`T-Mx-01`) is merged to `dev`, and merges after the API task it consumes.
- First OpenCode tasks: **T-M1-06, T-M1-07, T-M1-08**.

## Milestone order

```
M0 ─► M1 ─► M2 ─┬─► M3 ─┬─► M4 (Tanuhomes go-live) ─┐
                │       ├─► M5                      │
                │       └─► M7 ─────────────────────┼─► M8 (second operator)
                └─► M6 ─────────────────────────────┘
```

## M0 — Foundation Implementation Plan  ·  [`M0-foundation.md`](M0-foundation.md)

| Task | Track | Agent | Depends on |
|---|---|---|---|
| T-M0-01 Monorepo scaffold + shared money module | infra | Claude Code | — |
| T-M0-02 Dates, errors, enums, permissions | domain | Claude Code | T-M0-01 |
| T-M0-03 Postgres roles, Prisma schema with Better Auth models, base migration | schema, infra | Claude Code | T-M0-02 |
| T-M0-04 Nest app skeleton — env, health, error envelope, request id | api | Claude Code | T-M0-03 |
| T-M0-05 Better Auth — config, mounting, invite-only sign-up, lockout, password reset | api | Claude Code | T-M0-04 |
| T-M0-06 Session guard, permission decorators, route-permission spec | api | Claude Code | T-M0-05 |
| T-M0-08 Platform admin — operators, first-admin invitation, org settings read | api | Claude Code | T-M0-07 |
| T-M0-09 Team management rules via Better Auth hooks | api | Claude Code | T-M0-08 |
| T-M0-10 Worker process, job runner, cross-tenant isolation harness | infra | Claude Code | T-M0-09 |
| T-M0-11 App scaffold, UI primitives, API + auth clients, sign-in, accept invite, password reset | ui | Claude Code | T-M0-10 |
| T-M0-12 App shell, role landing, org switcher, platform pages, team & sessions settings | ui | Claude Code | T-M0-11 |
| T-M0-13 CI, deploy scripts, PM2, nginx, backups, runbook | infra | Claude Code | T-M0-12 |
| T-M0-14 Playwright + E2E-01, staging verification | e2e | Claude Code | T-M0-13 |

## M1 — Inventory & Calendar Implementation Plan  ·  [`M1-inventory-calendar.md`](M1-inventory-calendar.md)

| Task | Track | Suggested agent | Depends on |
|---|---|---|---|
| T-M1-01 Contracts + domain helpers | domain | Claude Code | M0 |
| T-M1-02 Schema + migration | schema | Claude Code | T-M1-01 |
| T-M1-03 Files service + logo | api | Claude Code | T-M1-02 |
| T-M1-04 Owners, properties, units, ownership, fee config API | api | Claude Code | T-M1-02 |
| T-M1-05 Unit fees, blocks, calendar API | api | Claude Code | T-M1-04 |
| T-M1-06 Inventory settings UI | ui | OpenCode | T-M1-01 (stub), merges after T-M1-04 |
| T-M1-07 Calendar UI | ui | OpenCode | T-M1-01 (stub), merges after T-M1-05 |
| T-M1-08 Logo upload UI + Tanuhomes seed script | ui/infra | OpenCode | T-M1-03, T-M1-06 |

## M2 — Guests & Bookings Implementation Plan  ·  [`M2-bookings-guests.md`](M2-bookings-guests.md)

| Task | Track | Suggested agent | Depends on |
|---|---|---|---|
| T-M2-01 Pricing/status domain + contracts | domain | Claude Code | M1 |
| T-M2-02 Schema: guests, bookings, lines, events, notifications | schema | Claude Code | T-M2-01 |
| T-M2-03 Guests API | api | Claude Code | T-M2-02 |
| T-M2-04 Quote + create + get + list bookings, BookingSource | api | Claude Code | T-M2-03 |
| T-M2-05 Edit/move/reprice, transitions, cancel, holds job, notifications | api | Claude Code | T-M2-04 |
| T-M2-06 Audit viewer API | api | Claude Code | T-M2-02 |
| T-M2-07 Guests UI + guest picker | ui | OpenCode | T-M2-01 (stub), merge after T-M2-03 |
| T-M2-08 Booking form, detail, list UI | ui | OpenCode | T-M2-01 (stub), merge after T-M2-05 |
| T-M2-09 Notifications bell, audit page, E2E-02/03 | ui/e2e | OpenCode | T-M2-05, T-M2-06, T-M2-08 |

## M3 — Payments Ledger Implementation Plan  ·  [`M3-payments.md`](M3-payments.md)

| Task | Track | Agent | Depends on |
|---|---|---|---|
| T-M3-01 Ledger domain + contracts | domain | Claude Code | M2 |
| T-M3-02 Schema: payment, views, grants | schema | Claude Code | T-M3-01 |
| T-M3-03 Payments API, decorate, auto-confirm, balance filter, calendar balance | api | Claude Code | T-M3-02 |
| T-M3-04 Cancel-with-refund + receipt PDF | api | Claude Code | T-M3-03 |
| T-M3-05 Money summary API | api | Claude Code | T-M3-03 |
| T-M3-06 Payments panel + refund-on-cancel UI | ui | OpenCode | T-M3-01 (stub), merge after T-M3-04 |
| T-M3-07 Money dashboard UI + E2E-04 | ui/e2e | OpenCode | T-M3-05, T-M3-06 |

## M4 — iCal Sync & Tanuhomes Go-Live Implementation Plan  ·  [`M4-ical-golive.md`](M4-ical-golive.md)

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

## M5 — Guest Messaging Implementation Plan  ·  [`M5-messaging.md`](M5-messaging.md)

| Task | Track | Agent | Depends on |
|---|---|---|---|
| T-M5-01 Template domain + defaults + contracts | domain | Claude Code | M3 |
| T-M5-02 Schema: templates, outbox | schema | Claude Code | T-M5-01 |
| T-M5-03 Templates API + variables | api | Claude Code | T-M5-02 |
| T-M5-04 Outbox + dispatcher + attachments | api | Claude Code | T-M5-02 |
| T-M5-05 Triggers, pre-arrival job, manual send, WhatsApp log, message log | api | Claude Code | T-M5-03, T-M5-04 |
| T-M5-06 Template editor UI | ui | OpenCode | T-M5-01 (stub), merge after T-M5-03 |
| T-M5-07 Booking messages panel + E2E-07 | ui/e2e | OpenCode | T-M5-05 |

## M6 — Housekeeping Implementation Plan  ·  [`M6-housekeeping.md`](M6-housekeeping.md)

| Task | Track | Agent | Depends on |
|---|---|---|---|
| T-M6-01 Domain + contracts | domain | Claude Code | M2 |
| T-M6-02 Schema | schema | Claude Code | T-M6-01 |
| T-M6-03 Tasks API (board, own, assignees) | api | Claude Code | T-M6-02 |
| T-M6-04 Turnover automation, sweep, cancel, issues, photos | api | Claude Code | T-M6-03 |
| T-M6-05 Task board UI + unit default assignee | ui | OpenCode | T-M6-01 (stub), merge after T-M6-03 |
| T-M6-06 Housekeeper app + compression + E2E-05 | ui/e2e | OpenCode | T-M6-04 |

## M7 — Owners, Expenses & Statements Implementation Plan  ·  [`M7-owners-statements.md`](M7-owners-statements.md)

| Task | Track | Agent | Depends on |
|---|---|---|---|
| T-M7-01 Revenue, allocation, statement maths | domain | Claude Code | M3 |
| T-M7-02 Contracts | domain | Claude Code | T-M7-01 |
| T-M7-03 Schema + immutability trigger | schema | Claude Code | T-M7-02 |
| T-M7-04 Expenses API | api | Claude Code | T-M7-03 |
| T-M7-05 Statement generation + reconciliation | api | Claude Code | T-M7-04 |
| T-M7-06 Finalise (PDF), paid, monthly job, month lock | api | Claude Code | T-M7-05 |
| T-M7-07 Owner portal API | api | Claude Code | T-M7-06 |
| T-M7-08 Expenses + statements UI | ui | OpenCode | T-M7-02 (stub), merge after T-M7-06 |
| T-M7-09 Owner portal UI + E2E-06 | ui/e2e | OpenCode | T-M7-07, T-M7-08 |

## M8 — Hardening & Second Operator Implementation Plan  ·  [`M8-hardening.md`](M8-hardening.md)

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
