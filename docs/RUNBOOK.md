# Boogbe Runbook

## One-time VPS setup (edgdmedia VPS)
1. `sudo adduser boogbe`; install Node 22 (nvm), pnpm 9, PM2 (`npm i -g pm2`), PostgreSQL 16, nginx, awscli v2.
2. Postgres: `sudo -u postgres psql` →
   ```sql
   CREATE ROLE boogbe_migrator LOGIN PASSWORD '<strong>' CREATEDB BYPASSRLS;
   CREATE ROLE boogbe_app LOGIN PASSWORD '<strong>' NOBYPASSRLS NOSUPERUSER;
   CREATE DATABASE boogbe OWNER boogbe_migrator;
   CREATE DATABASE boogbe_staging OWNER boogbe_migrator;
   \c boogbe
   CREATE EXTENSION IF NOT EXISTS btree_gist; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS citext;
   GRANT CONNECT ON DATABASE boogbe TO boogbe_app;
   \c boogbe_staging
   CREATE EXTENSION IF NOT EXISTS btree_gist; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS citext;
   GRANT CONNECT ON DATABASE boogbe_staging TO boogbe_app;
   ```
   Do **not** run `deploy/sql/roles.sql` here — its passwords are for local/CI only.
3. As `boogbe`: `git clone <repo> /home/boogbe/app` (branch `main`) and `/home/boogbe/staging` (branch `dev`). Create `.env` in each from `.env.example`:
   - `NODE_ENV=production`, `PORT=3060` (prod) / `3061` (staging)
   - `DATABASE_URL` = `boogbe_app` URL, `DATABASE_MIGRATE_URL` = `boogbe_migrator` URL (db `boogbe` / `boogbe_staging`)
   - `BETTER_AUTH_SECRET` = `openssl rand -base64 48` (the `.env.example` placeholder is refused in production)
   - `BETTER_AUTH_URL=https://api.boogbe.com` / `https://staging-api.boogbe.com` — the **API** origin: password-reset and other auth links are built from it, and Cloudflare Pages cannot serve `/v1/auth/*`
   - `APP_ORIGIN=https://app.boogbe.com` / `https://staging-app.boogbe.com`, `COOKIE_DOMAIN=.boogbe.com`
   - `API_PUBLIC_ORIGIN=https://api.boogbe.com` / `https://staging-api.boogbe.com` — origin of the iCal export links given to Airbnb/Booking.com; must be `https` with no path (refused otherwise in production). Changing it later breaks every link already pasted into a channel (D-025: never change after go-live; if it must change, keep the old host serving `/v1/ical/*` too).
   - `RESEND_API_KEY`, `MAIL_FROM`, `SENTRY_DSN`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
4. nginx:
   - Cloudflare Origin Certificate for `*.boogbe.com` at `/etc/ssl/cloudflare/boogbe-origin.{pem,key}`.
   - `sudo cp deploy/nginx/cloudflare-realip.conf /etc/nginx/conf.d/` (http level; makes `$remote_addr` the visitor so rate limits work).
   - `sudo cp deploy/nginx/boogbe-api.conf /etc/nginx/sites-enabled/` → `sudo nginx -t && sudo systemctl reload nginx`.
   - Firewall: 443 open to Cloudflare IPs only. Refresh the real-IP list monthly (root crontab): `0 4 1 * * /home/boogbe/app/deploy/nginx/update-cloudflare-ips.sh`.
5. First deploy: `bash deploy/deploy.sh staging` (in `/home/boogbe/staging`) then `bash deploy/deploy.sh prod` (in `/home/boogbe/app`). Then `pm2 startup` + `pm2 save`.
6. Platform admin: add your email to `PLATFORM_ADMIN_EMAILS` in `.env`, then `pnpm --filter @boogbe/api create-platform-admin -- you@edgdmedia.com "Your Name" '<password>'`.
7. Backups (crontab -e as boogbe): `30 1 * * * /home/boogbe/app/deploy/backup.sh prod >> /home/boogbe/app/logs/backup.log 2>&1` (01:30 UTC = 02:30 Lagos).

## Deploys
- **Production only (launch, 2026-10-15).** A push to `main` runs `Deploy API` (SSH → `deploy.sh prod`) and `Deploy App` (Pages, `VITE_API_ORIGIN=https://api.boogbe.com`). "Run workflow" re-deploys `main`; any other branch is refused. CI runs on PRs only, so `main` is gated by AGENTS rule 6 (rebase + full local gate before merging). First-time setup: `docs/GO-LIVE.md`.
- Staging (`dev` → `staging-api`/`staging-app`) is not set up yet; it comes back with its own trigger and nginx server block.
- `deploy/deploy.sh` builds the API **with its workspace dependencies** (`pnpm --filter "@boogbe/api..." build`): the compiled API requires `packages/shared/dist`.
- Every deploy takes a `pg_dump` first (`~/backups/boogbe-<instance>/pre-deploy-*.dump`, 14 days) and aborts if it fails.

## Cloudflare
- DNS: `app` → Pages project `boogbe-app` (production branch `main`); `staging-app` → Pages branch alias `dev`; `api`, `staging-api` → VPS IP, proxied.
- SSL mode: Full (strict).

## GitHub secrets
`PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_KEY`, `CF_API_TOKEN` (Pages:Edit), `CF_ACCOUNT_ID`.

## Restore drill (monthly; record date + duration in this file)
1. `aws s3 ls s3://$R2_BUCKET/backups/prod/ --recursive --endpoint-url $R2_ENDPOINT | tail -1`
2. Download, then `createdb -O boogbe_migrator boogbe_restore_test && pg_restore --no-owner -d boogbe_restore_test <file>`
3. Check: `select count(*) from booking; select max(created_at) from audit_log;`
4. `dropdb boogbe_restore_test`.

| Date | Backup used | Duration | Result | By |
|---|---|---|---|---|

## Rollback
- Code: `git -C /home/boogbe/app reset --hard <previous sha> && bash deploy/deploy.sh prod` — note `deploy.sh` resets to `origin/<branch>`, so for a pinned rollback revert the commit on `main` instead. Migrations are forward-only; never roll back a migration — write a new one.
- Data: restore the latest `pre-deploy-*.dump` with `pg_restore --clean --if-exists --no-owner -d boogbe`.

## Production E2E (smoke test after a deploy)
Runs E2E-01…04 and the sign-in checks against https://app.boogbe.com, desktop only. It creates throwaway operators named `e2e-<run>-…`, **never resets anything**, and the invitation emails go to `E2E_INVITE_EMAIL` with a `+<slug>` tag. Then the operators are purged.
```sh
RUN=$(date +%y%m%d%H%M)
E2E_BASE_URL=https://app.boogbe.com E2E_RUN_ID=$RUN \
E2E_ADMIN_EMAIL=edgdmedia@gmail.com E2E_ADMIN_PASSWORD='<platform admin password>' E2E_INVITE_EMAIL=edgdmedia@gmail.com \
  pnpm test:e2e
# on the server, in /home/boogbe/app:
pnpm --filter @boogbe/api exec tsx scripts/purge-e2e-operators.ts "e2e-$RUN-"         # dry run: lists operators + users
pnpm --filter @boogbe/api exec tsx scripts/purge-e2e-operators.ts "e2e-$RUN-" --yes   # deletes them (and their own users; never a platform admin)
```
The purge refuses any prefix that doesn't start with `e2e-`. It runs as `boogbe_migrator`, because payments and audit rows are append-only for the app role.
