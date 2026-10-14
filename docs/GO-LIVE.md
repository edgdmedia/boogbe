# Go-live: production (Tanuhomes), 2026-10-15

Production only. Staging comes later. Run the commands in order, and check each step before moving on. Secrets are **never** pasted into this repo, a chat, a PR or a shell history file. Generate them on the server, or paste them from the provider's dashboard straight into `.env`.

Hosts: `api.boogbe.com` (VPS `server.edgdmedia.com`, user `boogbe`, PM2 on 127.0.0.1:3060) and `app.boogbe.com` (Cloudflare Pages project `boogbe-app`, branch `main`).

## 0. What the owner provides

| Item | Used for |
|---|---|
| SSH to `server.edgdmedia.com` with sudo (and the deploy key for GitHub Actions) | server setup, `PROD_SSH_*` secrets |
| Cloudflare: account ID, API token (Pages:Edit + DNS:Edit for boogbe.com), Origin Certificate for `*.boogbe.com` | DNS, Pages, TLS |
| Cloudflare R2: bucket (e.g. `boogbe-prod`), S3 endpoint, access key ID and secret | uploads and nightly backups (production refuses to start without R2) |
| Resend: API key, with domain `mail.boogbe.com` verified (SPF/DKIM/DMARC records in Cloudflare DNS) | emails (invites, password reset). Without it the API uses the in-memory mailer and sends nothing |
| Confirmation that `apps/api/scripts/data/tanuhomes.json` (rates, capacity, addresses) is correct | seeding |

## 1. Release `main`

`deploy.sh prod` deploys `origin/main`, so `main` must hold the release first.
1. The release PR `dev → main` is opened at the cut-off. It needs approval plus the full local gate (AGENTS rule 6).
2. Merging it triggers the Deploy workflows. Until step 9 sets the secrets, those runs fail at SSH. That's harmless, and expected.

## 2. Server packages (once, with sudo)

First check what the VPS already runs: another site may share nginx or Postgres. These steps only **add** to the server.
```sh
sudo nginx -v; psql --version; node -v 2>/dev/null; ls /etc/nginx/conf.d /etc/nginx/sites-enabled
grep -rn "real_ip_header" /etc/nginx/ || true   # if another conf already sets it, merge cloudflare-realip.conf into that file instead of adding a second one (duplicate directive = nginx -t error)
sudo adduser --disabled-password --gecos "" boogbe   # skip if it exists
sudo apt-get update && sudo apt-get install -y postgresql-16 nginx awscli git   # skip what is installed
sudo -iu boogbe bash -lc 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && . ~/.nvm/nvm.sh && nvm install 22 && npm i -g pnpm@9 pm2'
```

## 3. Postgres (prod database only)

Generate the two passwords on the server and keep them only in step 5's `.env`:
```sh
MIGRATOR_PW=$(openssl rand -base64 30 | tr -d '/+=') ; APP_PW=$(openssl rand -base64 30 | tr -d '/+=')
sudo -u postgres psql -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE boogbe_migrator LOGIN PASSWORD '$MIGRATOR_PW' CREATEDB BYPASSRLS" \
  -c "CREATE ROLE boogbe_app LOGIN PASSWORD '$APP_PW' NOBYPASSRLS NOSUPERUSER" \
  -c "CREATE DATABASE boogbe OWNER boogbe_migrator"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d boogbe \
  -c "CREATE EXTENSION IF NOT EXISTS btree_gist" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm" -c "CREATE EXTENSION IF NOT EXISTS citext" \
  -c "GRANT CONNECT ON DATABASE boogbe TO boogbe_app"
```
Check: `sudo -u postgres psql -d boogbe -c '\du boogbe_*'` shows both roles, and `boogbe_app` has no BYPASSRLS. Don't run `deploy/sql/roles.sql` here; its passwords are for local and CI only.

## 4. Code

```sh
sudo -iu boogbe bash -lc 'git clone --branch main https://github.com/edgdmedia/boogbe.git /home/boogbe/app && mkdir -p /home/boogbe/app/logs'
```

## 5. `.env` (prod), with permissions `600`

In the same shell as step 3, so `$MIGRATOR_PW` and `$APP_PW` are still set. Replace each `<…>` by pasting from the provider:
```sh
AUTH_SECRET=$(openssl rand -base64 48)
sudo -iu boogbe tee /home/boogbe/app/.env > /dev/null <<EOF
NODE_ENV=production
PORT=3060
DATABASE_URL=postgresql://boogbe_app:${APP_PW}@localhost:5432/boogbe
DATABASE_MIGRATE_URL=postgresql://boogbe_migrator:${MIGRATOR_PW}@localhost:5432/boogbe
BETTER_AUTH_SECRET=${AUTH_SECRET}
BETTER_AUTH_URL=https://api.boogbe.com
APP_ORIGIN=https://app.boogbe.com
COOKIE_DOMAIN=.boogbe.com
API_PUBLIC_ORIGIN=https://api.boogbe.com
PLATFORM_ADMIN_EMAILS=edgdmedia@gmail.com
MAIL_FROM=Boogbe <bookings@mail.boogbe.com>
RESEND_API_KEY=<resend key>
R2_ENDPOINT=<https://ACCOUNT.r2.cloudflarestorage.com>
R2_BUCKET=<boogbe-prod>
R2_ACCESS_KEY_ID=<r2 key id>
R2_SECRET_ACCESS_KEY=<r2 secret>
SENTRY_DSN=
EOF
sudo chmod 600 /home/boogbe/app/.env && sudo chown boogbe: /home/boogbe/app/.env
unset MIGRATOR_PW APP_PW AUTH_SECRET
```
`API_PUBLIC_ORIGIN` is permanent (D-025): every iCal export link pasted into Airbnb or Booking.com is built from it. The API refuses to start in production if `API_PUBLIC_ORIGIN` isn't an https origin, if `BETTER_AUTH_SECRET` is the placeholder, or if R2 is missing.

