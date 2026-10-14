# Go-live: production (Tanuhomes), 2026-10-15

Production only. Staging comes later. Run the commands in order, and check each step before moving on. Secrets are **never** pasted into this repo, a chat, a PR or a shell history file. Generate them on the server, or paste them from the provider's dashboard straight into `.env`.

Hosts: `api.boogbe.com` (VPS `server.edgdmedia.com`, user `boogbe`, PM2 on 127.0.0.1:3060) and `app.boogbe.com` (Cloudflare Pages project `boogbe-app`, branch `main`, EDGD Media account `af273e5d58efe45fa36724c5a3e61052`).

**Release 1 went live on 2026-10-14.** What was actually done differs from the original plan in three places, and this file now records what was done:
- **Deploys are manual.** The GitHub "Deploy API" and "Deploy App" workflows are disabled (owner decision). See step 8 for the API and step 9 for the app, and `docs/RUNBOOK.md`, "Deploys", for every deploy after the first.
- **The VPS is a shared Webmin/Virtualmin server**, so nginx follows that server's layout (step 6).
- **AWS CLI comes from apt** (step 2).

## 0. What the owner provides

| Item | Used for |
|---|---|
| SSH to `server.edgdmedia.com` with sudo, and SSH (22) reachable from GitHub Actions runners (not Cloudflare-only like 443) | server setup, `PROD_SSH_*` secrets |
| Cloudflare: account ID, API token (Pages:Edit + DNS:Edit for boogbe.com), Origin Certificate for `*.boogbe.com` | DNS, Pages, TLS |
| Cloudflare R2: bucket (e.g. `boogbe-prod`), S3 endpoint, access key ID and secret | uploads and nightly backups (production refuses to start without R2) |
| Resend: API key, with domain `mail.boogbe.com` verified (SPF/DKIM/DMARC records in Cloudflare DNS) | emails (invites, password reset). Without it the API uses the in-memory mailer and sends nothing |
| Confirmation that `apps/api/scripts/data/tanuhomes.json` (rates, capacity, addresses) is correct | seeding |

## 1. Release `main`

`deploy.sh prod` deploys `origin/main`, so `main` must hold the release first.
1. The release PR `dev → main` is opened at the cut-off. It needs approval plus the full local gate (AGENTS rule 6).
2. Merging it deploys nothing: the Deploy workflows are disabled. Deploy by hand (steps 8 and 9).

## 2. Server packages (once, with sudo)

First check what the VPS already runs: another site may share nginx or Postgres. These steps only **add** to the server.
```sh
sudo nginx -v; psql --version; node -v 2>/dev/null; ls /etc/nginx/conf.d /etc/nginx/sites-enabled
grep -rn "real_ip_header" /etc/nginx/ || true   # on a shared server keep boogbe's real-IP settings inside its own server block (step 6), never http-wide
sudo adduser --disabled-password --gecos "" boogbe   # skip if it exists
sudo apt-get update && sudo apt-get install -y nginx git unzip   # skip what is installed
# PostgreSQL 16: in Ubuntu 24.04's own repo; on 22.04 add the PGDG repo first (sudo apt-get install -y postgresql-common && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh)
sudo apt-get install -y postgresql-16
# AWS CLI from apt (backup.sh uploads to R2 with it). It only needs `s3 cp`, `s3 rm` and `s3api list-objects-v2`, which apt's version has.
# If apt has no "awscli" package (Ubuntu 24.04), install v2 from https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip instead.
sudo apt-get install -y awscli && aws --version
# Node 22 + pnpm + pm2 for the boogbe user only (other sites on the VPS keep their own Node)
sudo -iu boogbe bash -c 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && . ~/.nvm/nvm.sh && nvm install 22 && npm i -g pnpm@9 pm2'
```

