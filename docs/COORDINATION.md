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
| — | *Populated when plans are approved* | | | | | | |

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
