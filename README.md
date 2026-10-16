# Boogbe by EDGD Media

*From the Yoruba "ibùgbé", a dwelling, an abode. It's the place your guests call home, and the place you run it from.*

Every stay, in one place — bookings, payments and calendars for short-let operators, under one roof.

## Status
Design phase. Start with [`docs/superpowers/specs/2026-10-09-boogbe-v1-design.md`](docs/superpowers/specs/2026-10-09-boogbe-v1-design.md).

## Docs
| Doc | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Rules for the AI builder (Claude Code) and its reviewers |
| [`docs/PRD.md`](docs/PRD.md) | Product requirements |
| [`docs/FRD.md`](docs/FRD.md) | Functional requirements with IDs + acceptance criteria |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Tables, constraints, RLS |
| [`docs/TESTING.md`](docs/TESTING.md) | Test strategy and gates |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decision log |
| [`docs/COORDINATION.md`](docs/COORDINATION.md) | Task board and multi-agent rules |
| [`docs/plans/`](docs/plans/) | Implementation plans per milestone |

## Development
Commands are set up in milestone M0.

## Owner preview
A local copy of `dev` for the owner to click through, kept apart from the builders' work. It lives in its own worktree `.worktrees/preview` and has its own database `boogbe_owner`. The API runs on port 3070 and the app at **http://localhost:5180**. Port 5173 is left free, and the builders' databases and ports are never touched.

- **Login:** the platform admin `edgdmedia@gmail.com`, who is also admin of the "Tanuhomes" operator. The password is in `.worktrees/preview/logs/owner-login.txt`, which is git-ignored, as is the preview's own `.env`. After signing in, open http://localhost:5180/ and choose Tanuhomes.
- **Data:** the Tanuhomes properties and units come from `seed-tanuhomes.ts`. Sample guests, bookings and payments are fictional.
- **Start** (from the repo root):
  ```sh
  cd .worktrees/preview && mkdir -p logs \
    && (nohup pnpm --filter @boogbe/api dev > logs/api.log 2>&1 &) \
    && (VITE_API_ORIGIN=http://localhost:3070 nohup pnpm --filter @boogbe/app exec vite --port 5180 --strictPort > logs/app.log 2>&1 &)
  ```
- **Stop:**
  ```sh
  pkill -f 'worktrees/preview/apps/api/node_modules/.bin/../@nestjs/cli'; lsof -ti tcp:3070,5180 -sTCP:LISTEN | xargs kill
  ```
- **Update to the latest `dev`:**
  ```sh
  cd .worktrees/preview && git fetch origin && git checkout --detach origin/dev && pnpm install \
    && pnpm --filter @boogbe/api prisma:generate && pnpm --filter @boogbe/shared --filter @boogbe/ui build
  ```
  If `dev` brought new migrations, apply them to `boogbe_owner` with `prisma migrate deploy`. Then stop and start the preview.