nvm is not loaded by non-interactive shells, so every later command that needs node, pnpm or pm2 goes through this helper. Define it once in your sudo shell; it runs a command as `boogbe` in `/home/boogbe/app` with nvm loaded (`deploy.sh` loads nvm itself, so it also runs from a plain `boogbe` login shell):
```sh
B() { sudo -iu boogbe bash -c '. ~/.nvm/nvm.sh >/dev/null && cd /home/boogbe/app && "$@"' _ "$@"; }
```

The GitHub Actions deploy key isn't needed while deploys are manual. If the Deploy workflows are turned back on, set it up then (see `docs/RUNBOOK.md`, "Turning GitHub deploys back on").

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

In the same shell as step 3, so `$MIGRATOR_PW` and `$APP_PW` are still set. Run the block **exactly as written**: the `<…>` placeholders stay in the command, so no provider key ever enters shell history. The editor afterwards is where you paste them.
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
sudo -iu boogbe nano /home/boogbe/app/.env   # paste the Resend and R2 values over the <…> placeholders
sudo grep -n '=<' /home/boogbe/app/.env      # must print nothing (no placeholder left)
```
`API_PUBLIC_ORIGIN` is permanent (D-025): every iCal export link pasted into Airbnb or Booking.com is built from it. The API refuses to start in production if `API_PUBLIC_ORIGIN` isn't an https origin, if `BETTER_AUTH_SECRET` is the placeholder, or if R2 is missing.

## 6. nginx and TLS (Cloudflare Origin Certificate, SSL mode Full (strict))

```sh
sudo install -d -m 755 /etc/ssl/cloudflare
sudo tee /etc/ssl/cloudflare/boogbe-origin.pem > /dev/null   # paste the origin certificate, Ctrl-D
sudo tee /etc/ssl/cloudflare/boogbe-origin.key > /dev/null   # paste the private key, Ctrl-D
sudo chmod 600 /etc/ssl/cloudflare/boogbe-origin.key
A=/home/boogbe/app/deploy/nginx
sudo cp $A/boogbe-logging.conf /etc/nginx/conf.d/
```

**Shared Webmin/Virtualmin server.** The repo's `boogbe-api.conf` and `cloudflare-realip.conf` are templates. On this server they are installed like this:
- **Site file:** `/etc/nginx/sites-available/api.boogbe.com.conf`, enabled with a symlink in `sites-enabled/`. It is based on `boogbe-api.conf`.
- **Listen on the server's own addresses**, as the Virtualmin sites do: `listen 169.58.2.239:443 ssl http2;` and `listen [<server IPv6>]:443 ssl http2;`. A bare `listen 443` loses to the other sites' address-specific listeners, so their default site answers for `api.boogbe.com`.
- **Real IP is per site, not http-wide:** the Cloudflare `set_real_ip_from` list and `real_ip_header CF-Connecting-IP` live in `/etc/nginx/snippets/boogbe-cf-realip.conf`, which is `include`d inside the `api.boogbe.com` server block. Don't put `cloudflare-realip.conf` in `conf.d/`: it would apply to every site on the box.
- Leave the other sites' files alone. Check with `sudo nginx -t` before every reload.

```sh
sudo nginx -t && sudo systemctl reload nginx
# monthly refresh of the real-IP list: pass the snippet path, or the script writes conf.d/cloudflare-realip.conf
(sudo crontab -l 2>/dev/null; echo '0 4 1 * * /home/boogbe/app/deploy/nginx/update-cloudflare-ips.sh /etc/nginx/snippets/boogbe-cf-realip.conf') | sudo crontab -
```
Firewall: 443 open to Cloudflare IPs only (ufw or the provider's firewall).

The calendar-token masking (`boogbe-logging.conf`) logs everything after `/v1/ical/` as `***` (any case, any suffix, query string kept); step 11 checks it on the live server. The error log is at `crit`, because nginx's upstream errors (a 502 while PM2 reloads) write the full request line, token included.

## 7. Cloudflare

- DNS: `api` → A record to the VPS IP, **proxied**. `app` → custom domain on Pages project `boogbe-app`, production branch `main`.
- SSL/TLS mode **Full (strict)**.
- Pages project: create `boogbe-app` once with `npx wrangler@3 pages project create boogbe-app --production-branch main`, or in the dashboard.

## 8. First deploy (on the server, as `boogbe`)

```sh
B bash deploy/deploy.sh prod && B pm2 save
B pm2 startup systemd   # prints one "sudo env PATH=… pm2 startup …" line: run exactly that line
```
`deploy.sh` does the following:
1. pulls `main`;
2. installs and builds;
3. takes a **pg_dump first**, and aborts if it fails;
4. runs `prisma migrate deploy`;
5. reloads `boogbe-prod-api` and `boogbe-prod-worker`;
6. waits for `/v1/health`.

Check: `pm2 ls` shows both processes online. Running `curl -s https://api.boogbe.com/v1/health` from your machine returns `{"ok":true,"db":true}`.

