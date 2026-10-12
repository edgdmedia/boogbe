# Boogbe — Agent Coordination

Two AI builders work on this repo: **Claude Code** (`claude`) and **OpenCode** (`opencode`). The human owner (EDGD Media) approves plans and merges to `main`.

## Ground rules

1. **Claim before you start.** Edit the task board below: set `Owner` and `Status: in_progress`, commit that change alone to `dev` (`chore(board): claim T-xxx`) and push. If the push conflicts, someone else claimed first — pull and pick another task.
2. **One task = one branch = one worktree.** Branch `t-<id>-<slug>` from latest `dev`; worktree under `.worktrees/` (git-ignored). Never work directly on `dev` or `main`.
3. **Shared surfaces have a single owner at a time:**
   | Surface | Rule |
   |---|---|
   | `prisma/schema.prisma`, `prisma/migrations/` | Only tasks tagged `[schema]` touch these. One `[schema]` task in progress at a time. |
   | `packages/shared/src/contracts/` | A module's contract file is written by its **API** task first and merged before the matching **UI** task starts building against it (UI may start with a local stub). Changing a merged contract = new `[contract]` task. |
   | `packages/shared/src/permissions.ts`, `errors.ts`, `enums.ts` | Append-only during parallel work; no renames. |
   | `AGENTS.md`, `docs/*.md` | Edit via small PRs; never in a feature branch unless the task says so. |
4. **Merge order:** API task → contract on `dev` → UI task rebases onto it.
5. **PR review:** each PR is reviewed by the *other* agent (superpowers `requesting-code-review` / `receiving-code-review`) before the owner merges. Reviewer checks FRD AC coverage, tenant isolation, tests.
6. **Merge check:** before merging, confirm the PR number, task ID and branch all match the board row, and that the PR has an approving review from the other builder. Mismatch → don't merge, ask. Both builders push as the same GitHub account, so GitHub's "Approve" button is unavailable: a review comment from the other builder that says **"Approved"** and names the task ID counts as the approval.
7. **Done** = PR merged into `dev` and the task row set to `done` with the PR link.
8. **Blocked?** Set `Status: blocked`, write why in Notes, and pick another unblocked task.
9. Never force-push shared branches. Never rewrite `dev`/`main` history.

## Status values
`todo` · `in_progress` · `review` · `blocked` · `done`

## Task board

Tasks are generated from the implementation plans in `docs/plans/`. Each plan lists its tasks with IDs `T-<milestone><nn>` (e.g. `T-M2-04`), dependencies, and track (`api`, `ui`, `schema`, `infra`, `domain`).

