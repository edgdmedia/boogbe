# Boogbe Runbook

## One-time VPS setup (edgdmedia VPS)
1. `sudo adduser boogbe`; install Node 22 (nvm), pnpm 9, PM2 (`npm i -g pm2`), PostgreSQL 16, nginx, and the AWS CLI from apt (`sudo apt-get install -y awscli`; `backup.sh` needs only `s3 cp`, `s3 rm` and `s3api list-objects-v2`).
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
4. nginx. The edgdmedia VPS is a **shared Webmin/Virtualmin server**: other sites share this nginx, so boogbe's settings stay inside its own server block.
   - Cloudflare Origin Certificate for `*.boogbe.com` at `/etc/ssl/cloudflare/boogbe-origin.{pem,key}`.
   - Site file: `/etc/nginx/sites-available/api.boogbe.com.conf` (based on `deploy/nginx/boogbe-api.conf`), symlinked into `sites-enabled/`. It listens on the server's addresses, `169.58.2.239:443` and the IPv6 address, like the Virtualmin sites. A bare `listen 443` loses to their address-specific listeners.
   - Real IP: `/etc/nginx/snippets/boogbe-cf-realip.conf` (`set_real_ip_from` Cloudflare ranges + `real_ip_header CF-Connecting-IP`), `include`d in the `api.boogbe.com` server block. It makes `$remote_addr` the visitor, so rate limits work. Never install `cloudflare-realip.conf` in `conf.d/` here: that applies it to every site.
   - `deploy/nginx/boogbe-logging.conf` in `/etc/nginx/conf.d/` (iCal token masking). Then `sudo nginx -t && sudo systemctl reload nginx`.
   - Firewall: 443 open to Cloudflare IPs only. Refresh the real-IP list monthly (root crontab): `0 4 1 * * /home/boogbe/app/deploy/nginx/update-cloudflare-ips.sh /etc/nginx/snippets/boogbe-cf-realip.conf`. Always pass the path: without it the script writes `conf.d/cloudflare-realip.conf`.
5. First deploy: `bash deploy/deploy.sh staging` (in `/home/boogbe/staging`) then `bash deploy/deploy.sh prod` (in `/home/boogbe/app`). Then `pm2 startup` + `pm2 save`.
6. Platform admin: add your email to `PLATFORM_ADMIN_EMAILS` in `.env`, then `pnpm --filter @boogbe/api create-platform-admin you@edgdmedia.com "Your Name" -` (reads the password from stdin; see `docs/GO-LIVE.md` step 12).
7. Backups (crontab -e as boogbe): `30 1 * * * /home/boogbe/app/deploy/backup.sh prod >> /home/boogbe/app/logs/backup.log 2>&1` (01:30 UTC = 02:30 Lagos).

## Deploys
- **Production only, and manual.** The GitHub `Deploy API` and `Deploy App` workflows are **disabled** (owner decision, after Release 1 went live on 2026-10-14). A push to `main` deploys nothing. CI runs on PRs only, so `main` is gated by AGENTS rule 6 (rebase + full local gate before merging). First-time setup: `docs/GO-LIVE.md`.
- Deploy in this order, after the release is merged into `main`:
  1. **API, on the server** (as `boogbe`, in `/home/boogbe/app`; `B` is the helper from `docs/GO-LIVE.md` step 2): `B bash deploy/deploy.sh prod`. It pulls `origin/main`, builds, takes a pg_dump, migrates, reloads PM2 and waits for `/v1/health`. Then check `https://api.boogbe.com/v1/health`.
  2. **App, on your machine**, from a clean `main` checkout:
     ```sh
     git checkout main && git pull --ff-only && pnpm install --frozen-lockfile
     VITE_API_ORIGIN=https://api.boogbe.com pnpm --filter "@boogbe/app..." build
     CLOUDFLARE_ACCOUNT_ID=af273e5d58efe45fa36724c5a3e61052 npx wrangler@3 pages deploy apps/app/dist --project-name boogbe-app --branch main
     ```
     That's the EDGD Media Cloudflare account, project `boogbe-app`. Run `npx wrangler@3 login` once per machine. The API goes first because a new app build may call routes or migrations that only the new API has.