## 6. nginx and TLS (Cloudflare Origin Certificate, SSL mode Full (strict))

```sh
sudo install -d -m 755 /etc/ssl/cloudflare
sudo tee /etc/ssl/cloudflare/boogbe-origin.pem > /dev/null   # paste the origin certificate, Ctrl-D
sudo tee /etc/ssl/cloudflare/boogbe-origin.key > /dev/null   # paste the private key, Ctrl-D
sudo chmod 600 /etc/ssl/cloudflare/boogbe-origin.key
cd /home/boogbe/app
sudo cp deploy/nginx/cloudflare-realip.conf deploy/nginx/boogbe-logging.conf /etc/nginx/conf.d/   # see step 2 about real_ip_header
sudo cp deploy/nginx/boogbe-api.conf /etc/nginx/sites-enabled/boogbe-api.conf
sudo nginx -t && sudo systemctl reload nginx
(sudo crontab -l 2>/dev/null; echo '0 4 1 * * /home/boogbe/app/deploy/nginx/update-cloudflare-ips.sh') | sudo crontab -
```
Firewall: 443 open to Cloudflare IPs only (ufw or the provider's firewall).

The calendar-token masking (`boogbe-logging.conf`) was tested in an nginx 1.26 container. `nginx -t` passed, and `/v1/ical/<token>.ics` was logged as `/v1/ical/***.ics` (with any query string kept), with 0 occurrences of the token.

## 7. Cloudflare

- DNS: `api` → A record to the VPS IP, **proxied**. `app` → custom domain on Pages project `boogbe-app`, production branch `main`.
- SSL/TLS mode **Full (strict)**.
- Pages project: create `boogbe-app` once with `npx wrangler@3 pages project create boogbe-app --production-branch main`, or in the dashboard.

## 8. First deploy (on the server, as `boogbe`)

```sh
sudo -iu boogbe bash -lc 'cd /home/boogbe/app && bash deploy/deploy.sh prod && pm2 save'
sudo -iu boogbe bash -lc 'pm2 startup systemd'   # prints one "sudo env PATH=… pm2 startup …" line: run exactly that line
```
`deploy.sh` does the following:
1. pulls `main`;
2. installs and builds;
3. takes a **pg_dump first**, and aborts if it fails;
4. runs `prisma migrate deploy`;
5. reloads `boogbe-prod-api` and `boogbe-prod-worker`;
6. waits for `/v1/health`.

Check: `pm2 ls` shows both processes online. Running `curl -s https://api.boogbe.com/v1/health` from your machine returns `{"ok":true,"db":true}`.

## 9. GitHub: secrets, then deploy the app

```sh
gh secret set PROD_SSH_HOST --body server.edgdmedia.com
gh secret set PROD_SSH_USER --body boogbe
gh secret set PROD_SSH_KEY < path/to/deploy_key        # private key whose public half is in /home/boogbe/.ssh/authorized_keys
gh secret set CF_API_TOKEN                              # paste when prompted
gh secret set CF_ACCOUNT_ID --body <account id>
gh workflow run "Deploy App" --ref main && gh workflow run "Deploy API" --ref main
```
Check: https://app.boogbe.com loads the sign-in page, and both workflow runs are green.

## 10. Nightly backup to R2 (01:30 UTC = 02:30 Lagos)

```sh
sudo -iu boogbe bash -lc '(crontab -l 2>/dev/null; echo "30 1 * * * /home/boogbe/app/deploy/backup.sh prod >> /home/boogbe/app/logs/backup.log 2>&1") | crontab -'
sudo -iu boogbe bash -lc '/home/boogbe/app/deploy/backup.sh prod'    # run once now: prints "backup ok: backups/prod/…"
```
Then within the first week, do the restore drill in `docs/RUNBOOK.md` and record it there.

## 11. Masking check on the live server

```sh
curl -s -o /dev/null https://api.boogbe.com/v1/ical/NOT-A-REAL-TOKEN-123.ics
sudo grep -c 'NOT-A-REAL-TOKEN' /var/log/nginx/boogbe-api.access.log   # must print 0
sudo tail -1 /var/log/nginx/boogbe-api.access.log                        # shows /v1/ical/***.ics
```

## 12. Owner account, Tanuhomes, seed

```sh
cd /home/boogbe/app
read -rsp 'Password: ' PW && echo && pnpm --filter @boogbe/api create-platform-admin -- edgdmedia@gmail.com "<Your name>" "$PW"; unset PW   # never on the command line or in history
```
1. Sign in at https://app.boogbe.com, go to **Platform**, then **New operator**: "Tanuhomes", slug `tanuhomes`.
2. Invite `edgdmedia@gmail.com` as admin and accept the emailed link.
3. Copy the operator id from the Platform page URL, then on the server run:

```sh
cd /home/boogbe/app && pnpm --filter @boogbe/api exec tsx scripts/seed-tanuhomes.ts <tanuhomes org id>
```

## 13. Smoke test against production (E2E-01…04), then clean up

These run against https://app.boogbe.com with a **throwaway** operator. They never reset or touch any other data. The operator is then deleted (see `docs/RUNBOOK.md`, "Production E2E").

## Rollback

See `docs/RUNBOOK.md`, "Rollback". Migrations are forward-only. Every deploy leaves a `pre-deploy-*.dump` in `~/backups/boogbe-prod/`.