| ID | Title | Track | Depends on | Owner | Status | PR | Notes |
|---|---|---|---|---|---|---|---|
| T-M0-01 | Monorepo scaffold + shared money module | infra | — | claude | done | [#1](https://github.com/edgdmedia/boogbe/pull/1) | `docs/plans/M0-foundation.md` Task 1 |
| T-M0-02 | Dates, errors, enums, permissions | domain | T-M0-01 | claude | done | [#2](https://github.com/edgdmedia/boogbe/pull/2) | |
| T-M0-03 | Postgres roles, Prisma schema with Better Auth models, base migration | schema, infra | T-M0-02 | claude | done | [#3](https://github.com/edgdmedia/boogbe/pull/3) | |
| T-M0-04 | Nest app skeleton — env, health, error envelope, request id | api | T-M0-03 | claude | done | [#3](https://github.com/edgdmedia/boogbe/pull/3) | |
| T-M0-05 | Better Auth — config, mounting, invite-only sign-up, lockout, password reset | api | T-M0-04 | claude | done | [#5](https://github.com/edgdmedia/boogbe/pull/5) | |
| T-M0-06 | Session guard, permission decorators, route-permission spec | api | T-M0-05 | opencode | done | [#6](https://github.com/edgdmedia/boogbe/pull/6) | |
| T-M0-07 | OrgDb + RLS + isolation guards | schema, api | T-M0-06 | opencode | done | [#7](https://github.com/edgdmedia/boogbe/pull/7) | |
| T-M0-08 | Platform admin — operators, first-admin invitation, org settings read | api | T-M0-07 | opencode | done | [#8](https://github.com/edgdmedia/boogbe/pull/8) | |
| T-M0-09 | Team management rules via Better Auth hooks | api | T-M0-08 | opencode | done | [#9](https://github.com/edgdmedia/boogbe/pull/9) | |
| T-M0-10 | Worker process, job runner, cross-tenant isolation harness | infra | T-M0-09 | opencode | done | [#10](https://github.com/edgdmedia/boogbe/pull/10) | |
| T-M0-11 | App scaffold, UI primitives, API + auth clients, auth pages | ui | T-M0-10 | claude | done | [#11](https://github.com/edgdmedia/boogbe/pull/11) | reviewed+approved by opencode |
| T-M0-12 | App shell, role landing, org switcher, platform pages, team & sessions | ui | T-M0-11 | claude | done | [#13](https://github.com/edgdmedia/boogbe/pull/13) | #12 closed as stacked PR; content merged inside #13; opencode approved |
| T-M0-13 | CI, deploy scripts, PM2, nginx, backups, runbook | infra | T-M0-12 | claude | done | [#13](https://github.com/edgdmedia/boogbe/pull/13) | reviewed+approved by opencode; owner must confirm BETTER_AUTH_URL=API-origin in runbook |
| T-M0-14 | Playwright + E2E-01, staging verification | e2e | T-M0-13 | claude | done | [#14](https://github.com/edgdmedia/boogbe/pull/14) | reviewed+approved by opencode (E2E-01 re-passed locally, 2/2). Exit gate: staging E2E run still pending owner infra (VPS, DNS, Pages, GH secrets) |
| T-M0-15 | Auth hardening from T-M0-05 review: invite-bound sign-up (no squatting), no account enumeration on sign-up, trusted client-IP header for rate limits, origin-check test | api | T-M0-10 | opencode | done | [#16](https://github.com/edgdmedia/boogbe/pull/16) | CI verify green; int 54/54 incl. +9 hardening tests; E2E-01 2/2; relates to `requireEmailVerificationOnInvitation: false` (T-M0-08) |
| T-M0-16 | [schema] Make 0001_init's `_prisma_migrations` REVOKE conditional so `prisma migrate dev` works with a shadow DB (owner-approved re-baseline; local DBs reset once) | schema | T-M0-14 | claude | done | [#15](https://github.com/edgdmedia/boogbe/pull/15) | Late-reviewed+approved by opencode (merged accidentally before review — verified: 45→54 int green, drift guard clean); dev DB reset done |
| T-M0-17 | Cookie & CSRF hardening tests: session cookie HttpOnly + SameSite (Lax/Strict) + Secure in production; state-changing `/v1/*` routes must reject non-JSON content types (HTML form POST must not reach them). better-auth doesn't hard-403 origins, so these attributes are our cross-site protection — pinned by tests; fix anything that fails | api | T-M0-15 | opencode | done | [#20](https://github.com/edgdmedia/boogbe/pull/20) | Approved T-M0-17 by claude; rebased (errors.ts merge + prod R2_* vars); int 88/88 at merge |
| T-M0-18 | Guards and rules follow-up: Organization-relation static guard, per-agent test DBs, merge-check rule | api, docs | T-M0-16 | claude | done | [#19](https://github.com/edgdmedia/boogbe/pull/19) | reviewed+approved by opencode; merged under the new merge-check rule |
| T-M0-19 | Disable auto-deploy (Deploy API/App on workflow_dispatch only) until VPS setup; clarify rule 6 approvals for the shared GitHub account | infra, docs | T-M0-13 | claude | done | [#26](https://github.com/edgdmedia/boogbe/pull/26) | 'Approved T-M0-19' comment by opencode; merged. NOTE: no deploy runs until owner enables VPS |
| T-M1-01 | Inventory & calendar contracts, ownership and fee helpers | domain | M0 (T-M0-14) | opencode | done | [#18](https://github.com/edgdmedia/boogbe/pull/18) | CI green, int 54/54; T-M1-06/07 unblocked (stubs allowed) |
| T-M1-02 | Inventory tables, RLS, exclusion constraints | schema | T-M1-01 | claude | done | [#17](https://github.com/edgdmedia/boogbe/pull/17) | opencode approved incl. declared-FK deviation (drift-guard-safe); follow-up: add migration-rules note + DECISIONS entry for the owner |
| T-M1-03 | Files service (R2 presigned uploads) and operator logo | api | T-M1-02 | claude | done | [#22](https://github.com/edgdmedia/boogbe/pull/22) | opencode approved+merged; 72/72 int re-verified on boogbe_test_opencode; T-M1-08 unblocked |
| T-M1-04 | Owners, properties, units, ownership, fee config API | api | T-M1-02 | claude | done | [#21](https://github.com/edgdmedia/boogbe/pull/21) | opencode approved+merged; 67/67 verified; T-M1-06 (#23) mergeable after claude approves |
| T-M1-05 | Unit fees, manual blocks, calendar API | api | T-M1-04 | claude | done | [#24](https://github.com/edgdmedia/boogbe/pull/24) | opencode approved+merged; 80/80 verified; T-M1-07 (calendar UI) starting |
| T-M1-06 | Inventory settings UI | ui | T-M1-01 (stub); merge after T-M1-04 | opencode | done | [#23](https://github.com/edgdmedia/boogbe/pull/23) | approved by claude, merged; follow-up T-M1-09 |
| T-M1-07 | Calendar grid (desktop) + day list (mobile), blocks | ui | T-M1-01 (stub); merge after T-M1-05 | opencode | done | [#25](https://github.com/edgdmedia/boogbe/pull/25) | Approved T-M1-07 by claude (re-review of the window fix); merged |
| T-M1-08 | Logo upload UI + Tanuhomes seed script | ui, infra | T-M1-03, T-M1-06 | opencode | done | [#29](https://github.com/edgdmedia/boogbe/pull/29) | Approved T-M1-08 by claude; OrgProfile logoUrl/strict-PATCH bug fixed; seed figures confirmed by owner; staging exit check parked |
| T-M1-09 | Property default-owner UI: owner picker + effective date on PropertyDetail (`POST /v1/properties/:id/owner`, `SetPropertyOwnerInput`) | ui | T-M1-06 | opencode | done | [#27](https://github.com/edgdmedia/boogbe/pull/27) | Approved T-M1-09 by claude; merged |
| T-M2-01 | Pricing, booking status, phone helpers and contracts | domain | M1 | claude | done | [#28](https://github.com/edgdmedia/boogbe/pull/28) | 'Approved T-M2-01' by opencode; merged; T-M2-07/08 contracts live |
| T-M2-02 | Schema 0004_bookings: guests, bookings, lines, status events, notifications | schema | T-M2-01 | claude | done | [#30](https://github.com/edgdmedia/boogbe/pull/30) | Approved T-M2-02 by opencode; no-overlap WHERE matches ACTIVE_STATUSES; 82/82 verified |
| T-M2-03 | Guests API | api | T-M2-02 | claude | done | [#31](https://github.com/edgdmedia/boogbe/pull/31) | Approved T-M2-03 by opencode; 88/88 verified; T-M2-07 unblocked |
| T-M2-04 | Quote, create, get, list bookings; BookingSource | api | T-M2-03 | claude | done | [#32](https://github.com/edgdmedia/boogbe/pull/32) | Approved T-M2-04 by opencode; 101/101 verified incl. 20-way race; pool-starvation fix noted |
| T-M2-05 | Edit/move/reprice, status transitions, cancel, holds job, notifications | api | T-M2-04 | claude | done | [#33](https://github.com/edgdmedia/boogbe/pull/33) | Approved T-M2-05 by opencode; 107/107 verified; T-M2-08 unblocked |
| T-M2-06 | Audit viewer API | api | T-M2-02 | claude | review | [#35](https://github.com/edgdmedia/boogbe/pull/35) | Includes booking_no_overlap ↔ ACTIVE_STATUSES guard |
| T-M2-07 | Guests pages and guest picker | ui | T-M2-01 (stub); merge after T-M2-03 | opencode | done | [#34](https://github.com/edgdmedia/boogbe/pull/34) | Approved by claude; merged with the silent duplicate-check fix (app 24/24) |
| T-M2-08 | Booking form, booking detail, bookings list | ui | T-M1-01 (stub); merge after T-M2-05 | opencode | review | [#37](https://github.com/edgdmedia/boogbe/pull/37) | rebased onto dev (booking commit only); app 33/33, int 115/115; awaiting 'Approved T-M2-08' |
| T-M2-10 | Guests list paging: 'Load more' via cursor (currently only the first 30) | ui | T-M2-07 | opencode | review | [#45](https://github.com/edgdmedia/boogbe/pull/45) | Owner follow-up after #34; claude reviews |
| T-M2-11 | Booking edit dialog: move to another unit + require reason client-side when total changes | ui | T-M2-08 | opencode | in_progress | | Owner follow-up after #37; claude reviews |
| T-M2-09 | Notifications bell, audit page, E2E-02 and E2E-03 | ui, e2e | T-M2-05, T-M2-06, T-M2-08 | | todo | | suggested: opencode |
| T-M3-01 | Ledger maths and payment contracts | domain | M2 | claude | done | [#36](https://github.com/edgdmedia/boogbe/pull/36) | On merge: T-M3-06 can build against the contracts |
| T-M3-02 | Schema 0005: payment table, booking_money view, append-only grants | schema | T-M3-01 | claude | done | [#38](https://github.com/edgdmedia/boogbe/pull/38) | Rebased on dev after #36 merged |
| T-M3-03 | Payments API, booking decoration, auto-confirm, balance filter, calendar balances | api | T-M3-02 | claude | done | [#39](https://github.com/edgdmedia/boogbe/pull/39) | Stacked on #38 |
| T-M3-04 | Cancel with refund; receipt PDF | api | T-M3-03 | claude | done | [#40](https://github.com/edgdmedia/boogbe/pull/40) | Stacked on #39 (rebased) |
| T-M3-05 | Money summary API | api | T-M3-03 | claude | review | [#44](https://github.com/edgdmedia/boogbe/pull/44) | From dev |
| T-M3-06 | Payments panel and refund-on-cancel UI | ui | T-M3-01 (stub); merge after T-M3-04 | | todo | | suggested: opencode |
| T-M3-07 | Money dashboard UI + E2E-04 | ui, e2e | T-M3-05, T-M3-06 | | todo | | suggested: opencode |
| T-M4-01 | iCal contracts | domain | M2 | claude | review | [#42](https://github.com/edgdmedia/boogbe/pull/42) | From dev; independent of M3 |
| T-M4-02 | Schema: feeds, exports, conflicts, token lookup function | schema | T-M4-01 | claude | in_progress |  | Stacked on #42 |
| T-M4-03 | SSRF-safe fetcher, node-ical parser and fixtures | api | T-M4-01 | claude | review | [#43](https://github.com/edgdmedia/boogbe/pull/43) | From dev; independent of M3 and #42 |
| T-M4-04 | Feeds API, sync service, import job, health alerts, AlertMailer | api | T-M4-02, T-M4-03 |  | todo |  | suggested: claude |
| T-M4-05 | Conflicts: detection, resolution, calendar flag | api | T-M4-04; M3 (cancelWithRefund) |  | todo |  | suggested: claude |
| T-M4-06 | Export links and public .ics | api | T-M4-02 |  | todo |  | suggested: claude |
| T-M4-07 | Calendar-sync UI, conflicts page, calendar markers | ui | T-M4-01 (stub); merge after T-M4-05/06 |  | todo |  | suggested: opencode |
| T-M4-08 | Production go-live for Tanuhomes | infra | all above |  | todo |  | claude + owner; blocked until owner allows VPS work |

## Parallelism map (by milestone)

- **M0** is sequential, single agent (Claude Code), because it establishes every shared surface.
- **M1–M7**: each milestone's plan splits into `domain` + `schema` (first, one agent), then `api` and `ui` tracks in parallel. Typical split: Claude Code takes `api`, OpenCode takes `ui`, alternating per milestone so both know both halves.
- Independent milestones may overlap once their dependencies are merged: M4 (iCal) and M5 (messaging) can run alongside M3; M6 depends on M2; M7 depends on M3.

```
M0 ─► M1 ─► M2 ─┬─► M3 ─┬─► M7 ─┐
                ├─► M4  │       ├─► M8
                ├─► M5 ─┘       │
                └─► M6 ─────────┘
```
