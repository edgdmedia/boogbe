# AGENTS.md — rules for every AI working on Boogbe

Read this whole file before doing anything. It applies to OpenCode, Claude Code and any other agent.

## What this is
Boogbe by EDGD Media: a multi-tenant back office for Nigerian short-let operators (bookings, payments, iCal sync, housekeeping, owner statements). First operator: Tanuhomes (Lekki, Lagos).

## Read first (in order)
1. `docs/superpowers/specs/2026-10-09-boogbe-v1-design.md` — the approved design
2. `docs/PRD.md` → `docs/FRD.md` (requirement IDs) → `docs/ARCHITECTURE.md` → `docs/DATA_MODEL.md`
3. `docs/TESTING.md`, `docs/DECISIONS.md`
4. `docs/COORDINATION.md` — **claim a task there before you start**
5. The plan for your milestone in `docs/plans/`

## Workflow
- Pick an unclaimed task whose dependencies are `done`; claim it per `docs/COORDINATION.md`.
- Branch `t-<id>-<slug>` from `dev` in a worktree under `.worktrees/`.
- **TDD**: failing test → minimal code → green → refactor. Commit small, often.
- Commit messages: `<type>(<area>): <summary> [<FRD-IDs>]`, e.g. `feat(bookings): refuse overlapping stays [BKG-02]`.
- Open a PR to `dev`; ask the other agent to review; update the task board.
- **Before merging** any PR: confirm the PR number, task ID and branch all match the board row you are closing, and that the PR has an approving review from the *other* builder. (Same GitHub account for both builders: a review comment saying "Approved" with the task ID counts.) If any of these don't line up, don't merge — ask.
  - **If `dev` has moved since the PR's CI ran, rebase onto `dev` and run the full local gate (typecheck, lint, unit, int) before merging.** CI no longer runs on pushes to `dev`, so a PR that was green against an older `dev` proves nothing about the merged result.
  - The PR's base must be `dev`. A stacked PR whose base branch has already merged must be retargeted to `dev` first, or it merges into a dead branch (this is how #55 missed `dev`).
- Do not start work that is not on the task board. If you find missing work, add a `todo` row and tell the owner.

## Non-negotiable rules
1. **Tenant isolation.** Tenant data is only accessed through `OrgDb` (`apps/api/src/common/db`). Never import `PrismaClient`/`PrismaService` in a module. Never `update({ where: { id } })` on a tenant model — use `updateMany({ where: { id, orgId } })` or `OrgDb` helpers. Every new tenant table: `org_id`, RLS enabled + forced, policy, grants (see `docs/DATA_MODEL.md` → Migration rules).
2. **Every route** declares `@Permission(...)` or `@Public()`.
3. **Contracts** live in `packages/shared/src/contracts`. Do not hand-write request/response types in apps.
4. **Money** is integer kobo (`bigint` in DB, `number` in TS within safe range; use `packages/shared/src/domain/money.ts`). Never floats. Never format money by hand.
5. **Dates**: stay dates are `YYYY-MM-DD` strings / `date` columns; use `packages/shared/src/domain/dates.ts`. "Today" is computed in the operator's timezone.
6. **Payments, audit log and finalised statements are append-only.** Corrections are new rows.
7. **Schema changes** only in `[schema]` tasks; one at a time.
8. **Secrets** never in code, logs, fixtures or commits. `.env*` is git-ignored.
9. **No new dependencies** without noting them in the PR description with a reason. Prefer what Unclutter Desk already uses.
10. Don't change `docs/DECISIONS.md` decisions on your own — propose a new entry in the PR and flag the owner.

## Stack (do not swap)
pnpm workspaces · Node 22 · TypeScript 5 strict · NestJS 10 · Prisma 5 · PostgreSQL 16 · Better Auth (organization + admin plugins) · zod + nestjs-zod · React 18 + Vite + React Router + SWR + Tailwind 4 · Vitest · Playwright · pdfkit · Resend · Cloudflare R2 (S3 API) · @nestjs/schedule · Sentry · PM2 + nginx on the edgdmedia VPS · Cloudflare Pages.

## Reference implementation
`~/Projects/Unclutter/unclutterdesk` uses the same stack. When a plan says "as Unclutter <path>", open that file and follow its pattern (adapting `tenantId` → `orgId`, NestJS JWT auth → Better Auth). Do not copy Unclutter-specific business logic.

## Commands
Defined in M0; see `README.md`. Before every PR: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:int`.

**Per-agent test databases.** `pnpm test:int` resets its database on every run, so each builder points `TEST_DATABASE_URL` / `TEST_DATABASE_MIGRATE_URL` in its local `.env` at its own database: `boogbe_test_claude` for Claude Code, `boogbe_test_opencode` for OpenCode (CI uses `boogbe_test`). Fresh `docker compose` volumes create both; for an existing volume run once:
`docker exec boogbe-db-1 psql -U postgres -c "CREATE DATABASE boogbe_test_<agent> OWNER boogbe_migrator" && docker exec boogbe-db-1 psql -U postgres -d boogbe_test_<agent> -c "CREATE EXTENSION IF NOT EXISTS btree_gist; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS citext; GRANT CONNECT ON DATABASE boogbe_test_<agent> TO boogbe_app;"`.
Don't reset the shared `boogbe_dev` while the other builder may be using it; generate migrations with `prisma migrate diff` against a throwaway shadow database if `migrate dev` wants to reset.

**DB container.** Start/stop `boogbe-db-1` only via the compose file in the **main checkout** (`cd ~/Projects/boogbe && docker compose -f docker-compose.dev.yml up -d db`) — never from a worktree's copy, because the init-SQL bind mounts then point into that worktree and removing it later breaks the container.
**Owner preview is off-limits.** The owner runs a local preview on ports **3070/5180** with database **`boogbe_owner`** (see README → Owner preview). Never touch those. E2E must set `E2E_APP_PORT` away from 5173 **and** 5180 (e.g. 5182).

## Style
- Match surrounding code. Small focused files (< ~300 lines). Services hold logic; controllers are thin.
- Comments explain *why*, not *what*.
- UI copy: plain English, Nigerian context (₦, "caution deposit", "POS", "transfer"), no jargon.
