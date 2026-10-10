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
6. **Done** = PR merged into `dev` and the task row set to `done` with the PR link.
7. **Blocked?** Set `Status: blocked`, write why in Notes, and pick another unblocked task.
8. Never force-push shared branches. Never rewrite `dev`/`main` history.

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
| T-M0-07 | OrgDb + RLS + isolation guards | schema, api | T-M0-06 | opencode | in_progress | | |
| T-M0-08 | Platform admin — operators, first-admin invitation, org settings read | api | T-M0-07 | claude | todo | | |
| T-M0-09 | Team management rules via Better Auth hooks | api | T-M0-08 | claude | todo | | |
| T-M0-10 | Worker process, job runner, cross-tenant isolation harness | infra | T-M0-09 | claude | todo | | |
| T-M0-11 | App scaffold, UI primitives, API + auth clients, auth pages | ui | T-M0-10 | claude | todo | | |
| T-M0-12 | App shell, role landing, org switcher, platform pages, team & sessions | ui | T-M0-11 | claude | todo | | |
| T-M0-13 | CI, deploy scripts, PM2, nginx, backups, runbook | infra | T-M0-12 | claude | todo | | |
| T-M0-14 | Playwright + E2E-01, staging verification | e2e | T-M0-13 | claude | todo | | M0 exit gate |
| T-M1-01 | Inventory & calendar contracts, ownership and fee helpers | domain | M0 (T-M0-14) | | todo | | `docs/plans/M1-inventory-calendar.md` Task 1; suggested: claude |
| T-M1-02 | Inventory tables, RLS, exclusion constraints | schema | T-M1-01 | | todo | | suggested: claude |
| T-M1-03 | Files service (R2 presigned uploads) and operator logo | api | T-M1-02 | | todo | | suggested: claude |
| T-M1-04 | Owners, properties, units, ownership, fee config API | api | T-M1-02 | | todo | | suggested: claude |
| T-M1-05 | Unit fees, manual blocks, calendar API | api | T-M1-04 | | todo | | suggested: claude |
| T-M1-06 | Inventory settings UI | ui | T-M1-01 (stub); merge after T-M1-04 | | todo | | suggested: opencode |
| T-M1-07 | Calendar grid (desktop) + day list (mobile), blocks | ui | T-M1-01 (stub); merge after T-M1-05 | | todo | | suggested: opencode |
| T-M1-08 | Logo upload UI + Tanuhomes seed script | ui, infra | T-M1-03, T-M1-06 | | todo | | suggested: opencode |

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