## 9. Deploy the app (on your machine)

Built locally and uploaded with wrangler to the EDGD Media Cloudflare account. These are the same steps the disabled "Deploy App" workflow ran:
```sh
git checkout main && git pull --ff-only && pnpm install --frozen-lockfile
VITE_API_ORIGIN=https://api.boogbe.com pnpm --filter "@boogbe/app..." build
npx wrangler@3 login   # once per machine; sign in to the EDGD Media account
CLOUDFLARE_ACCOUNT_ID=af273e5d58efe45fa36724c5a3e61052 npx wrangler@3 pages deploy apps/app/dist --project-name boogbe-app --branch main
```
Check: https://app.boogbe.com loads the sign-in page. `VITE_API_ORIGIN` is baked in at build time, so a build without it points the app at the wrong API.

## 10. Nightly backup to R2 (01:30 UTC = 02:30 Lagos)

```sh
sudo -iu boogbe bash -c '(crontab -l 2>/dev/null; echo "30 1 * * * /home/boogbe/app/deploy/backup.sh prod >> /home/boogbe/app/logs/backup.log 2>&1") | crontab -'
B bash deploy/backup.sh prod    # run once now: prints "backup ok: backups/prod/…" (needs only pg_dump and aws, both on cron's PATH)
```
Then within the first week, do the restore drill in `docs/RUNBOOK.md` and record it there.

## 11. Masking check on the live server

```sh
curl -s -o /dev/null https://api.boogbe.com/v1/ical/NOT-A-REAL-TOKEN-123.ics
sudo grep -c 'NOT-A-REAL-TOKEN' /var/log/nginx/boogbe-api.access.log   # must print 0
sudo tail -1 /var/log/nginx/boogbe-api.access.log                        # shows /v1/ical/***
```

## 12. Owner account, Tanuhomes, seed

```sh
read -rsp 'Password: ' PW && echo && printf '%s' "$PW" | B pnpm --filter @boogbe/api create-platform-admin edgdmedia@gmail.com "<Your name>" -; unset PW   # "-" reads it from stdin: never in history or ps
```
No `--` before the email. pnpm passes it on to the script as a literal argument; scripts from before POSTLAUNCH-1 then took `--` as the email. The script now ignores a leading `--`.
1. Sign in at https://app.boogbe.com, go to **Platform**, then **New operator**: "Tanuhomes", slug `tanuhomes`.
2. Invite `edgdmedia@gmail.com` as admin and accept the emailed link.
3. Copy the operator id from the Platform page URL, then on the server run:

```sh
B pnpm --filter @boogbe/api exec tsx scripts/seed-tanuhomes.ts <tanuhomes org id>
```

## 13. Smoke test against production (E2E-01…04), then clean up

These run against https://app.boogbe.com with a **throwaway** operator. They never reset or touch any other data. The operator is then deleted (see `docs/RUNBOOK.md`, "Production E2E").

## Rollback

See `docs/RUNBOOK.md`, "Rollback". Migrations are forward-only. Every deploy leaves a `pre-deploy-*.dump` in `~/backups/boogbe-prod/`.