- Staging (`dev` → `staging-api`/`staging-app`) is not set up yet; it comes back with its own trigger and nginx server block.
- `deploy/deploy.sh` builds the API **with its workspace dependencies** (`pnpm --filter "@boogbe/api..." build`): the compiled API requires `packages/shared/dist`.
- Every deploy takes a `pg_dump` first (`~/backups/boogbe-<instance>/pre-deploy-*.dump`, 14 days) and aborts if it fails.

## Cloudflare
- DNS: `app` → Pages project `boogbe-app` (production branch `main`); `staging-app` → Pages branch alias `dev`; `api`, `staging-api` → VPS IP, proxied.
- SSL mode: Full (strict).

## Turning GitHub deploys back on
Only when the owner decides to. The workflows need these secrets: `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_KEY` (a deploy key for `boogbe`, with SSH reachable from GitHub runners), `CF_API_TOKEN` (Pages:Edit), and `CF_ACCOUNT_ID` (`af273e5d58efe45fa36724c5a3e61052`). Then run `gh workflow enable "Deploy API"` and `gh workflow enable "Deploy App"`. Once enabled, every push to `main` deploys.

## Website booking (WB) rollout and settings
Guests request dates on an operator's own website (Tanuhomes first) through `/v1/public/:slug/*`. What must line up:
- **API `.env`:** `TURNSTILE_SECRET_KEY`. Without it every request is refused (fails closed). Production refuses Cloudflare's dummy test secrets (`1x…AA`, `2x…AA`, `3x…AA`) at startup. Use the always-pass pair (site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`) only locally or on staging. Restart PM2 after changing it.
- **Cloudflare Turnstile widget** (Cloudflare dashboard → Turnstile, "Managed" mode): list **both** hostnames, `tanuhomes.com` and `www.tanuhomes.com`, plus any preview or staging host that will use the real site key. The site key goes into the Tanuhomes build as `PUBLIC_TURNSTILE_SITE_KEY`, and the secret into the API `.env`.
- **Boogbe app → Settings → Online booking** (admin):
  - **Website address** `https://tanuhomes.com`. Its `www.` twin is added automatically.
  - **Every other site that shows the form must be listed in "Other sites that can show the booking form".** That includes a staging or preview copy of the Tanuhomes site, and `http://localhost:4321` while testing locally. The list drives CORS (the browser's request is refused otherwise). With a real Turnstile secret, the API also refuses a challenge solved on a host that isn't listed. The dummy test secrets skip that hostname check.
  - Turn on "Accept booking requests from your website", set the hold minutes and the extra notify emails, and tick **Show on website** on each unit to offer. An unlisted unit is invisible to the public API.
- **Tanuhomes site build:** `PUBLIC_BOOGBE_API` (default `https://api.boogbe.com`), `PUBLIC_BOOGBE_SLUG` (default `tanuhomes`), `PUBLIC_TURNSTILE_SITE_KEY`. A property shows the widget only when its JSON has `boogbe.units` (`[{ "label", "unitId" }]`) **and** the site key is set. Otherwise it keeps the rate card.
- **Emails** go through the outbox (`outbound_message`), so a mail outage never fails a request. Check that table first when an email seems missing.

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
# on your machine, in the repo:
RUN=$(date +%y%m%d%H%M); echo "run id: $RUN"   # note it: the server needs it below
read -rsp 'Platform admin password: ' E2E_ADMIN_PASSWORD && echo && export E2E_ADMIN_PASSWORD
E2E_BASE_URL=https://app.boogbe.com E2E_RUN_ID=$RUN E2E_ADMIN_EMAIL=edgdmedia@gmail.com E2E_INVITE_EMAIL=edgdmedia@gmail.com \
  pnpm test:e2e; unset E2E_ADMIN_PASSWORD
# on the server (B is the helper from docs/GO-LIVE.md step 2), with the run id from above:
RUN=<run id>
B pnpm --filter @boogbe/api exec tsx scripts/purge-e2e-operators.ts "e2e-$RUN-"         # dry run: lists operators + users
B pnpm --filter @boogbe/api exec tsx scripts/purge-e2e-operators.ts "e2e-$RUN-" --yes   # deletes them (and their own users; never a platform admin)
```
The purge refuses any prefix that isn't exactly `e2e-<run>-…`, so one run's prefix can't match another run's operators. Files a test operator uploaded to R2 (receipts) stay behind; they are a few KB, under `org/<org id>/`. It runs as `boogbe_migrator`, because payments and audit rows are append-only for the app role.
