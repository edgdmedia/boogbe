# M0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Claim each task in `docs/COORDINATION.md` before starting.

**Goal:** A deployable, empty Boogbe: monorepo, shared domain primitives, Postgres with RLS, NestJS API with Better Auth (operators, members, invitations, roles), platform admin, React app shell, CI and deployment to staging + production. Exit: E2E-01 passes on staging.

**Architecture:** pnpm monorepo. `apps/api` (NestJS 10 + Prisma 5 + Better Auth) runs as two PM2 processes (api, worker) on the edgdmedia VPS behind nginx/Cloudflare. `apps/app` (React 18 + Vite) on Cloudflare Pages. All tenant data goes through `OrgDb`, which sets `app.org_id` for Postgres RLS and injects `orgId` into Prisma queries.

**Tech Stack:** Node 22, pnpm 9, TypeScript 5 strict, NestJS 10, Prisma 5.22, PostgreSQL 16, better-auth 1.x, zod 4, nestjs-zod 5, React 18, Vite 5, React Router 6, SWR 2, Tailwind 4, Vitest 2, Playwright 1.5x, supertest.

**Spec:** `docs/superpowers/specs/2026-10-09-boogbe-v1-design.md` (+ `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/FRD.md`)

**Agent assignment:** M0 is sequential and owned by **Claude Code** (it creates every shared surface). OpenCode may review PRs.

## Global Constraints

- Package names: `@boogbe/api`, `@boogbe/app`, `@boogbe/shared`, `@boogbe/ui`.
- Node `22.x` (`.nvmrc` = `22`), pnpm `9.x` (`packageManager` field).
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
- API port: production `3060`, staging `3061`. API prefix `/v1`. Better Auth base path `/v1/auth`.
- DB roles: `boogbe_migrator` (owns schema, runs migrations, `BYPASSRLS` — FORCE RLS binds table owners, so without it migrations/backups/test setup would see no rows; never used at runtime), `boogbe_app` (runtime, `NOBYPASSRLS`). Env: `DATABASE_URL` (app role), `DATABASE_MIGRATE_URL` (migrator).
- RLS setting name `app.org_id`; helper SQL function `app_current_org()`.
- Org roles: `admin`, `frontdesk`, `housekeeper`, `landlord`. Platform admin: `user.role = 'admin'`.
- Money: integer kobo. Stay dates: `YYYY-MM-DD`. Default timezone `Africa/Lagos`, currency `NGN`.
- Error envelope: `{ "error": { "code": string, "message": string, "details"?: unknown } }`.
- Commit messages: `<type>(<area>): <summary> [<FRD-IDs>]`.

## Review Focus

1. **Empty/unset org context on a pooled connection** — after a transaction ends, `current_setting('app.org_id', true)` returns `''`, not NULL; policies must treat `''` as "no org" → zero rows (Task 7 test `rls returns zero rows after a previous transaction set org`).
2. **Unique-key update bypassing tenant filter** — `update({ where: { id } })` on a tenant model must still be scoped (Prisma `extendedWhereUnique`) (Task 7 test `update by id cannot touch another org's row`).
3. **Open sign-up** — anyone POSTing `/v1/auth/sign-up/email` without a pending invitation must be refused (Task 5 test `sign-up without invitation is rejected`).
4. **Last admin removed or demoted via Better Auth endpoints directly** (bypassing our API) must be refused (Task 9 test `cannot demote the last admin via better-auth endpoint`).
5. **Suspended operator** — members of a suspended operator get `403 ORG_SUSPENDED` even with a valid session (Task 6 test `suspended org is refused`).

---

## File map (created in this milestone)

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, .nvmrc, .npmrc, eslint.config.mjs, .prettierrc, .env.example
docker-compose.dev.yml
deploy/sql/roles.sql, deploy/sql/db-init.sql
deploy/deploy.sh, deploy/backup.sh, deploy/nginx/boogbe-api.conf, deploy/nginx/cloudflare-realip.conf, deploy/nginx/update-cloudflare-ips.sh
ecosystem.config.js
docs/RUNBOOK.md
.github/workflows/ci.yml, .github/workflows/deploy-api.yml, .github/workflows/deploy-app.yml
prisma/schema.prisma, prisma/migrations/0001_init/migration.sql, prisma/migrations/0002_tenant_base/migration.sql
packages/shared/{package.json,tsconfig.json,vitest.config.ts}
packages/shared/src/index.ts
packages/shared/src/domain/{money,dates}.ts (+ .test.ts)
packages/shared/src/{errors,enums,permissions}.ts (+ permissions.test.ts)
packages/shared/src/contracts/{platform,members,me}.ts
packages/ui/{package.json,tsconfig.json}, packages/ui/src/{index.ts,tokens.css,Button.tsx,Input.tsx,Field.tsx,Card.tsx,Badge.tsx,Spinner.tsx,EmptyState.tsx,Select.tsx}
apps/api/{package.json,tsconfig.json,tsconfig.build.json,nest-cli.json,vitest.config.ts,vitest.int.config.ts}
apps/api/src/{main.ts,worker.ts,app.module.ts,worker.module.ts,build-app.ts,env.ts}
apps/api/src/common/http/{app-error.ts,error.filter.ts,request-id.middleware.ts}
apps/api/src/common/db/{prisma.service.ts,org-scope.extension.ts,org-db.service.ts,tenant-models.ts,db.module.ts}
apps/api/src/common/auth/{auth.ts,auth.module.ts,auth.tokens.ts,request-ctx.ts,decorators.ts,session.guard.ts,lockout.ts,ac.ts,membership-rules.ts}
apps/api/src/common/mail/{mailer.ts,mail.module.ts,templates.ts}
apps/api/src/common/audit/{audit.service.ts,audit.module.ts}
apps/api/src/common/jobs/{job-runner.ts,jobs.module.ts}
apps/api/src/modules/health/health.controller.ts
apps/api/src/modules/platform/{platform.module.ts,platform.controller.ts,platform.service.ts}
apps/api/src/modules/invitations/{invitations.module.ts,invitations.controller.ts}
apps/api/src/modules/org/{org.module.ts,org.controller.ts,org.service.ts}
apps/api/src/{tenant-isolation.spec.ts,route-permissions.spec.ts}
apps/api/test/{global-setup.ts,helpers/app.ts,helpers/db.ts,helpers/users.ts,helpers/routes.ts}
apps/api/test/{health.int.ts,auth.int.ts,rls.int.ts,org-db.int.ts,guards.int.ts,platform.int.ts,members.int.ts,isolation.int.ts,jobs.int.ts}
apps/api/scripts/create-platform-admin.ts
apps/app/{package.json,tsconfig.json,vite.config.ts,index.html,public/_headers,vitest.config.ts}
apps/app/src/{main.tsx,App.tsx,index.css,router.tsx}
apps/app/src/lib/{api.ts,auth-client.ts,format.ts,use-me.ts}
apps/app/src/components/shell/{AppShell.tsx,OrgSwitcher.tsx,RoleLanding.tsx,RequireAuth.tsx}
apps/app/src/routes/auth/{SignIn.tsx,AcceptInvite.tsx,ForgotPassword.tsx,ResetPassword.tsx}
apps/app/src/routes/platform/{OperatorsList.tsx,CreateOperator.tsx,OperatorDetail.tsx}
apps/app/src/routes/settings/{Team.tsx,Sessions.tsx,OrgProfile.tsx}
apps/app/src/routes/{Home.tsx,NotFound.tsx}
playwright.config.ts, e2e/{fixtures.ts,e01-onboard-operator.spec.ts}
```

---

### Task 1 (T-M0-01) [infra]: Monorepo scaffold + shared money module

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`, `.npmrc`, `.prettierrc`, `eslint.config.mjs`, `.env.example`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`, `packages/shared/src/index.ts`, `packages/shared/src/domain/money.ts`
- Test: `packages/shared/src/domain/money.test.ts`

**Interfaces:**
- Produces: `toKobo(naira: number): number`, `formatNaira(kobo: number): string`, `pctOfBps(amountKobo: number, bps: number): number` (half-up), `sumKobo(values: number[]): number`, `assertKobo(n: number): void` — exported from `@boogbe/shared`.

- [ ] **Step 1: Create root files**

`package.json`:
```json
{
  "name": "boogbe",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22 <23" },
  "scripts": {
    "dev": "pnpm --parallel --filter @boogbe/api --filter @boogbe/app run dev",
    "build": "pnpm -r --if-present run build",
    "typecheck": "pnpm -r --if-present run typecheck",
    "lint": "eslint .",
    "test": "pnpm -r --if-present run test",
    "test:int": "pnpm --filter @boogbe/api run test:int",
    "test:e2e": "playwright test",
    "db:up": "docker compose -f docker-compose.dev.yml up -d",
    "db:migrate": "pnpm --filter @boogbe/api run prisma:migrate:dev",
    "db:reset": "pnpm --filter @boogbe/api run prisma:reset"
  },
  "devDependencies": {
    "@eslint/js": "^9.12.0",
    "@playwright/test": "^1.48.0",
    "eslint": "^9.12.0",
    "prettier": "^3.3.3",
    "typescript": "^5.6.3",
    "typescript-eslint": "^8.8.1"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`.nvmrc`: `22`
`.npmrc`: `auto-install-peers=true`
`.prettierrc`: `{ "singleQuote": true, "printWidth": 110, "trailingComma": "all" }`

`eslint.config.mjs`:
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': [
        'error',
        { paths: [{ name: '@prisma/client', importNames: ['PrismaClient'], message: 'Use OrgDb (common/db).' }] },
      ],
    },
  },
  {
    files: ['apps/api/src/common/db/**', 'apps/api/test/**', 'apps/api/scripts/**', 'apps/api/src/common/auth/auth.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
```

`.env.example`:
```
# API
NODE_ENV=development
PORT=3060
DATABASE_URL=postgresql://boogbe_app:app@localhost:5433/boogbe_dev
DATABASE_MIGRATE_URL=postgresql://boogbe_migrator:migrator@localhost:5433/boogbe_dev
TEST_DATABASE_URL=postgresql://boogbe_app:app@localhost:5433/boogbe_test
TEST_DATABASE_MIGRATE_URL=postgresql://boogbe_migrator:migrator@localhost:5433/boogbe_test
BETTER_AUTH_SECRET=change-me-32-chars-minimum-xxxxxxxx
BETTER_AUTH_URL=http://localhost:5173
APP_ORIGIN=http://localhost:5173
COOKIE_DOMAIN=
PLATFORM_ADMIN_EMAILS=
RESEND_API_KEY=
MAIL_FROM=Boogbe <bookings@mail.boogbe.com>
SENTRY_DSN=
BOOGBE_ROLE=api
# App
VITE_API_ORIGIN=
```

- [ ] **Step 2: Create shared package skeleton**

`packages/shared/package.json`:
```json
{
  "name": "@boogbe/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "zod": "^4.1.0" },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^2.1.9" }
}
```
`packages/shared/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`
`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
```

- [ ] **Step 3: Write the failing money test**

`packages/shared/src/domain/money.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { assertKobo, formatNaira, pctOfBps, sumKobo, toKobo } from './money';

describe('money', () => {
  it('converts naira to kobo exactly', () => {
    expect(toKobo(200000)).toBe(20_000_000);
    expect(toKobo(0.1)).toBe(10);
    expect(toKobo(19.99)).toBe(1999);
  });
  it('formats kobo as naira with en-NG grouping', () => {
    expect(formatNaira(20_000_000)).toBe('₦200,000');
    expect(formatNaira(1999)).toBe('₦19.99');
    expect(formatNaira(-50_000)).toBe('-₦500');
    expect(formatNaira(0)).toBe('₦0');
  });
  it('takes a basis-point percentage rounding half up', () => {
    expect(pctOfBps(10_000, 1500)).toBe(1500); // 15% of ₦100
    expect(pctOfBps(333, 5000)).toBe(167); // 166.5 -> 167
    expect(pctOfBps(1, 5000)).toBe(1); // 0.5 -> 1
    expect(pctOfBps(-333, 5000)).toBe(-167); // symmetric for negatives
  });
  it('sums kobo and rejects non-integers', () => {
    expect(sumKobo([1, 2, 3])).toBe(6);
    expect(() => assertKobo(1.5)).toThrow('kobo must be a safe integer');
    expect(() => sumKobo([1, 0.5])).toThrow();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm install && pnpm --filter @boogbe/shared test`
Expected: FAIL — `Failed to resolve import "./money"`.

- [ ] **Step 5: Implement money.ts**

`packages/shared/src/domain/money.ts`:
```ts
export function assertKobo(n: number): void {
  if (!Number.isSafeInteger(n)) throw new Error(`kobo must be a safe integer, got ${n}`);
}

export function toKobo(naira: number): number {
  return Math.round(naira * 100);
}

export function sumKobo(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    assertKobo(v);
    total += v;
  }
  assertKobo(total);
  return total;
}

/** amount × bps / 10000, rounded half away from zero. */
export function pctOfBps(amountKobo: number, bps: number): number {
  assertKobo(amountKobo);
  const raw = (Math.abs(amountKobo) * bps) / 10_000;
  const rounded = Math.floor(raw + 0.5);
  return amountKobo < 0 ? -rounded : rounded;
}

const fmt = new Intl.NumberFormat('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function formatNaira(kobo: number): string {
  assertKobo(kobo);
  const sign = kobo < 0 ? '-' : '';
  return `${sign}₦${fmt.format(Math.abs(kobo) / 100)}`;
}
```
`packages/shared/src/index.ts`:
```ts
export * from './domain/money';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @boogbe/shared test && pnpm typecheck`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**
```bash
git add -A
git commit -m "chore(repo): scaffold pnpm monorepo and shared money helpers"
```

---

### Task 2 (T-M0-02) [domain]: Dates, errors, enums, permissions

**Files:**
- Create: `packages/shared/src/domain/dates.ts`, `packages/shared/src/errors.ts`, `packages/shared/src/enums.ts`, `packages/shared/src/permissions.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/domain/dates.test.ts`, `packages/shared/src/permissions.test.ts`

**Interfaces:**
- Produces (dates): type `IsoDate = string` (`YYYY-MM-DD`); `isIsoDate(s): boolean`; `addDays(d: IsoDate, n: number): IsoDate`; `nightsBetween(checkIn: IsoDate, checkOut: IsoDate): number`; `rangesOverlap(aStart, aEnd, bStart, bEnd): boolean` (half-open); `eachNight(checkIn, checkOut): IsoDate[]`; `todayIn(timeZone: string, now?: Date): IsoDate`; `monthOf(d: IsoDate): IsoDate` (first of month); `zonedTimeToUtc(date: IsoDate, time: 'HH:MM', timeZone: string): Date`.
- Produces (errors): `ERROR_CODES` const array, type `ErrorCode`, `ApiErrorBody` type.
- Produces (enums): `ORG_ROLES = ['admin','frontdesk','housekeeper','landlord'] as const`, `type OrgRole`, `ROLE_LABELS: Record<OrgRole,string>`.
- Produces (permissions): `PERMISSIONS` const array, `type Permission`, `ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]>`, `can(role: OrgRole, p: Permission): boolean`.

- [ ] **Step 1: Write failing tests**

`packages/shared/src/domain/dates.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { addDays, eachNight, isIsoDate, monthOf, nightsBetween, rangesOverlap, todayIn, zonedTimeToUtc } from './dates';

describe('dates', () => {
  it('validates ISO dates strictly', () => {
    expect(isIsoDate('2026-10-09')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-1-09')).toBe(false);
  });
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('counts nights for half-open stays', () => {
    expect(nightsBetween('2026-10-09', '2026-10-12')).toBe(3);
    expect(() => nightsBetween('2026-10-09', '2026-10-09')).toThrow('check-out must be after check-in');
  });
  it('detects overlap with half-open semantics (same-day turnover allowed)', () => {
    expect(rangesOverlap('2026-10-01', '2026-10-05', '2026-10-05', '2026-10-07')).toBe(false);
    expect(rangesOverlap('2026-10-01', '2026-10-05', '2026-10-04', '2026-10-07')).toBe(true);
    expect(rangesOverlap('2026-10-01', '2026-10-10', '2026-10-03', '2026-10-04')).toBe(true);
  });
  it('lists each night of a stay', () => {
    expect(eachNight('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });
  it('computes today in the operator timezone', () => {
    // 23:30 UTC on 9 Oct is 00:30 on 10 Oct in Lagos (UTC+1)
    expect(todayIn('Africa/Lagos', new Date('2026-10-09T23:30:00Z'))).toBe('2026-10-10');
  });
  it('gets first of month', () => {
    expect(monthOf('2026-10-31')).toBe('2026-10-01');
  });
  it('converts a local Lagos time to UTC', () => {
    expect(zonedTimeToUtc('2026-10-09', '14:00', 'Africa/Lagos').toISOString()).toBe('2026-10-09T13:00:00.000Z');
  });
});
```

`packages/shared/src/permissions.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { can, PERMISSIONS, ROLE_PERMISSIONS } from './permissions';
import { ORG_ROLES } from './enums';

describe('permissions', () => {
  it('admin has every permission', () => {
    for (const p of PERMISSIONS) expect(can('admin', p)).toBe(true);
  });
  it('frontdesk can take bookings and payments but not settings, owners or voids', () => {
    expect(can('frontdesk', 'bookings.write')).toBe(true);
    expect(can('frontdesk', 'payments.write')).toBe(true);
    expect(can('frontdesk', 'bookings.override')).toBe(true);
    expect(can('frontdesk', 'org.settings.write')).toBe(false);
    expect(can('frontdesk', 'owners.read')).toBe(false);
    expect(can('frontdesk', 'payments.void')).toBe(false);
    expect(can('frontdesk', 'members.write')).toBe(false);
  });
  it('housekeeper only touches own tasks', () => {
    expect(ROLE_PERMISSIONS.housekeeper).toEqual(['tasks.read_own', 'tasks.write_own', 'notifications.read']);
  });
  it('landlord only reads the portal', () => {
    expect(ROLE_PERMISSIONS.landlord).toEqual(['portal.read', 'notifications.read']);
  });
  it('every role maps only to known permissions', () => {
    for (const r of ORG_ROLES) for (const p of ROLE_PERMISSIONS[r]) expect(PERMISSIONS).toContain(p);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @boogbe/shared test`
Expected: FAIL — cannot resolve `./dates`, `./permissions`.

- [ ] **Step 3: Implement**

`packages/shared/src/domain/dates.ts`:
```ts
export type IsoDate = string;
const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(d: IsoDate): number {
  const m = RE.exec(d);
  if (!m) throw new Error(`invalid date ${d}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(ms).toISOString().slice(0, 10) !== d) throw new Error(`invalid date ${d}`);
  return ms;
}
const fmt = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

export function isIsoDate(s: string): boolean {
  try {
    parse(s);
    return true;
  } catch {
    return false;
  }
}
export function addDays(d: IsoDate, n: number): IsoDate {
  return fmt(parse(d) + n * DAY);
}
export function nightsBetween(checkIn: IsoDate, checkOut: IsoDate): number {
  const n = Math.round((parse(checkOut) - parse(checkIn)) / DAY);
  if (n < 1) throw new Error('check-out must be after check-in');
  return n;
}
export function rangesOverlap(aStart: IsoDate, aEnd: IsoDate, bStart: IsoDate, bEnd: IsoDate): boolean {
  return aStart < bEnd && bStart < aEnd;
}
export function eachNight(checkIn: IsoDate, checkOut: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) out.push(d);
  return out;
}
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function monthOf(d: IsoDate): IsoDate {
  parse(d);
  return `${d.slice(0, 7)}-01`;
}
/** Wall-clock time in `timeZone` on `date` → UTC instant. */
export function zonedTimeToUtc(date: IsoDate, time: string, timeZone: string): Date {
  const [hh, mm] = time.split(':').map(Number);
  const guess = parse(date) + (hh! * 60 + mm!) * 60_000;
  const offset = tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - at.getTime();
}
```

`packages/shared/src/errors.ts`:
```ts
export const ERROR_CODES = [
  'VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
  'ORG_SUSPENDED', 'NO_ACTIVE_ORG', 'LAST_ADMIN', 'DATES_UNAVAILABLE', 'INVALID_TRANSITION',
  'RATE_LIMITED', 'ACCOUNT_LOCKED', 'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown; requestId?: string };
}
```

`packages/shared/src/enums.ts`:
```ts
export const ORG_ROLES = ['admin', 'frontdesk', 'housekeeper', 'landlord'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const ROLE_LABELS: Record<OrgRole, string> = {
  admin: 'Admin',
  frontdesk: 'Front desk',
  housekeeper: 'Housekeeper',
  landlord: 'Property owner',
};
export const ORG_STATUSES = ['active', 'suspended'] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];
```

`packages/shared/src/permissions.ts`:
```ts
import type { OrgRole } from './enums';

export const PERMISSIONS = [
  'org.settings.read', 'org.settings.write', 'members.read', 'members.write',
  'inventory.read', 'inventory.write', 'calendar.read',
  'bookings.read', 'bookings.write', 'bookings.override',
  'guests.read', 'guests.write',
  'payments.read', 'payments.write', 'payments.void',
  'ical.read', 'ical.write',
  'messages.read', 'messages.send', 'templates.write',
  'tasks.read', 'tasks.write', 'tasks.read_own', 'tasks.write_own',
  'owners.read', 'owners.write', 'expenses.read', 'expenses.write',
  'statements.read', 'statements.write',
  'portal.read', 'audit.read', 'notifications.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  admin: PERMISSIONS,
  frontdesk: [
    'org.settings.read', 'inventory.read', 'calendar.read',
    'bookings.read', 'bookings.write', 'bookings.override',
    'guests.read', 'guests.write', 'payments.read', 'payments.write',
    'ical.read', 'messages.read', 'messages.send', 'tasks.read', 'tasks.write', 'notifications.read',
  ],
  housekeeper: ['tasks.read_own', 'tasks.write_own', 'notifications.read'],
  landlord: ['portal.read', 'notifications.read'],
};

export function can(role: OrgRole, p: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(p);
}
```

`packages/shared/src/index.ts`:
```ts
export * from './domain/money';
export * from './domain/dates';
export * from './errors';
export * from './enums';
export * from './permissions';
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @boogbe/shared test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/shared
git commit -m "feat(shared): dates, error codes, roles and permission map [AUTH-09]"
```

---

### Task 3 (T-M0-03) [schema][infra]: Postgres roles, Prisma schema with Better Auth models, base migration

**Files:**
- Create: `docker-compose.dev.yml`, `deploy/sql/roles.sql`, `deploy/sql/db-init.sql`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`, `apps/api/nest-cli.json`
- Create: `prisma/schema.prisma`, `prisma/migrations/0001_init/migration.sql`, `prisma/migrations/migration_lock.toml`
- Test: verified by command output (schema migrate) — behavioural tests come in Task 7.

**Interfaces:**
- Produces: Prisma models `User, Session, Account, Verification, Organization, Member, Invitation, LoginAttempt, JobRun`; SQL function `app_current_org()`; extensions `btree_gist`, `pg_trgm`, `citext`.

- [ ] **Step 1: Local Postgres**

`docker-compose.dev.yml`:
```yaml
services:
  db:
    image: postgres:16
    ports: ['5433:5432']
    environment:
      POSTGRES_PASSWORD: postgres
    volumes:
      - boogbe-pg:/var/lib/postgresql/data
      - ./deploy/sql/roles.sql:/docker-entrypoint-initdb.d/01-roles.sql:ro
      - ./deploy/sql/db-init.sql:/docker-entrypoint-initdb.d/02-db-init.sql:ro
volumes:
  boogbe-pg:
```

`deploy/sql/roles.sql` (local/CI passwords only; production passwords set per `docs/RUNBOOK.md`):
```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boogbe_migrator') THEN
    CREATE ROLE boogbe_migrator LOGIN PASSWORD 'migrator' CREATEDB BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boogbe_app') THEN
    CREATE ROLE boogbe_app LOGIN PASSWORD 'app' NOBYPASSRLS NOSUPERUSER;
  END IF;
END $$;
```

`deploy/sql/db-init.sql`:
```sql
CREATE DATABASE boogbe_dev OWNER boogbe_migrator;
CREATE DATABASE boogbe_test OWNER boogbe_migrator;
\c boogbe_dev
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
GRANT CONNECT ON DATABASE boogbe_dev TO boogbe_app;
\c boogbe_test
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
GRANT CONNECT ON DATABASE boogbe_test TO boogbe_app;
```
(Extensions are created by the superuser because `boogbe_migrator` is not a superuser. `0001_init` uses `IF NOT EXISTS` so it is a no-op where they exist.)

Run: `pnpm db:up && docker compose -f docker-compose.dev.yml logs db | tail -5`
Expected: `database system is ready to accept connections`.

- [ ] **Step 2: API package**

`apps/api/package.json`:
```json
{
  "name": "@boogbe/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start:prod": "node dist/main.js",
    "start:worker": "node dist/worker.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:int": "vitest run --config vitest.int.config.ts",
    "prisma:generate": "prisma generate --schema ../../prisma/schema.prisma",
    "prisma:migrate:dev": "dotenv -e ../../.env -v DATABASE_URL=$DATABASE_MIGRATE_URL -- prisma migrate dev --schema ../../prisma/schema.prisma",
    "prisma:migrate:deploy": "prisma migrate deploy --schema ../../prisma/schema.prisma",
    "prisma:reset": "dotenv -e ../../.env -- sh -c 'DATABASE_URL=$DATABASE_MIGRATE_URL prisma migrate reset --force --skip-seed --schema ../../prisma/schema.prisma'",
    "create-platform-admin": "tsx scripts/create-platform-admin.ts"
  },
  "dependencies": {
    "@boogbe/shared": "workspace:*",
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@nestjs/schedule": "^4.1.0",
    "@nestjs/throttler": "^6.2.1",
    "@prisma/client": "^5.22.0",
    "@sentry/nestjs": "^8.35.0",
    "better-auth": "^1.3.0",
    "cors": "^2.8.5",
    "express": "^4.21.0",
    "helmet": "^8.0.0",
    "nestjs-zod": "^5.0.0",
    "reflect-metadata": "^0.2.2",
    "resend": "^4.0.0",
    "rxjs": "^7.8.1",
    "uuidv7": "^1.0.2",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.0",
    "@nestjs/testing": "^10.4.0",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.7.0",
    "@types/supertest": "^6.0.2",
    "dotenv-cli": "^7.4.2",
    "pg": "^8.13.0",
    "@types/pg": "^8.11.10",
    "prisma": "^5.22.0",
    "supertest": "^7.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.3",
    "unplugin-swc": "^1.5.1",
    "@swc/core": "^1.7.0",
    "vitest": "^2.1.9"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "outDir": "dist",
    "isolatedModules": false,
    "types": ["node"]
  },
  "include": ["src", "test", "scripts"]
}
```
`apps/api/tsconfig.build.json`: `{ "extends": "./tsconfig.json", "include": ["src"], "exclude": ["src/**/*.spec.ts"] }`
`apps/api/nest-cli.json`: `{ "collection": "@nestjs/schematics", "sourceRoot": "src", "compilerOptions": { "tsConfigPath": "tsconfig.build.json", "deleteOutDir": true } }`

Note: `@boogbe/shared` is TypeScript source. Nest's `tsc` build compiles it in place because it is imported by path through `node_modules/@boogbe/shared/src/index.ts`; set `"compilerOptions.paths"` only if the build fails to find it — in that case add `"paths": { "@boogbe/shared": ["../../packages/shared/src/index.ts"] }` to `apps/api/tsconfig.json` and use `tsc-alias` is **not** needed because Nest CLI with `webpack: false` resolves via node_modules symlink. Verify in Step 5.

- [ ] **Step 3: Prisma schema (global tables)**

`prisma/schema.prisma`:
```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = []
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ───────────── Better Auth (global, no RLS) ─────────────
// Field names follow Better Auth's schema (verify with `npx @better-auth/cli generate` after Task 5;
// if the CLI output differs, the CLI output wins — update this file in the same PR).

model User {
  id            String    @id
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  role          String?   @default("user")
  banned        Boolean?  @default(false)
  banReason     String?
  banExpires    DateTime?
  sessions      Session[]
  accounts      Account[]
  members       Member[]
  invitations   Invitation[]

  @@map("user")
}

model Session {
  id                   String   @id
  expiresAt            DateTime
  token                String   @unique
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  ipAddress            String?
  userAgent            String?
  userId               String
  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  activeOrganizationId String?
  impersonatedBy       String?

  @@index([userId])
  @@map("session")
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@index([userId])
  @@map("account")
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([identifier])
  @@map("verification")
}

/// The operator (tenant).
model Organization {
  id            String       @id
  name          String
  slug          String       @unique
  logo          String?
  createdAt     DateTime     @default(now())
  metadata      String?
  timezone      String       @default("Africa/Lagos")
  currency      String       @default("NGN")
  status        String       @default("active")
  contactEmail  String?
  contactPhone  String?
  whatsappPhone String?
  address       String?
  members       Member[]
  invitations   Invitation[]

  @@map("organization")
}

model Member {
  id             String       @id
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  userId         String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  role           String
  createdAt      DateTime     @default(now())

  @@unique([organizationId, userId])
  @@index([userId])
  @@map("member")
}

model Invitation {
  id             String       @id
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  email          String
  role           String?
  status         String       @default("pending")
  expiresAt      DateTime
  inviterId      String
  user           User         @relation(fields: [inviterId], references: [id], onDelete: Cascade)
  createdAt      DateTime     @default(now())

  @@index([email])
  @@map("invitation")
}

// ───────────── Platform utilities (global, no RLS) ─────────────

model LoginAttempt {
  id        String   @id
  email     String
  ip        String?
  success   Boolean
  createdAt DateTime @default(now())

  @@index([email, createdAt])
  @@map("login_attempt")
}

model JobRun {
  id         String    @id
  name       String
  orgId      String?   @map("org_id")
  startedAt  DateTime  @default(now()) @map("started_at")
  finishedAt DateTime? @map("finished_at")
  ok         Boolean?
  error      String?
  meta       Json?

  @@index([name, startedAt])
  @@map("job_run")
}
```
`prisma/migrations/migration_lock.toml`:
```toml
provider = "postgresql"
```

- [ ] **Step 4: Generate the init migration and append raw SQL**

Run (from repo root, `.env` copied from `.env.example`):
```bash
cp .env.example .env
pnpm install
cd apps/api && npx dotenv -e ../../.env -- sh -c 'DATABASE_URL=$DATABASE_MIGRATE_URL npx prisma migrate dev --name init --create-only --schema ../../prisma/schema.prisma' && cd ../..
mv prisma/migrations/*_init prisma/migrations/0001_init
```
Append to `prisma/migrations/0001_init/migration.sql`:
```sql
-- ── Boogbe: extensions, RLS helper, default grants ──
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- '' after a transaction-local set_config ends, NULL if never set: both mean "no org".
CREATE OR REPLACE FUNCTION app_current_org() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.org_id', true), '') $$;

GRANT USAGE ON SCHEMA public TO boogbe_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO boogbe_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO boogbe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE boogbe_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO boogbe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE boogbe_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO boogbe_app;
GRANT EXECUTE ON FUNCTION app_current_org() TO boogbe_app;
```

- [ ] **Step 5: Apply and verify**

Run: `pnpm db:reset && pnpm --filter @boogbe/api prisma:generate`
Expected: "Database reset successful", "Generated Prisma Client".
Run: `docker compose -f docker-compose.dev.yml exec db psql -U boogbe_app -d boogbe_dev -c "select app_current_org();"`
Expected: one row, empty (NULL).

- [ ] **Step 6: Commit**
```bash
git add docker-compose.dev.yml deploy/sql prisma apps/api/package.json apps/api/tsconfig*.json apps/api/nest-cli.json pnpm-lock.yaml .env.example
git commit -m "feat(db): postgres roles, Better Auth schema and RLS helper [NFR-01]"
```

---

### Task 4 (T-M0-04) [api]: Nest app skeleton — env, health, error envelope, request id

**Files:**
- Create: `apps/api/src/env.ts`, `apps/api/src/build-app.ts`, `apps/api/src/main.ts`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/common/http/app-error.ts`, `apps/api/src/common/http/error.filter.ts`, `apps/api/src/common/http/request-id.middleware.ts`
- Create: `apps/api/src/common/db/prisma.service.ts`, `apps/api/src/common/db/db.module.ts`
- Create: `apps/api/src/modules/health/health.controller.ts`
- Create: `apps/api/vitest.config.ts`, `apps/api/vitest.int.config.ts`, `apps/api/test/global-setup.ts`, `apps/api/test/helpers/app.ts`, `apps/api/test/helpers/db.ts`
- Test: `apps/api/test/health.int.ts`, `apps/api/src/common/http/error.filter.spec.ts`

**Interfaces:**
- Produces: `loadEnv(): Env` (zod-parsed, throws listing missing keys); `class AppError extends Error { constructor(code: ErrorCode, status: number, message: string, details?: unknown) }`; `buildApp(opts?: { env?: Partial<Env> }): Promise<NestExpressApplication>`; test helpers `createTestApp(): Promise<{ app, http: supertest.Agent, close(): Promise<void> }>`, `truncateAll(): Promise<void>`, `migratorClient(): pg.Client`.
- `GET /v1/health` → `200 { ok: true }` (`@Public()` is added in Task 6; until then guards don't exist).

- [ ] **Step 1: Test config**

`apps/api/vitest.config.ts`:
```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [swc.vite()],
  test: { include: ['src/**/*.spec.ts'], environment: 'node' },
});
```
`apps/api/vitest.int.config.ts`:
```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['test/**/*.int.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
```
`apps/api/test/global-setup.ts`:
```ts
import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import { resolve } from 'node:path';

export default function setup() {
  config({ path: resolve(__dirname, '../../../.env') });
  const migrate = process.env.TEST_DATABASE_MIGRATE_URL;
  if (!migrate || !process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL and TEST_DATABASE_MIGRATE_URL must be set');
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate --schema ../../prisma/schema.prisma', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: migrate },
    stdio: 'inherit',
  });
}
```
(`dotenv` is available transitively via `dotenv-cli`; add `"dotenv": "^16.4.5"` to devDependencies explicitly.)

`apps/api/test/helpers/db.ts`:
```ts
import { Client } from 'pg';

export async function migratorClient(): Promise<Client> {
  const c = new Client({ connectionString: process.env.TEST_DATABASE_MIGRATE_URL });
  await c.connect();
  return c;
}

/** Empties every table except Prisma's bookkeeping. Runs as the migrator (table owner) so RLS doesn't hide rows. */
export async function truncateAll(): Promise<void> {
  const c = await migratorClient();
  try {
    const { rows } = await c.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length) await c.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  } finally {
    await c.end();
  }
}
```
`apps/api/test/helpers/app.ts`:
```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import supertest from 'supertest';
import { buildApp } from '../../src/build-app';

export interface TestApp {
  app: NestExpressApplication;
  http: ReturnType<typeof supertest>;
  agent: () => ReturnType<typeof supertest.agent>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.BETTER_AUTH_URL ??= 'http://localhost:5173';
  process.env.APP_ORIGIN ??= 'http://localhost:5173';
  process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret-1234';
  const app = await buildApp();
  await app.init();
  const server = app.getHttpServer();
  return {
    app,
    http: supertest(server),
    agent: () => supertest.agent(server).set('Origin', process.env.APP_ORIGIN!),
    close: () => app.close(),
  };
}
```

- [ ] **Step 2: Write failing tests**

`apps/api/test/health.int.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';

describe('health', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });

  it('returns ok and a request id', async () => {
    const res = await t.http.get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: true });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('unknown route returns the error envelope', async () => {
    const res = await t.http.get('/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String), requestId: expect.any(String) } });
  });
});
```
`apps/api/src/common/http/error.filter.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toErrorBody } from './error.filter';
import { AppError } from './app-error';

describe('toErrorBody', () => {
  it('maps AppError as-is', () => {
    expect(toErrorBody(new AppError('DATES_UNAVAILABLE', 409, 'Taken', { id: 'b1' }))).toEqual({
      status: 409, body: { error: { code: 'DATES_UNAVAILABLE', message: 'Taken', details: { id: 'b1' } } },
    });
  });
  it('maps zod validation failures to 400 VALIDATION_FAILED', () => {
    const e = new BadRequestException({ statusCode: 400, message: 'Validation failed', errors: [{ path: ['name'] }] });
    expect(toErrorBody(e)).toEqual({
      status: 400, body: { error: { code: 'VALIDATION_FAILED', message: 'Validation failed', details: [{ path: ['name'] }] } },
    });
  });
  it('maps Postgres exclusion violation 23P01 to 409 DATES_UNAVAILABLE', () => {
    const e = new Prisma.PrismaClientUnknownRequestError('ERROR: conflicting key value violates exclusion constraint "booking_no_overlap" (23P01)', { clientVersion: '5' });
    expect(toErrorBody(e).body.error.code).toBe('DATES_UNAVAILABLE');
  });
  it('maps unique violation P2002 to 409 CONFLICT', () => {
    const e = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5', meta: { target: ['slug'] } });
    expect(toErrorBody(e)).toMatchObject({ status: 409, body: { error: { code: 'CONFLICT' } } });
  });
  it('hides internals for unknown errors', () => {
    expect(toErrorBody(new Error('secret db detail'))).toEqual({
      status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong' } },
    });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: FAIL — modules `./error.filter`, `../../src/build-app` not found.

- [ ] **Step 4: Implement**

`apps/api/src/env.ts`:
```ts
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3060),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  APP_ORIGIN: z.string().url(),
  COOKIE_DOMAIN: z.string().optional().transform((v) => v || undefined),
  PLATFORM_ADMIN_EMAILS: z.string().default('').transform((v) => v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
  RESEND_API_KEY: z.string().optional().transform((v) => v || undefined),
  MAIL_FROM: z.string().default('Boogbe <bookings@mail.boogbe.com>'),
  SENTRY_DSN: z.string().optional().transform((v) => v || undefined),
  BOOGBE_ROLE: z.enum(['api', 'worker']).default('api'),
});
export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = schema.safeParse(source);
  if (!r.success) {
    const keys = r.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment: ${keys}`);
  }
  return r.data;
}
```

`apps/api/src/common/http/app-error.ts`:
```ts
import type { ErrorCode } from '@boogbe/shared';
export class AppError extends Error {
  constructor(public readonly code: ErrorCode, public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
  }
}
export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', 404, `${what} not found`);
export const forbidden = (msg = 'You do not have permission to do that') => new AppError('FORBIDDEN', 403, msg);
```

`apps/api/src/common/http/error.filter.ts`:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import type { ApiErrorBody, ErrorCode } from '@boogbe/shared';
import { AppError } from './app-error';

const STATUS_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 429: 'RATE_LIMITED',
};

export function toErrorBody(e: unknown): { status: number; body: ApiErrorBody } {
  if (e instanceof AppError) {
    return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.details !== undefined && { details: e.details }) } } };
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') return { status: 409, body: { error: { code: 'CONFLICT', message: 'Already exists', details: e.meta } } };
    if (e.code === 'P2025') return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  }
  if ((e instanceof Prisma.PrismaClientUnknownRequestError || e instanceof Prisma.PrismaClientKnownRequestError) && /23P01|exclusion constraint/.test(e.message)) {
    return { status: 409, body: { error: { code: 'DATES_UNAVAILABLE', message: 'Those dates are not available' } } };
  }
  if (e instanceof HttpException) {
    const status = e.getStatus();
    const r = e.getResponse() as { message?: string | string[]; errors?: unknown };
    const message = typeof r === 'string' ? r : Array.isArray(r.message) ? r.message.join('; ') : (r.message ?? e.message);
    return {
      status,
      body: { error: { code: STATUS_CODE[status] ?? 'INTERNAL', message, ...(r.errors !== undefined && { details: r.errors }) } },
    };
  }
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong' } } };
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');
  catch(e: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const { status, body } = toErrorBody(e);
    if (status >= 500) this.log.error({ requestId: req.id, err: e });
    body.error.requestId = req.id;
    res.status(status).json(body);
  }
}
```

`apps/api/src/common/http/request-id.middleware.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
export function requestId(req: Request & { id?: string }, res: Response, next: NextFunction) {
  req.id = randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}
```

`apps/api/src/common/db/prisma.service.ts`:
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Raw client. Only common/db, common/auth, platform/invitations (global tables) and jobs may inject it. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```
`apps/api/src/common/db/db.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class DbModule {}
```
(Task 7 adds `OrgDb` to this module.)

`apps/api/src/modules/health/health.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../common/db/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, db: true };
  }
}
```

`apps/api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { DbModule } from './common/db/db.module';
import { ErrorFilter } from './common/http/error.filter';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [DbModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
```

`apps/api/src/build-app.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadEnv } from './env';
import { requestId } from './common/http/request-id.middleware';

export async function buildApp(): Promise<NestExpressApplication> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: env.NODE_ENV === 'test' ? ['error'] : undefined });
  const http = app.getHttpAdapter().getInstance() as express.Express;
  http.set('trust proxy', 1);
  http.use(requestId);
  http.use(helmet());
  http.use(cors({ origin: [env.APP_ORIGIN], credentials: true }));
  // Task 5 mounts Better Auth here, BEFORE the JSON body parser.
  http.use(express.json({ limit: '1mb' }));
  app.setGlobalPrefix('v1');
  return app;
}
```

`apps/api/src/main.ts`:
```ts
import { buildApp } from './build-app';
import { loadEnv } from './env';

async function main() {
  const env = loadEnv();
  const app = await buildApp();
  app.enableShutdownHooks();
  await app.listen(env.PORT, '127.0.0.1');
}
void main();
```

Unknown-route 404: Nest returns `NotFoundException` which the filter maps to `NOT_FOUND`.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: PASS (error.filter 5 tests; health 2 tests).

- [ ] **Step 6: Commit**
```bash
git add apps/api
git commit -m "feat(api): nest skeleton with env validation, health and error envelope [NFR-08]"
```

---

### Task 5 (T-M0-05) [api]: Better Auth — config, mounting, invite-only sign-up, lockout, password reset

**Files:**
- Create: `apps/api/src/common/auth/ac.ts`, `apps/api/src/common/auth/auth.ts`, `apps/api/src/common/auth/auth.tokens.ts`, `apps/api/src/common/auth/auth.module.ts`, `apps/api/src/common/auth/lockout.ts`
- Create: `apps/api/src/common/mail/mailer.ts`, `apps/api/src/common/mail/mail.module.ts`, `apps/api/src/common/mail/templates.ts`
- Create: `apps/api/test/helpers/users.ts`
- Modify: `apps/api/src/build-app.ts`, `apps/api/src/app.module.ts`
- Test: `apps/api/test/auth.int.ts`, `apps/api/src/common/auth/lockout.spec.ts`

**Interfaces:**
- Produces: `createAuth(deps: { prisma: PrismaClient; mailer: Mailer; env: Env }): Auth` where `type Auth = ReturnType<typeof createAuth>`; Nest token `AUTH` (string `'BOOGBE_AUTH'`); `interface Mailer { send(msg: { to: string; subject: string; html: string; text: string; replyTo?: string }): Promise<void> }`; `MAILER` token; `MemoryMailer` (test) with `sent: MailMessage[]` and `lastTo(email): MailMessage | undefined`; `inviteEmail(p: { orgName: string; role: OrgRole; url: string })`, `resetPasswordEmail(p: { url: string })` returning `{ subject, html, text }`.
- Produces (test helpers): `seedOrg(name?: string): Promise<{ id: string; slug: string }>`; `seedUser(p: { email?: string; password?: string; name?: string; platformAdmin?: boolean }): Promise<{ id: string; email: string; password: string }>`; `addMember(orgId, userId, role: OrgRole): Promise<string /*memberId*/>`; `signIn(t: TestApp, email, password): Promise<Agent>` (agent with session cookie and active org unset); `signInAs(t, role: OrgRole, orgId): Promise<{ agent; userId; memberId }>` (creates user, membership, signs in, sets active org).
- Better Auth endpoints used by the app: `/v1/auth/sign-in/email`, `/v1/auth/sign-up/email`, `/v1/auth/sign-out`, `/v1/auth/get-session`, `/v1/auth/request-password-reset`, `/v1/auth/reset-password`, `/v1/auth/organization/*`, `/v1/auth/list-sessions`, `/v1/auth/revoke-other-sessions`.

- [ ] **Step 1: Write failing tests**

`apps/api/src/common/auth/lockout.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isLocked } from './lockout';

const now = new Date('2026-10-09T12:00:00Z');
const at = (minAgo: number, success = false) => ({ success, createdAt: new Date(now.getTime() - minAgo * 60_000) });

describe('isLocked', () => {
  it('locks after 5 failures within 15 minutes', () => {
    expect(isLocked([at(1), at(2), at(3), at(4), at(5)], now)).toBe(true);
  });
  it('does not lock on 4 failures', () => {
    expect(isLocked([at(1), at(2), at(3), at(4)], now)).toBe(false);
  });
  it('a success resets the count', () => {
    expect(isLocked([at(1), at(2), at(3, true), at(4), at(5), at(6)], now)).toBe(false);
  });
  it('ignores failures older than 15 minutes', () => {
    expect(isLocked([at(1), at(2), at(3), at(4), at(16)], now)).toBe(false);
  });
});
```

`apps/api/test/helpers/users.ts`:
```ts
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import type { OrgRole } from '@boogbe/shared';
import { migratorClient } from './db';
import type { TestApp } from './app';
import { AUTH } from '../../src/common/auth/auth.tokens';
import type { Auth } from '../../src/common/auth/auth';

export async function seedOrg(name = `Org ${randomUUID().slice(0, 6)}`) {
  const c = await migratorClient();
  const id = randomUUID();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  try {
    await c.query(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1,$2,$3, now())`, [id, name, slug]);
  } finally { await c.end(); }
  return { id, slug };
}

/** Creates a user through Better Auth. A pending invitation is inserted first so the invite-only gate allows it. */
export async function seedUser(t: TestApp, p: { email?: string; password?: string; name?: string; platformAdmin?: boolean } = {}) {
  const email = (p.email ?? `u-${randomUUID().slice(0, 8)}@test.boogbe`).toLowerCase();
  const password = p.password ?? 'correct-horse-battery';
  const c = await migratorClient();
  try {
    const org = await seedOrg();
    const inviter = randomUUID();
    await c.query(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,'seed',$2,true,now(),now())`, [inviter, `seed-${inviter}@test.boogbe`]);
    await c.query(`INSERT INTO invitation(id,"organizationId",email,role,status,"expiresAt","inviterId","createdAt") VALUES ($1,$2,$3,'frontdesk','pending', now() + interval '1 day',$4, now())`, [randomUUID(), org.id, email, inviter]);
    const auth = t.app.get<Auth>(AUTH);
    const r = await auth.api.signUpEmail({ body: { email, password, name: p.name ?? 'Test User' } });
    if (p.platformAdmin) await c.query(`UPDATE "user" SET role = 'admin' WHERE id = $1`, [r.user.id]);
    return { id: r.user.id, email, password };
  } finally { await c.end(); }
}

export async function addMember(orgId: string, userId: string, role: OrgRole): Promise<string> {
  const c = await migratorClient();
  const id = randomUUID();
  try {
    await c.query(`INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,$4,now())`, [id, orgId, userId, role]);
  } finally { await c.end(); }
  return id;
}

export async function signIn(t: TestApp, email: string, password: string) {
  const agent = t.agent();
  const res = await agent.post('/v1/auth/sign-in/email').send({ email, password });
  if (res.status !== 200) throw new Error(`sign-in failed ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export async function signInAs(t: TestApp, role: OrgRole, orgId: string) {
  const u = await seedUser(t);
  const memberId = await addMember(orgId, u.id, role);
  const agent = await signIn(t, u.email, u.password);
  const r = await agent.post('/v1/auth/organization/set-active').send({ organizationId: orgId });
  if (r.status !== 200) throw new Error(`set-active failed ${r.status}`);
  return { agent, userId: u.id, memberId, email: u.email };
}
export type Agent = ReturnType<typeof supertest.agent>;
```

`apps/api/test/auth.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll, migratorClient } from './helpers/db';
import { seedUser, signIn } from './helpers/users';
import { MAILER } from '../src/common/mail/mail.module';
import type { MemoryMailer } from '../src/common/mail/mailer';

describe('auth', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await truncateAll(); });

  it('sign-up without invitation is rejected [AUTH-01]', async () => {
    const res = await t.agent().post('/v1/auth/sign-up/email').send({ email: 'x@y.z', password: 'correct-horse-battery', name: 'X' });
    expect(res.status).toBe(403);
    const c = await migratorClient();
    const { rows } = await c.query(`select count(*)::int as n from "user"`);
    await c.end();
    expect(rows[0].n).toBe(0);
  });

  it('invited user can sign in and get a session [AUTH-01]', async () => {
    const u = await seedUser(t);
    const agent = await signIn(t, u.email, u.password);
    const s = await agent.get('/v1/auth/get-session');
    expect(s.status).toBe(200);
    expect(s.body.user.email).toBe(u.email);
  });

  it('wrong password returns a generic error [AUTH-01]', async () => {
    const u = await seedUser(t);
    const res = await t.agent().post('/v1/auth/sign-in/email').send({ email: u.email, password: 'wrong-password-123' });
    expect(res.status).toBe(401);
    const res2 = await t.agent().post('/v1/auth/sign-in/email').send({ email: 'nobody@test.boogbe', password: 'wrong-password-123' });
    expect(res2.status).toBe(401);
    expect(res2.body.message).toBe(res.body.message);
  });

  it('locks the account after 5 failures, even with the right password [AUTH-02]', async () => {
    const u = await seedUser(t);
    for (let i = 0; i < 5; i++) await t.agent().post('/v1/auth/sign-in/email').send({ email: u.email, password: 'wrong-password-123' });
    const res = await t.agent().post('/v1/auth/sign-in/email').send({ email: u.email, password: u.password });
    expect(res.status).toBe(429);
  });

  it('password reset emails a link and revokes other sessions [AUTH-03]', async () => {
    const u = await seedUser(t);
    const other = await signIn(t, u.email, u.password);
    await t.agent().post('/v1/auth/request-password-reset').send({ email: u.email, redirectTo: 'http://localhost:5173/auth/reset' }).expect(200);
    const mail = t.app.get<MemoryMailer>(MAILER).lastTo(u.email)!;
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
    await t.agent().post('/v1/auth/reset-password').send({ newPassword: 'brand-new-password-1', token }).expect(200);
    const s = await other.get('/v1/auth/get-session');
    expect(s.body).toBeNull();
    await signIn(t, u.email, 'brand-new-password-1');
  });

  it('rejects passwords shorter than 10 characters [AUTH-01]', async () => {
    const c = await migratorClient();
    await c.end();
    const res = await t.agent().post('/v1/auth/sign-up/email').send({ email: 'short@test.boogbe', password: 'short', name: 'S' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: FAIL — `./lockout` missing; `/v1/auth/*` 404.

- [ ] **Step 3: Implement mailer**

`apps/api/src/common/mail/mailer.ts`:
```ts
import { Logger } from '@nestjs/common';
import { Resend } from 'resend';

export interface MailMessage { to: string; subject: string; html: string; text: string; replyTo?: string; fromName?: string }
export interface Mailer { send(msg: MailMessage): Promise<void> }

export class ResendMailer implements Mailer {
  private readonly client: Resend;
  constructor(apiKey: string, private readonly from: string) { this.client = new Resend(apiKey); }
  async send(m: MailMessage) {
    const from = m.fromName ? `${m.fromName} via Boogbe <${this.from.match(/<(.+)>/)?.[1] ?? this.from}>` : this.from;
    const { error } = await this.client.emails.send({ from, to: m.to, subject: m.subject, html: m.html, text: m.text, replyTo: m.replyTo });
    if (error) throw new Error(`resend: ${error.message}`);
  }
}

/** Dev/test mailer: keeps messages in memory and logs them. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  private readonly log = new Logger('MemoryMailer');
  async send(m: MailMessage) {
    this.sent.push(m);
    if (process.env.NODE_ENV === 'development') this.log.log(`to=${m.to} subject="${m.subject}"\n${m.text}`);
  }
  lastTo(email: string) { return [...this.sent].reverse().find((m) => m.to === email); }
}
```
`apps/api/src/common/mail/templates.ts`:
```ts
import { ROLE_LABELS, type OrgRole } from '@boogbe/shared';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const layout = (body: string) => `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#182d32">${body}<p style="color:#6b7b80;font-size:12px">Boogbe by EDGD Media</p></div>`;

export function inviteEmail(p: { orgName: string; role: OrgRole; url: string }) {
  const subject = `You're invited to ${p.orgName} on Boogbe`;
  const text = `You've been invited to join ${p.orgName} on Boogbe as ${ROLE_LABELS[p.role]}.\n\nAccept the invitation: ${p.url}\n\nThis link expires in 7 days.`;
  const html = layout(`<p>You've been invited to join <strong>${esc(p.orgName)}</strong> on Boogbe as ${esc(ROLE_LABELS[p.role])}.</p><p><a href="${esc(p.url)}">Accept the invitation</a></p><p>This link expires in 7 days.</p>`);
  return { subject, text, html };
}

export function resetPasswordEmail(p: { url: string }) {
  const subject = 'Reset your Boogbe password';
  const text = `Use this link to set a new password: ${p.url}\n\nIt expires in 1 hour. If you didn't ask for this, ignore this email.`;
  const html = layout(`<p><a href="${esc(p.url)}">Set a new password</a></p><p>It expires in 1 hour. If you didn't ask for this, ignore this email.</p>`);
  return { subject, text, html };
}
```
`apps/api/src/common/mail/mail.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { loadEnv } from '../../env';
import { MemoryMailer, ResendMailer } from './mailer';

export const MAILER = 'BOOGBE_MAILER';
@Global()
@Module({
  providers: [{
    provide: MAILER,
    useFactory: () => {
      const env = loadEnv();
      return env.RESEND_API_KEY && env.NODE_ENV !== 'test' ? new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM) : new MemoryMailer();
    },
  }],
  exports: [MAILER],
})
export class MailModule {}
```

- [ ] **Step 4: Implement lockout + auth**

`apps/api/src/common/auth/lockout.ts`:
```ts
export const LOCK_WINDOW_MS = 15 * 60_000;
export const LOCK_MAX_FAILURES = 5;

/** attempts: any order. Failures since the most recent success, within the window. */
export function isLocked(attempts: { success: boolean; createdAt: Date }[], now = new Date()): boolean {
  const recent = attempts
    .filter((a) => now.getTime() - a.createdAt.getTime() <= LOCK_WINDOW_MS)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  let failures = 0;
  for (const a of recent) {
    if (a.success) break;
    failures++;
  }
  return failures >= LOCK_MAX_FAILURES;
}
```

`apps/api/src/common/auth/ac.ts`:
```ts
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, memberAc } from 'better-auth/plugins/organization/access';

// Better Auth's own org-management permissions. Boogbe's domain permissions live in @boogbe/shared/permissions.
export const ac = createAccessControl(defaultStatements);
export const orgRoles = {
  admin: ac.newRole(adminAc.statements),
  frontdesk: ac.newRole(memberAc.statements),
  housekeeper: ac.newRole(memberAc.statements),
  landlord: ac.newRole(memberAc.statements),
};
```

`apps/api/src/common/auth/auth.ts`:
```ts
import type { PrismaClient } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { admin, organization } from 'better-auth/plugins';
import { randomUUID } from 'node:crypto';
import type { OrgRole } from '@boogbe/shared';
import type { Env } from '../../env';
import type { Mailer } from '../mail/mailer';
import { inviteEmail, resetPasswordEmail } from '../mail/templates';
import { ac, orgRoles } from './ac';
import { isLocked, LOCK_WINDOW_MS } from './lockout';

export function createAuth({ prisma, mailer, env }: { prisma: PrismaClient; mailer: Mailer; env: Env }) {
  return betterAuth({
    appName: 'Boogbe',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/v1/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_ORIGIN],
    database: prismaAdapter(prisma, { provider: 'postgresql', transaction: true }),
    advanced: {
      database: { generateId: () => randomUUID() },
      ...(env.COOKIE_DOMAIN && { crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN } }),
      useSecureCookies: env.NODE_ENV === 'production',
    },
    rateLimit: {
      enabled: env.NODE_ENV !== 'test',
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 10 }, '/request-password-reset': { window: 300, max: 3 } },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: async ({ user, url }) => {
        await mailer.send({ to: user.email, ...resetPasswordEmail({ url }) });
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Invite-only: a user may only be created for an email with a pending invitation,
          // or one listed in PLATFORM_ADMIN_EMAILS (bootstrap).
          before: async (user) => {
            const email = user.email.toLowerCase();
            if (env.PLATFORM_ADMIN_EMAILS.includes(email)) return { data: user };
            const invite = await prisma.invitation.findFirst({ where: { email, status: 'pending', expiresAt: { gt: new Date() } } });
            if (!invite) throw new APIError('FORBIDDEN', { message: 'Boogbe is invite-only. Ask your operator for an invitation.' });
            return { data: { ...user, email } };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const email = String(ctx.body?.email ?? '').toLowerCase();
        const attempts = await prisma.loginAttempt.findMany({
          where: { email, createdAt: { gt: new Date(Date.now() - LOCK_WINDOW_MS) } },
          select: { success: true, createdAt: true },
        });
        if (isLocked(attempts)) throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many attempts. Try again in 15 minutes.' });
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const returned = ctx.context.returned as unknown;
        const failed = returned instanceof APIError || (returned as { name?: string } | null)?.name === 'APIError';
        await prisma.loginAttempt.create({
          data: { id: randomUUID(), email: String(ctx.body?.email ?? '').toLowerCase(), ip: ctx.request?.headers.get('x-forwarded-for') ?? null, success: !failed },
        });
      }),
    },
    plugins: [
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
      organization({
        ac,
        roles: orgRoles,
        creatorRole: 'admin',
        allowUserToCreateOrganization: false, // operators are created by the platform module
        invitationExpiresIn: 7 * 24 * 3600,
        cancelPendingInvitationsOnReInvite: true,
        schema: {
          organization: {
            additionalFields: {
              timezone: { type: 'string', required: false, input: false, defaultValue: 'Africa/Lagos' },
              currency: { type: 'string', required: false, input: false, defaultValue: 'NGN' },
              status: { type: 'string', required: false, input: false, defaultValue: 'active' },
              contactEmail: { type: 'string', required: false, input: false },
              contactPhone: { type: 'string', required: false, input: false },
              whatsappPhone: { type: 'string', required: false, input: false },
              address: { type: 'string', required: false, input: false },
            },
          },
        },
        sendInvitationEmail: async ({ id, email, role, organization: org }) => {
          const url = `${env.APP_ORIGIN}/auth/accept-invite/${id}`;
          await mailer.send({ to: email, ...inviteEmail({ orgName: org.name, role: role as OrgRole, url }) });
        },
        // Task 9 adds organizationHooks (last-admin guard, audit, landlord linking).
      }),
    ],
  });
}
export type Auth = ReturnType<typeof createAuth>;
```

`apps/api/src/common/auth/auth.tokens.ts`:
```ts
export const AUTH = 'BOOGBE_AUTH';
```
`apps/api/src/common/auth/auth.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { loadEnv } from '../../env';
import { PrismaService } from '../db/prisma.service';
import { MAILER } from '../mail/mail.module';
import type { Mailer } from '../mail/mailer';
import { createAuth } from './auth';
import { AUTH } from './auth.tokens';

@Global()
@Module({
  providers: [{ provide: AUTH, inject: [PrismaService, MAILER], useFactory: (prisma: PrismaService, mailer: Mailer) => createAuth({ prisma, mailer, env: loadEnv() }) }],
  exports: [AUTH],
})
export class AuthModule {}
```
Modify `app.module.ts` imports: `[DbModule, MailModule, AuthModule]`.

Modify `build-app.ts` — replace the comment line with:
```ts
  const auth = app.get<Auth>(AUTH);
  http.all('/v1/auth/*', toNodeHandler(auth));
```
with imports `import { toNodeHandler } from 'better-auth/node'; import { AUTH } from './common/auth/auth.tokens'; import type { Auth } from './common/auth/auth';`.

Better Auth returns 422/400 for short passwords: assert `400` in the test; if Better Auth returns `400 PASSWORD_TOO_SHORT`, keep as is.

- [ ] **Step 5: Reconcile the schema with Better Auth's CLI**

Run: `cd apps/api && npx @better-auth/cli@latest generate --config src/common/auth/auth.ts --output /tmp/ba-schema.prisma -y; cd ../..; diff <(grep -v '^\s*//' /tmp/ba-schema.prisma) prisma/schema.prisma | head -60`
Expected: only differences are Boogbe-only models (`LoginAttempt`, `JobRun`) and `@@map`/`@@index` lines. If a Better Auth field is missing, add it to `prisma/schema.prisma`, run `pnpm db:migrate` (name `better_auth_sync`) and re-run tests. (If the CLI cannot load a factory-style config, create `apps/api/src/common/auth/auth.cli.ts` exporting `export const auth = createAuth({ prisma: new PrismaClient(), mailer: new MemoryMailer(), env: loadEnv() })` and point `--config` at it; do not commit the /tmp output.)

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: PASS (lockout 4, auth 6, health 2).

- [ ] **Step 7: Commit**
```bash
git add apps/api prisma
git commit -m "feat(auth): better-auth with orgs, invite-only sign-up, lockout and reset [AUTH-01 AUTH-02 AUTH-03]"
```

---

### Task 6 (T-M0-06) [api]: Session guard, permission decorators, route-permission spec

**Files:**
- Create: `apps/api/src/common/auth/request-ctx.ts`, `apps/api/src/common/auth/decorators.ts`, `apps/api/src/common/auth/session.guard.ts`
- Create: `apps/api/src/route-permissions.spec.ts`
- Create: `apps/api/src/modules/me/me.controller.ts`, `apps/api/src/modules/me/me.module.ts`, `packages/shared/src/contracts/me.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/modules/health/health.controller.ts`, `packages/shared/src/index.ts`
- Test: `apps/api/test/guards.int.ts`

**Interfaces:**
- Produces: `interface RequestCtx { userId: string; email: string; isPlatformAdmin: boolean; orgId: string | null; role: OrgRole | null; memberId: string | null; timezone: string | null }`; `@Public()`, `@Permission(p: Permission)`, `@PlatformAdmin()`, `@SignedIn()` (any authenticated user, no org needed); param decorator `@Ctx() ctx: RequestCtx`; helper `requireOrg(ctx): { orgId: string; role: OrgRole; memberId: string; timezone: string }` (throws `NO_ACTIVE_ORG` 400).
- `GET /v1/me` (`@SignedIn`) → `MeResponse` = `{ user: { id, name, email, isPlatformAdmin }, activeOrg: { id, name, slug, role, timezone, currency } | null, memberships: { orgId, orgName, role }[] }`.

- [ ] **Step 1: Write failing tests**

`apps/api/test/guards.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, seedUser, signIn, signInAs } from './helpers/users';

describe('guards', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await truncateAll(); });

  it('public route needs no session', async () => {
    await t.http.get('/v1/health').expect(200);
  });

  it('signed-in route rejects anonymous with 401', async () => {
    const res = await t.http.get('/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('me returns memberships and active org with role from the database [AUTH-05 AUTH-06]', async () => {
    const org = await seedOrg('Tanuhomes');
    const { agent } = await signInAs(t, 'frontdesk', org.id);
    const res = await agent.get('/v1/me').expect(200);
    expect(res.body.activeOrg).toMatchObject({ id: org.id, name: 'Tanuhomes', role: 'frontdesk', timezone: 'Africa/Lagos' });
    expect(res.body.memberships).toEqual([{ orgId: org.id, orgName: 'Tanuhomes', role: 'frontdesk' }]);
  });

  it('role change takes effect on the next request without re-login [AUTH-06]', async () => {
    const org = await seedOrg();
    const { agent, memberId } = await signInAs(t, 'frontdesk', org.id);
    const c = await migratorClient();
    await c.query(`update member set role='housekeeper' where id=$1`, [memberId]);
    await c.end();
    const res = await agent.get('/v1/me').expect(200);
    expect(res.body.activeOrg.role).toBe('housekeeper');
  });

  it('removed member loses org access immediately [AUTH-06]', async () => {
    const org = await seedOrg();
    const { agent, memberId } = await signInAs(t, 'admin', org.id);
    const c = await migratorClient();
    await c.query(`delete from member where id=$1`, [memberId]);
    await c.end();
    const res = await agent.get('/v1/me').expect(200);
    expect(res.body.activeOrg).toBeNull();
  });

  it('suspended org is refused [PLT-03]', async () => {
    const org = await seedOrg();
    const { agent } = await signInAs(t, 'admin', org.id);
    const c = await migratorClient();
    await c.query(`update organization set status='suspended' where id=$1`, [org.id]);
    await c.end();
    const res = await agent.get('/v1/org/settings');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORG_SUSPENDED');
  });

  it('platform routes refuse non-platform users [PLT-04]', async () => {
    const u = await seedUser(t);
    const agent = await signIn(t, u.email, u.password);
    expect((await agent.get('/v1/platform/operators')).status).toBe(403);
  });
});
```
(`/v1/org/settings` and `/v1/platform/operators` are built in Tasks 8 and 7; until then these two tests fail — they pass at the end of Task 8. Mark them `it.todo` now and switch to `it` in Task 8, Step "Un-todo guard tests".)

`apps/api/src/route-permissions.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ACCESS_KEY } from './common/auth/decorators';

describe('route permissions [AUTH-09]', () => {
  it('every route handler declares exactly one access rule', async () => {
    process.env.DATABASE_URL ??= 'postgresql://x:y@localhost:1/none';
    process.env.BETTER_AUTH_SECRET ??= 'x'.repeat(40);
    process.env.BETTER_AUTH_URL ??= 'http://localhost:5173';
    process.env.APP_ORIGIN ??= 'http://localhost:5173';
    const mod = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] }).compile();
    const discovery = mod.get(DiscoveryService);
    const scanner = mod.get(MetadataScanner);
    const reflector = mod.get(Reflector);
    const missing: string[] = [];
    for (const c of discovery.getControllers()) {
      const proto = Object.getPrototypeOf(c.instance);
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = proto[name];
        if (!Reflect.getMetadata('path', handler) && Reflect.getMetadata('path', handler) !== '') continue;
        const rule = reflector.getAllAndOverride(ACCESS_KEY, [handler, c.metatype as never]);
        if (!rule) missing.push(`${c.name}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: FAIL — `./common/auth/decorators` missing; `/v1/me` 404.

- [ ] **Step 3: Implement**

`apps/api/src/common/auth/request-ctx.ts`:
```ts
import type { OrgRole } from '@boogbe/shared';
import { AppError } from '../http/app-error';

export interface RequestCtx {
  userId: string;
  email: string;
  isPlatformAdmin: boolean;
  orgId: string | null;
  role: OrgRole | null;
  memberId: string | null;
  timezone: string | null;
}
export interface OrgCtx { orgId: string; role: OrgRole; memberId: string; timezone: string; userId: string }

export function requireOrg(ctx: RequestCtx): OrgCtx {
  if (!ctx.orgId || !ctx.role || !ctx.memberId || !ctx.timezone) throw new AppError('NO_ACTIVE_ORG', 400, 'Choose an operator first');
  return { orgId: ctx.orgId, role: ctx.role, memberId: ctx.memberId, timezone: ctx.timezone, userId: ctx.userId };
}
```

`apps/api/src/common/auth/decorators.ts`:
```ts
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@boogbe/shared';
import type { RequestCtx } from './request-ctx';

export const ACCESS_KEY = 'boogbe:access';
export type AccessRule = { kind: 'public' } | { kind: 'signedIn' } | { kind: 'platformAdmin' } | { kind: 'permission'; permission: Permission };

export const Public = () => SetMetadata(ACCESS_KEY, { kind: 'public' } satisfies AccessRule);
export const SignedIn = () => SetMetadata(ACCESS_KEY, { kind: 'signedIn' } satisfies AccessRule);
export const PlatformAdmin = () => SetMetadata(ACCESS_KEY, { kind: 'platformAdmin' } satisfies AccessRule);
export const Permission = (permission: Permission) => SetMetadata(ACCESS_KEY, { kind: 'permission', permission } satisfies AccessRule);

export const Ctx = createParamDecorator((_: unknown, ec: ExecutionContext): RequestCtx => ec.switchToHttp().getRequest().ctx);
```

`apps/api/src/common/auth/session.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { ORG_ROLES, can, type OrgRole } from '@boogbe/shared';
import { PrismaService } from '../db/prisma.service';
import { AppError } from '../http/app-error';
import type { Auth } from './auth';
import { AUTH } from './auth.tokens';
import { ACCESS_KEY, type AccessRule } from './decorators';
import type { RequestCtx } from './request-ctx';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService, @Inject(AUTH) private readonly auth: Auth) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule>(ACCESS_KEY, [ec.getHandler(), ec.getClass()]);
    if (!rule) throw new AppError('FORBIDDEN', 403, 'Route has no access rule'); // fail closed
    if (rule.kind === 'public') return true;

    const req = ec.switchToHttp().getRequest();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new AppError('UNAUTHENTICATED', 401, 'Please sign in');

    const ctx: RequestCtx = {
      userId: session.user.id,
      email: session.user.email,
      isPlatformAdmin: (session.user as { role?: string }).role === 'admin',
      orgId: null, role: null, memberId: null, timezone: null,
    };
    const activeOrgId = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId;
    if (activeOrgId) {
      // Role is always read from the DB, never trusted from the session (as Unclutter roles.guard.ts).
      const member = await this.prisma.member.findFirst({
        where: { organizationId: activeOrgId, userId: ctx.userId },
        include: { organization: { select: { status: true, timezone: true } } },
      });
      if (member && (ORG_ROLES as readonly string[]).includes(member.role)) {
        if (member.organization.status !== 'active' && rule.kind === 'permission') {
          throw new AppError('ORG_SUSPENDED', 403, 'This operator account is suspended');
        }
        Object.assign(ctx, { orgId: activeOrgId, role: member.role as OrgRole, memberId: member.id, timezone: member.organization.timezone });
      }
    }
    req.ctx = ctx;

    if (rule.kind === 'signedIn') return true;
    if (rule.kind === 'platformAdmin') {
      if (!ctx.isPlatformAdmin) throw new AppError('FORBIDDEN', 403, 'Platform admins only');
      return true;
    }
    if (!ctx.role) throw new AppError('NO_ACTIVE_ORG', 400, 'Choose an operator first');
    if (!can(ctx.role, rule.permission)) throw new AppError('FORBIDDEN', 403, 'You do not have permission to do that');
    return true;
  }
}
```
(A single `SessionGuard` evaluates every access rule; there is no separate permission guard.)

`packages/shared/src/contracts/me.ts`:
```ts
import { z } from 'zod';
import { ORG_ROLES } from '../enums';

export const MeResponse = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string(), isPlatformAdmin: z.boolean() }),
  activeOrg: z.object({ id: z.string(), name: z.string(), slug: z.string(), role: z.enum(ORG_ROLES), timezone: z.string(), currency: z.string() }).nullable(),
  memberships: z.array(z.object({ orgId: z.string(), orgName: z.string(), role: z.enum(ORG_ROLES) })),
});
export type MeResponse = z.infer<typeof MeResponse>;
```
Add `export * from './contracts/me';` to `packages/shared/src/index.ts`.

`apps/api/src/modules/me/me.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import type { MeResponse, OrgRole } from '@boogbe/shared';
import { PrismaService } from '../../common/db/prisma.service';
import { Ctx, SignedIn } from '../../common/auth/decorators';
import type { RequestCtx } from '../../common/auth/request-ctx';

@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @SignedIn()
  async me(@Ctx() ctx: RequestCtx): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    const members = await this.prisma.member.findMany({ where: { userId: ctx.userId }, include: { organization: true }, orderBy: { createdAt: 'asc' } });
    const active = members.find((m) => m.organizationId === ctx.orgId);
    return {
      user: { id: user.id, name: user.name, email: user.email, isPlatformAdmin: ctx.isPlatformAdmin },
      activeOrg: active
        ? { id: active.organization.id, name: active.organization.name, slug: active.organization.slug, role: active.role as OrgRole, timezone: active.organization.timezone, currency: active.organization.currency }
        : null,
      memberships: members.map((m) => ({ orgId: m.organizationId, orgName: m.organization.name, role: m.role as OrgRole })),
    };
  }
}
```
`me.module.ts`: `@Module({ controllers: [MeController] }) export class MeModule {}`

Modify `health.controller.ts`: add `@Public()` on `health()`.
Modify `app.module.ts`: import `MeModule`; add provider `{ provide: APP_GUARD, useClass: SessionGuard }`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: PASS (todo tests reported as todo).

- [ ] **Step 5: Commit**
```bash
git add apps/api packages/shared
git commit -m "feat(auth): fail-closed session guard with DB-checked roles and /me [AUTH-05 AUTH-06 AUTH-09]"
```

---

### Task 7 (T-M0-07) [schema][api]: OrgDb + RLS + isolation guards

**Files:**
- Modify: `prisma/schema.prisma` (add `OrgSettings`, `OrgCounter`, `AuditLog`)
- Create: `prisma/migrations/0002_tenant_base/migration.sql`
- Create: `apps/api/src/common/db/tenant-models.ts`, `apps/api/src/common/db/org-scope.extension.ts`, `apps/api/src/common/db/org-db.service.ts`
- Modify: `apps/api/src/common/db/db.module.ts`
- Create: `apps/api/src/common/audit/audit.service.ts`, `apps/api/src/common/audit/audit.module.ts`
- Create: `apps/api/src/tenant-isolation.spec.ts`
- Test: `apps/api/test/rls.int.ts`, `apps/api/test/org-db.int.ts`

**Interfaces:**
- Produces: `class OrgDb { run<T>(orgId: string, fn: (tx: OrgTx) => Promise<T>): Promise<T>; nextNumber(tx: OrgTx, name: 'receipt'|'statement'|'booking'): Promise<number> }`; `type OrgTx = Prisma.TransactionClient`; `TENANT_MODELS: ReadonlySet<Prisma.ModelName>`; `newId(): string` (UUIDv7) exported from `common/db/ids.ts`; `class AuditService { record(tx: OrgTx, e: { actor: OrgCtx | { userId: string; memberId: null }; action: string; entity: string; entityId: string; before?: unknown; after?: unknown; ip?: string | null }): Promise<void> }`.
- Prisma models: `OrgSettings`, `OrgCounter`, `AuditLog` (fields per `docs/DATA_MODEL.md`).

- [ ] **Step 1: Schema**

Append to `prisma/schema.prisma`:
```prisma
// ───────────── Tenant tables (RLS) ─────────────
// Rule: every tenant model has `orgId String @map("org_id")` and NO Prisma relation to Organization
// (FK is added in SQL) so creates always use scalar fields and the org-scope extension can inject orgId.

model OrgSettings {
  orgId                 String   @id @map("org_id")
  checkInTime           String   @default("14:00") @map("check_in_time")
  checkOutTime          String   @default("12:00") @map("check_out_time")
  holdHours             Int      @default(24) @map("hold_hours")
  autoConfirmOnPayment  Boolean  @default(true) @map("auto_confirm_on_payment")
  ownerSeesGuestNames   Boolean  @default(false) @map("owner_sees_guest_names")
  receiptPrefix         String   @map("receipt_prefix")
  statementPrefix       String   @map("statement_prefix")
  bookingPrefix         String   @map("booking_prefix")
  logoKey               String?  @map("logo_key")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  @@map("org_settings")
}

model OrgCounter {
  orgId String @map("org_id")
  name  String
  value BigInt @default(0)

  @@id([orgId, name])
  @@map("org_counter")
}

model AuditLog {
  id            String   @id
  orgId         String   @map("org_id")
  actorUserId   String   @map("actor_user_id")
  actorMemberId String?  @map("actor_member_id")
  action        String
  entity        String
  entityId      String   @map("entity_id")
  before        Json?
  after         Json?
  ip            String?
  at            DateTime @default(now())

  @@index([orgId, entity, entityId])
  @@index([orgId, at])
  @@map("audit_log")
}
```

Run: `pnpm db:migrate -- --name tenant_base --create-only` then rename the folder to `0002_tenant_base`. Append to its `migration.sql`:
```sql
ALTER TABLE org_settings ADD CONSTRAINT org_settings_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE org_counter  ADD CONSTRAINT org_counter_org_fk  FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE audit_log    ADD CONSTRAINT audit_log_org_fk    FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_settings','org_counter','audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

-- audit_log is append-only for the runtime role.
REVOKE UPDATE, DELETE ON audit_log FROM boogbe_app;
```
Run: `pnpm db:reset && pnpm --filter @boogbe/api prisma:generate`

- [ ] **Step 2: Write failing tests**

`apps/api/test/rls.int.ts`:
```ts
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';

async function appClient() {
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  return c;
}

describe('row level security [NFR-01]', () => {
  let a: { id: string }, b: { id: string };
  beforeEach(async () => {
    await truncateAll();
    a = await seedOrg('A'); b = await seedOrg('B');
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'A','A','A',now()),($2,'B','B','B',now())`, [a.id, b.id]);
    await m.end();
  });

  it('no org set → zero rows', async () => {
    const c = await appClient();
    const { rows } = await c.query('select count(*)::int n from org_settings');
    await c.end();
    expect(rows[0].n).toBe(0);
  });

  it('org set → only that org', async () => {
    const c = await appClient();
    await c.query('begin');
    await c.query(`select set_config('app.org_id', $1, true)`, [a.id]);
    const { rows } = await c.query('select org_id from org_settings');
    await c.query('commit');
    await c.end();
    expect(rows).toEqual([{ org_id: a.id }]);
  });

  it('rls returns zero rows after a previous transaction set org (pooled connection)', async () => {
    const c = await appClient();
    await c.query('begin');
    await c.query(`select set_config('app.org_id', $1, true)`, [a.id]);
    await c.query('commit');
    const { rows } = await c.query('select count(*)::int n from org_settings');
    await c.end();
    expect(rows[0].n).toBe(0);
  });

  it('cannot insert a row for another org', async () => {
    const c = await appClient();
    await c.query('begin');
    await c.query(`select set_config('app.org_id', $1, true)`, [a.id]);
    await expect(c.query(`insert into org_counter(org_id, name, value) values ($1, 'x', 0)`, [b.id])).rejects.toThrow(/row-level security/);
    await c.query('rollback');
    await c.end();
  });

  it('app role cannot update or delete audit_log', async () => {
    const c = await appClient();
    await expect(c.query(`update audit_log set action='x'`)).rejects.toThrow(/permission denied/);
    await expect(c.query(`delete from audit_log`)).rejects.toThrow(/permission denied/);
    await c.end();
  });

  it('every table with org_id has RLS enabled, forced and a policy', async () => {
    const m = await migratorClient();
    const { rows } = await m.query(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity,
             exists(select 1 from pg_policies p where p.tablename = c.relname) as has_policy
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists(select 1 from information_schema.columns col where col.table_name = c.relname and col.column_name = 'org_id')
        and c.relname <> 'job_run'`);
    await m.end();
    const bad = rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity || !r.has_policy).map((r) => r.relname);
    expect(rows.length).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
});
```
(`job_run.org_id` is nullable bookkeeping written by the worker outside any org; it is the single allowed exception.)

`apps/api/test/org-db.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';
import { OrgDb } from '../src/common/db/org-db.service';
import { PrismaService } from '../src/common/db/prisma.service';

describe('OrgDb', () => {
  let t: TestApp; let db: OrgDb;
  let a: { id: string }, b: { id: string };
  beforeAll(async () => { t = await createTestApp(); db = t.app.get(OrgDb); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll();
    a = await seedOrg('A'); b = await seedOrg('B');
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'AA','AA','AA',now()),($2,'BB','BB','BB',now())`, [a.id, b.id]);
    await m.end();
  });

  it('injects orgId into reads', async () => {
    const rows = await db.run(a.id, (tx) => tx.orgSettings.findMany());
    expect(rows.map((r) => r.orgId)).toEqual([a.id]);
  });

  it('update by id cannot touch another org\'s row', async () => {
    await expect(db.run(a.id, (tx) => tx.orgSettings.update({ where: { orgId: b.id }, data: { receiptPrefix: 'HACK' } }))).rejects.toThrow();
    const m = await migratorClient();
    const { rows } = await m.query(`select receipt_prefix from org_settings where org_id=$1`, [b.id]);
    await m.end();
    expect(rows[0].receipt_prefix).toBe('BB');
  });

  it('injects orgId into creates', async () => {
    await db.run(a.id, (tx) => tx.orgCounter.create({ data: { name: 'booking', value: 0n } as never }));
    const m = await migratorClient();
    const { rows } = await m.query(`select org_id from org_counter`);
    await m.end();
    expect(rows).toEqual([{ org_id: a.id }]);
  });

  it('nextNumber is gapless and per-org under concurrency', async () => {
    const nums = await Promise.all(Array.from({ length: 10 }, () => db.run(a.id, (tx) => db.nextNumber(tx, 'receipt'))));
    expect([...nums].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await db.run(b.id, (tx) => db.nextNumber(tx, 'receipt'))).toBe(1);
  });

  it('refuses tenant access outside run()', async () => {
    const prisma = t.app.get(PrismaService);
    const scoped = db.unsafeScopedClientForTests();
    await expect(scoped.orgSettings.findMany()).rejects.toThrow('outside OrgDb.run');
    expect(prisma).toBeDefined();
  });

  it('refuses an empty orgId', async () => {
    await expect(db.run('', async () => 1)).rejects.toThrow('orgId required');
  });
});
```

`apps/api/src/tenant-isolation.spec.ts` (adapted from Unclutter `apps/api/src/tenant-isolation.spec.ts`):
```ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Structural guards for tenant isolation:
 * 1. A service method that accepts `orgId` (or an OrgCtx named `ctx`/`org`) must use it.
 * 2. Only allow-listed folders may inject PrismaService (the unscoped client).
 * Unclutter shipped the first bug class three times; this reads source so untested methods are covered too.
 */
const SRC = resolve(__dirname);
const PRISMA_ALLOWED = ['common/db/', 'common/auth/', 'common/jobs/', 'modules/health/', 'modules/me/', 'modules/platform/', 'modules/invitations/'];

function files(dir: string, pred: (f: string) => boolean): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? files(p, pred) : pred(p) ? [p] : [];
  });
}

function methods(src: string) {
  const out: { name: string; args: string; body: string }[] = [];
  for (const m of src.matchAll(/ {2}(?:private |protected |public )?async (\w+)\(([\s\S]*?)\)\s*(?::[^{]*)?\{/g)) {
    let depth = 0; let body = '';
    for (let i = m.index! + m[0].length - 1; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) { body = src.slice(m.index! + m[0].length, i); break; }
    }
    out.push({ name: m[1]!, args: m[2]!.replace(/\s+/g, ' '), body });
  }
  return out;
}

describe('tenant isolation (static)', () => {
  const services = files(join(SRC, 'modules'), (f) => f.endsWith('.service.ts'));

  it('no service method accepts orgId without using it', () => {
    const v: string[] = [];
    for (const f of services) {
      for (const { name, args, body } of methods(readFileSync(f, 'utf8'))) {
        for (const p of ['orgId', 'org:', 'ctx:']) {
          const param = p.replace(':', '');
          if (args.includes(p === 'orgId' ? 'orgId' : p) && !new RegExp(`\\b${param}\\b`).test(body)) v.push(`${f.slice(SRC.length)} -> ${name}`);
        }
      }
    }
    expect(v, 'These methods take an org scope and ignore it. Use it or remove it.').toEqual([]);
  });

  it('only allow-listed folders inject PrismaService', () => {
    const offenders = files(SRC, (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .filter((f) => /PrismaService/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1))
      .filter((rel) => !PRISMA_ALLOWED.some((a) => rel.startsWith(a)));
    expect(offenders).toEqual([]);
  });

  it('detects a violation when one is present', () => {
    const sample = `
  async ok(orgId: string, id: string) { return x({ where: { id, orgId } }); }
  async leaky(orgId: string, id: string) { return x({ where: { id } }); }`;
    expect(methods(sample).filter((m) => m.args.includes('orgId') && !/\borgId\b/.test(m.body)).map((m) => m.name)).toEqual(['leaky']);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: FAIL — `OrgDb` not found; rls tests pass for SQL parts (policies exist) but `org-db.int.ts` fails.

- [ ] **Step 4: Implement OrgDb**

`apps/api/src/common/db/ids.ts`:
```ts
import { uuidv7 } from 'uuidv7';
export const newId = (): string => uuidv7();
```
`apps/api/src/common/db/tenant-models.ts`:
```ts
import { Prisma } from '@prisma/client';
/** Every Prisma model that has an `orgId` field, except JobRun (worker bookkeeping, nullable org). */
export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models.filter((m) => m.name !== 'JobRun' && m.fields.some((f) => f.name === 'orgId')).map((m) => m.name),
);
```
`apps/api/src/common/db/org-scope.extension.ts`:
```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';
import { TENANT_MODELS } from './tenant-models';

export const orgStore = new AsyncLocalStorage<{ orgId: string }>();

const WHERE_OPS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']);
const DATA_OPS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);

export const orgScope = Prisma.defineExtension({
  name: 'orgScope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args);
        const store = orgStore.getStore();
        if (!store) throw new Error(`Tenant model ${model} accessed outside OrgDb.run`);
        const { orgId } = store;
        const a = (args ?? {}) as Record<string, unknown>;
        if (WHERE_OPS.has(operation)) {
          // extendedWhereUnique (Prisma 5) lets non-unique fields sit beside unique ones.
          a.where = { ...(a.where as object | undefined), orgId };
        }
        if (DATA_OPS.has(operation)) {
          if (operation === 'upsert') a.create = { ...(a.create as object), orgId };
          else if (Array.isArray(a.data)) a.data = a.data.map((d) => ({ ...d, orgId }));
          else a.data = { ...(a.data as object), orgId };
        }
        return query(a as typeof args);
      },
    },
  },
});
```
`apps/api/src/common/db/org-db.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { orgScope, orgStore } from './org-scope.extension';

export type OrgTx = Prisma.TransactionClient;
type CounterName = 'receipt' | 'statement' | 'booking';

@Injectable()
export class OrgDb {
  private readonly scoped;
  constructor(prisma: PrismaService) { this.scoped = prisma.$extends(orgScope); }

  /** Runs `fn` in a transaction with app.org_id set for RLS and orgId injected into every tenant query. */
  run<T>(orgId: string, fn: (tx: OrgTx) => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
    if (!orgId) return Promise.reject(new Error('OrgDb.run: orgId required'));
    return orgStore.run({ orgId }, () =>
      this.scoped.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
        return fn(tx as unknown as OrgTx);
      }, { timeout: opts.timeoutMs ?? 15_000, maxWait: 5_000 }),
    );
  }

  /** Gapless per-org sequence. Must be called inside run(). */
  async nextNumber(tx: OrgTx, name: CounterName): Promise<number> {
    const rows = await tx.$queryRaw<{ value: bigint }[]>`
      INSERT INTO org_counter (org_id, name, value) VALUES (app_current_org(), ${name}, 1)
      ON CONFLICT (org_id, name) DO UPDATE SET value = org_counter.value + 1
      RETURNING value`;
    return Number(rows[0]!.value);
  }

  unsafeScopedClientForTests() { return this.scoped; }
}
```
Modify `db.module.ts`: `providers: [PrismaService, OrgDb], exports: [PrismaService, OrgDb]`.

`apps/api/src/common/audit/audit.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { newId } from '../db/ids';
import type { OrgTx } from '../db/org-db.service';

export interface AuditEntry {
  actor: { userId: string; memberId: string | null };
  action: string; entity: string; entityId: string;
  before?: unknown; after?: unknown; ip?: string | null;
}
const PII_KEYS = new Set(['phone', 'phoneE164', 'email', 'accountNumber', 'password']);
function scrub(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v, (k, val) => (PII_KEYS.has(k) ? '[redacted]' : typeof val === 'bigint' ? val.toString() : val)));
}

@Injectable()
export class AuditService {
  async record(tx: OrgTx, e: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        id: newId(), actorUserId: e.actor.userId, actorMemberId: e.actor.memberId,
        action: e.action, entity: e.entity, entityId: e.entityId,
        before: scrub(e.before), after: scrub(e.after), ip: e.ip ?? null,
      } as Prisma.AuditLogUncheckedCreateInput,
    });
  }
}
```
`audit.module.ts`: `@Global() @Module({ providers: [AuditService], exports: [AuditService] }) export class AuditModule {}`; import it in `AppModule`.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add prisma apps/api
git commit -m "feat(db): OrgDb with RLS session setting, org-scope extension, counters, audit log [NFR-01 AUD-01]"
```

---

### Task 8 (T-M0-08) [api]: Platform admin — operators, first-admin invitation, org settings read

**Files:**
- Create: `packages/shared/src/contracts/platform.ts`, `packages/shared/src/contracts/org.ts`
- Create: `apps/api/src/modules/platform/{platform.module.ts,platform.controller.ts,platform.service.ts}`
- Create: `apps/api/src/modules/invitations/{invitations.module.ts,invitations.controller.ts}`
- Create: `apps/api/src/modules/org/{org.module.ts,org.controller.ts,org.service.ts}`
- Create: `apps/api/scripts/create-platform-admin.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/test/guards.int.ts` (un-todo)
- Test: `apps/api/test/platform.int.ts`

**Interfaces:**
- Contracts (`@boogbe/shared`): `CreateOperatorInput { name; slug; timezone?; contactEmail?; contactPhone?; whatsappPhone? }`, `Operator { id; name; slug; status; timezone; currency; createdAt; memberCount; pendingInvites }`, `InviteFirstAdminInput { email; name? }`, `PublicInvitation { id; email; orgName; role; status; expired: boolean }`, `OrgSettingsResponse { org: { id, name, slug, timezone, currency, contactEmail, contactPhone, whatsappPhone, address }, settings: { checkInTime, checkOutTime, holdHours, autoConfirmOnPayment, ownerSeesGuestNames, receiptPrefix, statementPrefix, bookingPrefix } }`, `UpdateOrgSettingsInput` (all optional; validated: times `HH:MM`, holdHours 1–168, prefixes `[A-Z0-9]{2,6}`, phones E.164).
- Endpoints: `GET /v1/platform/operators` · `POST /v1/platform/operators` · `GET /v1/platform/operators/:id` (+ members, invites) · `POST /v1/platform/operators/:id/suspend` · `POST /v1/platform/operators/:id/reactivate` · `POST /v1/platform/operators/:id/invite-admin` · `POST /v1/platform/invitations/:id/resend` · `POST /v1/platform/invitations/:id/revoke` (all `@PlatformAdmin`) · `GET /v1/invitations/:id/public` (`@Public`, rate-limited) · `GET /v1/org/settings` (`org.settings.read`) · `PATCH /v1/org/settings` (`org.settings.write`).
- `PlatformService.createOperator(input, actor): Promise<Operator>` — inserts `organization` (global), then `OrgDb.run(newOrgId)` to insert `org_settings` with prefixes derived from slug (first 3 letters uppercased, e.g. `tanuhomes` → `TNH`? no — **first 3 alphanumerics uppercased**: `TAN`) and counters.

- [ ] **Step 1: Write failing tests**

`apps/api/test/platform.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedUser, signIn } from './helpers/users';
import { MAILER } from '../src/common/mail/mail.module';
import type { MemoryMailer } from '../src/common/mail/mailer';

describe('platform admin', () => {
  let t: TestApp; let admin: Awaited<ReturnType<typeof signIn>>;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll();
    const u = await seedUser(t, { platformAdmin: true });
    admin = await signIn(t, u.email, u.password);
  });

  it('creates an operator with Lagos/NGN defaults and settings [PLT-01]', async () => {
    const res = await admin.post('/v1/platform/operators').send({ name: 'Tanuhomes', slug: 'tanuhomes', contactEmail: 'hello@tanuhomes.com' }).expect(201);
    expect(res.body).toMatchObject({ name: 'Tanuhomes', slug: 'tanuhomes', status: 'active', timezone: 'Africa/Lagos', currency: 'NGN', memberCount: 0 });
    const list = await admin.get('/v1/platform/operators').expect(200);
    expect(list.body.items).toHaveLength(1);
  });

  it('rejects bad and duplicate slugs [PLT-01]', async () => {
    await admin.post('/v1/platform/operators').send({ name: 'X', slug: 'Bad Slug!' }).expect(400);
    await admin.post('/v1/platform/operators').send({ name: 'T', slug: 'tanu' }).expect(201);
    const dup = await admin.post('/v1/platform/operators').send({ name: 'T2', slug: 'tanu' });
    expect(dup.status).toBe(409);
  });

  it('invites the first admin who can accept and lands as admin [PLT-02]', async () => {
    const op = (await admin.post('/v1/platform/operators').send({ name: 'Tanuhomes', slug: 'tanuhomes' })).body;
    const inv = await admin.post(`/v1/platform/operators/${op.id}/invite-admin`).send({ email: 'Owner@Tanuhomes.com' }).expect(201);
    const mail = t.app.get<MemoryMailer>(MAILER).lastTo('owner@tanuhomes.com')!;
    expect(mail.text).toContain(`/auth/accept-invite/${inv.body.id}`);

    const pub = await t.http.get(`/v1/invitations/${inv.body.id}/public`).expect(200);
    expect(pub.body).toMatchObject({ email: 'owner@tanuhomes.com', orgName: 'Tanuhomes', role: 'admin', status: 'pending', expired: false });

    const agent = t.agent();
    await agent.post('/v1/auth/sign-up/email').send({ email: 'owner@tanuhomes.com', password: 'correct-horse-battery', name: 'Owner' }).expect(200);
    await agent.post('/v1/auth/organization/accept-invitation').send({ invitationId: inv.body.id }).expect(200);
    await agent.post('/v1/auth/organization/set-active').send({ organizationId: op.id }).expect(200);
    const me = await agent.get('/v1/me').expect(200);
    expect(me.body.activeOrg).toMatchObject({ id: op.id, role: 'admin' });
    const s = await agent.get('/v1/org/settings').expect(200);
    expect(s.body.settings).toMatchObject({ checkInTime: '14:00', checkOutTime: '12:00', holdHours: 24, receiptPrefix: 'TAN' });
  });

  it('suspends and reactivates [PLT-03]', async () => {
    const op = (await admin.post('/v1/platform/operators').send({ name: 'Tanuhomes', slug: 'tanuhomes' })).body;
    await admin.post(`/v1/platform/operators/${op.id}/suspend`).expect(200);
    expect((await admin.get(`/v1/platform/operators/${op.id}`)).body.status).toBe('suspended');
    await admin.post(`/v1/platform/operators/${op.id}/reactivate`).expect(200);
    expect((await admin.get(`/v1/platform/operators/${op.id}`)).body.status).toBe('active');
  });

  it('public invitation endpoint hides nothing sensitive and 404s unknown ids', async () => {
    await t.http.get('/v1/invitations/does-not-exist/public').expect(404);
  });

  it('org settings update validates input [ORG-02 ORG-03]', async () => {
    const op = (await admin.post('/v1/platform/operators').send({ name: 'Tanuhomes', slug: 'tanuhomes' })).body;
    const inv = (await admin.post(`/v1/platform/operators/${op.id}/invite-admin`).send({ email: 'a@t.ng' })).body;
    const agent = t.agent();
    await agent.post('/v1/auth/sign-up/email').send({ email: 'a@t.ng', password: 'correct-horse-battery', name: 'A' });
    await agent.post('/v1/auth/organization/accept-invitation').send({ invitationId: inv.id });
    await agent.post('/v1/auth/organization/set-active').send({ organizationId: op.id });
    await agent.patch('/v1/org/settings').send({ checkInTime: '25:00' }).expect(400);
    await agent.patch('/v1/org/settings').send({ checkInTime: '15:00', bookingPrefix: 'TNH', whatsappPhone: '+2348107548559' }).expect(200);
    const s = await agent.get('/v1/org/settings').expect(200);
    expect(s.body.settings.checkInTime).toBe('15:00');
    expect(s.body.org.whatsappPhone).toBe('+2348107548559');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:int`
Expected: FAIL — 404 on `/v1/platform/operators`.

- [ ] **Step 3: Contracts**

`packages/shared/src/contracts/platform.ts`:
```ts
import { z } from 'zod';
import { ORG_ROLES, ORG_STATUSES } from '../enums';

export const E164 = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +2348012345678');
export const Slug = z.string().regex(/^[a-z0-9-]{3,40}$/, 'Lowercase letters, numbers and dashes (3–40)');

export const CreateOperatorInput = z.object({
  name: z.string().trim().min(2).max(80),
  slug: Slug,
  timezone: z.string().default('Africa/Lagos'),
  contactEmail: z.string().email().optional(),
  contactPhone: E164.optional(),
  whatsappPhone: E164.optional(),
});
export type CreateOperatorInput = z.infer<typeof CreateOperatorInput>;

export const Operator = z.object({
  id: z.string(), name: z.string(), slug: z.string(), status: z.enum(ORG_STATUSES),
  timezone: z.string(), currency: z.string(), createdAt: z.string(),
  memberCount: z.number().int(), pendingInvites: z.number().int(),
});
export type Operator = z.infer<typeof Operator>;

export const OperatorDetail = Operator.extend({
  members: z.array(z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.enum(ORG_ROLES), createdAt: z.string() })),
  invitations: z.array(z.object({ id: z.string(), email: z.string(), role: z.string(), status: z.string(), expiresAt: z.string() })),
});
export type OperatorDetail = z.infer<typeof OperatorDetail>;

export const InviteFirstAdminInput = z.object({ email: z.string().email().transform((e) => e.toLowerCase()) });
export type InviteFirstAdminInput = z.infer<typeof InviteFirstAdminInput>;

export const PublicInvitation = z.object({
  id: z.string(), email: z.string(), orgName: z.string(), role: z.enum(ORG_ROLES),
  status: z.string(), expired: z.boolean(), userExists: z.boolean(),
});
export type PublicInvitation = z.infer<typeof PublicInvitation>;
```
`packages/shared/src/contracts/org.ts`:
```ts
import { z } from 'zod';
import { E164 } from './platform';

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const Prefix = z.string().regex(/^[A-Z0-9]{2,6}$/, '2–6 capital letters or digits');

export const OrgSettingsResponse = z.object({
  org: z.object({
    id: z.string(), name: z.string(), slug: z.string(), timezone: z.string(), currency: z.string(),
    contactEmail: z.string().nullable(), contactPhone: z.string().nullable(), whatsappPhone: z.string().nullable(), address: z.string().nullable(),
  }),
  settings: z.object({
    checkInTime: Time, checkOutTime: Time, holdHours: z.number().int(), autoConfirmOnPayment: z.boolean(),
    ownerSeesGuestNames: z.boolean(), receiptPrefix: Prefix, statementPrefix: Prefix, bookingPrefix: Prefix,
  }),
});
export type OrgSettingsResponse = z.infer<typeof OrgSettingsResponse>;

export const UpdateOrgSettingsInput = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: E164.nullable().optional(),
  whatsappPhone: E164.nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  checkInTime: Time.optional(), checkOutTime: Time.optional(),
  holdHours: z.number().int().min(1).max(168).optional(),
  autoConfirmOnPayment: z.boolean().optional(), ownerSeesGuestNames: z.boolean().optional(),
  receiptPrefix: Prefix.optional(), statementPrefix: Prefix.optional(), bookingPrefix: Prefix.optional(),
}).strict();
export type UpdateOrgSettingsInput = z.infer<typeof UpdateOrgSettingsInput>;
```
Export both from `packages/shared/src/index.ts`.

- [ ] **Step 4: Implement platform service + controller**

`apps/api/src/modules/platform/platform.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CreateOperatorInput, Operator, OperatorDetail, OrgRole } from '@boogbe/shared';
import { PrismaService } from '../../common/db/prisma.service';
import { OrgDb } from '../../common/db/org-db.service';
import { AppError, notFound } from '../../common/http/app-error';
import { MAILER } from '../../common/mail/mail.module';
import type { Mailer } from '../../common/mail/mailer';
import { inviteEmail } from '../../common/mail/templates';
import { loadEnv } from '../../env';
import { AuditService } from '../../common/audit/audit.service';

export const prefixFromSlug = (slug: string) => slug.replace(/[^a-z0-9]/g, '').slice(0, 3).toUpperCase().padEnd(2, 'X');

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService, private readonly orgDb: OrgDb, private readonly audit: AuditService, @Inject(MAILER) private readonly mailer: Mailer) {}

  private toOperator(o: { id: string; name: string; slug: string; status: string; timezone: string; currency: string; createdAt: Date; _count: { members: number } }, pending: number): Operator {
    return { id: o.id, name: o.name, slug: o.slug, status: o.status as Operator['status'], timezone: o.timezone, currency: o.currency, createdAt: o.createdAt.toISOString(), memberCount: o._count.members, pendingInvites: pending };
  }

  async list(): Promise<Operator[]> {
    const orgs = await this.prisma.organization.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { members: true } } } });
    const pending = await this.prisma.invitation.groupBy({ by: ['organizationId'], where: { status: 'pending' }, _count: true });
    const map = new Map(pending.map((p) => [p.organizationId, p._count]));
    return orgs.map((o) => this.toOperator(o, map.get(o.id) ?? 0));
  }

  async get(id: string): Promise<OperatorDetail> {
    const o = await this.prisma.organization.findUnique({ where: { id }, include: { _count: { select: { members: true } }, members: { include: { user: true } }, invitations: { orderBy: { createdAt: 'desc' } } } });
    if (!o) throw notFound('Operator');
    return {
      ...this.toOperator(o, o.invitations.filter((i) => i.status === 'pending').length),
      members: o.members.map((m) => ({ id: m.id, name: m.user.name, email: m.user.email, role: m.role as OrgRole, createdAt: m.createdAt.toISOString() })),
      invitations: o.invitations.map((i) => ({ id: i.id, email: i.email, role: i.role ?? 'admin', status: i.status, expiresAt: i.expiresAt.toISOString() })),
    };
  }

  async createOperator(input: CreateOperatorInput, actorUserId: string): Promise<Operator> {
    const id = randomUUID();
    await this.prisma.organization.create({
      data: { id, name: input.name, slug: input.slug, timezone: input.timezone, contactEmail: input.contactEmail, contactPhone: input.contactPhone, whatsappPhone: input.whatsappPhone },
    });
    const prefix = prefixFromSlug(input.slug);
    await this.orgDb.run(id, async (tx) => {
      await tx.orgSettings.create({ data: { receiptPrefix: prefix, statementPrefix: prefix, bookingPrefix: prefix } as never });
      await this.audit.record(tx, { actor: { userId: actorUserId, memberId: null }, action: 'operator.create', entity: 'organization', entityId: id, after: input });
    });
    return (await this.list()).find((o) => o.id === id)!;
  }

  async setStatus(id: string, status: 'active' | 'suspended', actorUserId: string) {
    const r = await this.prisma.organization.updateMany({ where: { id }, data: { status } });
    if (!r.count) throw notFound('Operator');
    await this.orgDb.run(id, (tx) => this.audit.record(tx, { actor: { userId: actorUserId, memberId: null }, action: `operator.${status}`, entity: 'organization', entityId: id }));
    return { ok: true };
  }

  /** Writes the invitation row directly: the platform admin is not a member, so Better Auth's member-scoped invite API can't be used. */
  async inviteAdmin(orgId: string, email: string, actorUserId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw notFound('Operator');
    await this.prisma.invitation.updateMany({ where: { organizationId: orgId, email, status: 'pending' }, data: { status: 'canceled' } });
    const inv = await this.prisma.invitation.create({
      data: { id: randomUUID(), organizationId: orgId, email, role: 'admin', status: 'pending', expiresAt: new Date(Date.now() + 7 * 86_400_000), inviterId: actorUserId },
    });
    await this.sendInvite(inv.id, email, org.name, 'admin');
    await this.orgDb.run(orgId, (tx) => this.audit.record(tx, { actor: { userId: actorUserId, memberId: null }, action: 'invitation.create', entity: 'invitation', entityId: inv.id, after: { role: 'admin' } }));
    return { id: inv.id, email, role: 'admin', status: 'pending', expiresAt: inv.expiresAt.toISOString() };
  }

  async resend(invitationId: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { id: invitationId }, include: { organization: true } });
    if (!inv || inv.status !== 'pending') throw notFound('Invitation');
    await this.prisma.invitation.update({ where: { id: inv.id }, data: { expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
    await this.sendInvite(inv.id, inv.email, inv.organization.name, (inv.role ?? 'admin') as OrgRole);
    return { ok: true };
  }

  async revoke(invitationId: string) {
    const r = await this.prisma.invitation.updateMany({ where: { id: invitationId, status: 'pending' }, data: { status: 'canceled' } });
    if (!r.count) throw new AppError('NOT_FOUND', 404, 'Invitation not found or not pending');
    return { ok: true };
  }

  private async sendInvite(id: string, email: string, orgName: string, role: OrgRole) {
    const url = `${loadEnv().APP_ORIGIN}/auth/accept-invite/${id}`;
    await this.mailer.send({ to: email, ...inviteEmail({ orgName, role, url }) });
  }
}
```

`apps/api/src/modules/platform/platform.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { CreateOperatorInput, InviteFirstAdminInput } from '@boogbe/shared';
import { Ctx, PlatformAdmin } from '../../common/auth/decorators';
import type { RequestCtx } from '../../common/auth/request-ctx';
import { PlatformService } from './platform.service';

class CreateOperatorDto extends createZodDto(CreateOperatorInput) {}
class InviteDto extends createZodDto(InviteFirstAdminInput) {}

@Controller('platform')
@PlatformAdmin()
export class PlatformController {
  constructor(private readonly svc: PlatformService) {}
  @Get('operators') async list() { return { items: await this.svc.list() }; }
  @Post('operators') create(@Body() b: CreateOperatorDto, @Ctx() c: RequestCtx) { return this.svc.createOperator(b, c.userId); }
  @Get('operators/:id') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post('operators/:id/suspend') @HttpCode(200) suspend(@Param('id') id: string, @Ctx() c: RequestCtx) { return this.svc.setStatus(id, 'suspended', c.userId); }
  @Post('operators/:id/reactivate') @HttpCode(200) reactivate(@Param('id') id: string, @Ctx() c: RequestCtx) { return this.svc.setStatus(id, 'active', c.userId); }
  @Post('operators/:id/invite-admin') invite(@Param('id') id: string, @Body() b: InviteDto, @Ctx() c: RequestCtx) { return this.svc.inviteAdmin(id, b.email, c.userId); }
  @Post('invitations/:id/resend') @HttpCode(200) resend(@Param('id') id: string) { return this.svc.resend(id); }
  @Post('invitations/:id/revoke') @HttpCode(200) revoke(@Param('id') id: string) { return this.svc.revoke(id); }
}
```
`platform.module.ts`: `@Module({ controllers: [PlatformController], providers: [PlatformService] })`.

Class-level `@PlatformAdmin()` satisfies `route-permissions.spec.ts` (it reads handler then class).

`apps/api/src/modules/invitations/invitations.controller.ts`:
```ts
import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { OrgRole, PublicInvitation } from '@boogbe/shared';
import { PrismaService } from '../../common/db/prisma.service';
import { Public } from '../../common/auth/decorators';
import { notFound } from '../../common/http/app-error';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/public')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async publicView(@Param('id') id: string): Promise<PublicInvitation> {
    const inv = await this.prisma.invitation.findUnique({ where: { id }, include: { organization: { select: { name: true } } } });
    if (!inv) throw notFound('Invitation');
    const userExists = !!(await this.prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } }));
    return { id: inv.id, email: inv.email, orgName: inv.organization.name, role: (inv.role ?? 'admin') as OrgRole, status: inv.status, expired: inv.expiresAt < new Date(), userExists };
  }
}
```
Add `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])` to `AppModule` imports and `{ provide: APP_GUARD, useClass: ThrottlerGuard }` **before** the `SessionGuard` provider. In `NODE_ENV=test` use `limit: 10_000`.

`apps/api/src/modules/org/org.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { OrgSettingsResponse, UpdateOrgSettingsInput } from '@boogbe/shared';
import { PrismaService } from '../../common/db/prisma.service';
import { OrgDb } from '../../common/db/org-db.service';
import { AuditService } from '../../common/audit/audit.service';
import type { OrgCtx } from '../../common/auth/request-ctx';

const ORG_FIELDS = ['name', 'contactEmail', 'contactPhone', 'whatsappPhone', 'address'] as const;

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService, private readonly orgDb: OrgDb, private readonly audit: AuditService) {}

  async get(ctx: OrgCtx): Promise<OrgSettingsResponse> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
    const s = await this.orgDb.run(ctx.orgId, (tx) => tx.orgSettings.findFirstOrThrow());
    return {
      org: { id: org.id, name: org.name, slug: org.slug, timezone: org.timezone, currency: org.currency, contactEmail: org.contactEmail, contactPhone: org.contactPhone, whatsappPhone: org.whatsappPhone, address: org.address },
      settings: { checkInTime: s.checkInTime, checkOutTime: s.checkOutTime, holdHours: s.holdHours, autoConfirmOnPayment: s.autoConfirmOnPayment, ownerSeesGuestNames: s.ownerSeesGuestNames, receiptPrefix: s.receiptPrefix, statementPrefix: s.statementPrefix, bookingPrefix: s.bookingPrefix },
    };
  }

  async update(ctx: OrgCtx, input: UpdateOrgSettingsInput): Promise<OrgSettingsResponse> {
    const before = await this.get(ctx);
    const orgPatch = Object.fromEntries(ORG_FIELDS.filter((k) => k in input).map((k) => [k, input[k]]));
    const settingsPatch = Object.fromEntries(Object.entries(input).filter(([k]) => !(ORG_FIELDS as readonly string[]).includes(k)));
    if (Object.keys(orgPatch).length) await this.prisma.organization.updateMany({ where: { id: ctx.orgId }, data: orgPatch });
    await this.orgDb.run(ctx.orgId, async (tx) => {
      if (Object.keys(settingsPatch).length) await tx.orgSettings.updateMany({ data: settingsPatch });
      await this.audit.record(tx, { actor: ctx, action: 'settings.update', entity: 'org_settings', entityId: ctx.orgId, before, after: input });
    });
    return this.get(ctx);
  }
}
```
`org.controller.ts`:
```ts
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { UpdateOrgSettingsInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { OrgService } from './org.service';

class UpdateDto extends createZodDto(UpdateOrgSettingsInput) {}

@Controller('org')
export class OrgController {
  constructor(private readonly svc: OrgService) {}
  @Get('settings') @Permission('org.settings.read') get(@Ctx() c: RequestCtx) { return this.svc.get(requireOrg(c)); }
  @Patch('settings') @Permission('org.settings.write') update(@Ctx() c: RequestCtx, @Body() b: UpdateDto) { return this.svc.update(requireOrg(c), b); }
}
```
(OrgService injects PrismaService for the global `organization` table → add `'modules/org/'` to `PRISMA_ALLOWED` in `tenant-isolation.spec.ts` with a comment "organization table is global".)

Register `PlatformModule`, `InvitationsModule`, `OrgModule` in `AppModule`.

`apps/api/scripts/create-platform-admin.ts`:
```ts
/** Usage: PLATFORM_ADMIN_EMAILS=you@x.com pnpm --filter @boogbe/api create-platform-admin -- you@x.com "Your Name" 'password' */
import { PrismaClient } from '@prisma/client';
import { createAuth } from '../src/common/auth/auth';
import { MemoryMailer } from '../src/common/mail/mailer';
import { loadEnv } from '../src/env';

async function main() {
  const [email, name, password] = process.argv.slice(2);
  if (!email || !name || !password) throw new Error('usage: <email> <name> <password>');
  const env = loadEnv();
  if (!env.PLATFORM_ADMIN_EMAILS.includes(email.toLowerCase())) throw new Error('email must be listed in PLATFORM_ADMIN_EMAILS');
  const prisma = new PrismaClient();
  const auth = createAuth({ prisma, mailer: new MemoryMailer(), env });
  const r = await auth.api.signUpEmail({ body: { email, name, password } });
  await prisma.user.update({ where: { id: r.user.id }, data: { role: 'admin', emailVerified: true } });
  console.log(`platform admin ${email} created`);
  await prisma.$disconnect();
}
void main();
```

- [ ] **Step 5: Un-todo guard tests**

In `apps/api/test/guards.int.ts` change the two `it.todo` back to `it` with their bodies.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: PASS (platform 6, guards 7, plus earlier).

- [ ] **Step 7: Commit**
```bash
git add apps/api packages/shared
git commit -m "feat(platform): operators, first-admin invitations, org settings [PLT-01..05 ORG-02 ORG-03]"
```

---

### Task 9 (T-M0-09) [api]: Team management rules via Better Auth hooks

**Files:**
- Modify: `apps/api/src/common/auth/auth.ts` (add `organizationHooks`)
- Create: `apps/api/src/common/auth/membership-rules.ts`
- Test: `apps/api/test/members.int.ts`, `apps/api/src/common/auth/membership-rules.spec.ts`

**Interfaces:**
- Produces: `assertNotLastAdmin(prisma, orgId: string, memberId: string, nextRole: OrgRole | null): Promise<void>` (throws `APIError('BAD_REQUEST', { message: 'An operator needs at least one admin', code: 'LAST_ADMIN' })`); `assertKnownRole(role: string): asserts role is OrgRole`.
- App uses Better Auth client endpoints for team management: `organization.inviteMember`, `organization.updateMemberRole`, `organization.removeMember`, `organization.cancelInvitation`, `organization.listInvitations`, `organization.getFullOrganization`.

- [ ] **Step 1: Write failing tests**

`apps/api/src/common/auth/membership-rules.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { assertKnownRole } from './membership-rules';
describe('assertKnownRole', () => {
  it('accepts boogbe roles and rejects better-auth defaults', () => {
    expect(() => assertKnownRole('frontdesk')).not.toThrow();
    expect(() => assertKnownRole('owner')).toThrow();
    expect(() => assertKnownRole('member')).toThrow();
  });
});
```
`apps/api/test/members.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { MAILER } from '../src/common/mail/mail.module';
import type { MemoryMailer } from '../src/common/mail/mailer';

describe('team management [AUTH-04 AUTH-08]', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await truncateAll(); });

  it('admin invites a housekeeper by email', async () => {
    const org = await seedOrg('Tanuhomes');
    const { agent } = await signInAs(t, 'admin', org.id);
    const r = await agent.post('/v1/auth/organization/invite-member').send({ email: 'hk@t.ng', role: 'housekeeper', organizationId: org.id });
    expect(r.status).toBe(200);
    expect(t.app.get<MemoryMailer>(MAILER).lastTo('hk@t.ng')!.text).toContain('Housekeeper');
  });

  it('frontdesk cannot invite', async () => {
    const org = await seedOrg();
    const { agent } = await signInAs(t, 'frontdesk', org.id);
    const r = await agent.post('/v1/auth/organization/invite-member').send({ email: 'x@t.ng', role: 'admin', organizationId: org.id });
    expect(r.status).toBe(403);
  });

  it('rejects unknown roles such as owner', async () => {
    const org = await seedOrg();
    const { agent } = await signInAs(t, 'admin', org.id);
    const r = await agent.post('/v1/auth/organization/invite-member').send({ email: 'x@t.ng', role: 'owner', organizationId: org.id });
    expect(r.status).toBe(400);
  });

  it('cannot demote the last admin via better-auth endpoint', async () => {
    const org = await seedOrg();
    const { agent, memberId } = await signInAs(t, 'admin', org.id);
    const r = await agent.post('/v1/auth/organization/update-member-role').send({ memberId, role: 'frontdesk', organizationId: org.id });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('at least one admin');
  });

  it('cannot remove the last admin', async () => {
    const org = await seedOrg();
    const { agent, memberId } = await signInAs(t, 'admin', org.id);
    const r = await agent.post('/v1/auth/organization/remove-member').send({ memberIdOrEmail: memberId, organizationId: org.id });
    expect(r.status).toBe(400);
  });

  it('with two admins one can be demoted and it is audited', async () => {
    const org = await seedOrg();
    const a1 = await signInAs(t, 'admin', org.id);
    const a2 = await signInAs(t, 'admin', org.id);
    await a1.agent.post('/v1/auth/organization/update-member-role').send({ memberId: a2.memberId, role: 'frontdesk', organizationId: org.id }).expect(200);
    const m = await migratorClient();
    const { rows } = await m.query(`select action from audit_log where org_id=$1`, [org.id]);
    await m.end();
    expect(rows.map((r) => r.action)).toContain('member.role_change');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: FAIL — `membership-rules` missing; last-admin tests return 200.

- [ ] **Step 3: Implement**

`apps/api/src/common/auth/membership-rules.ts`:
```ts
import type { PrismaClient } from '@prisma/client';
import { APIError } from 'better-auth/api';
import { ORG_ROLES, type OrgRole } from '@boogbe/shared';

export function assertKnownRole(role: string): asserts role is OrgRole {
  if (!(ORG_ROLES as readonly string[]).includes(role)) {
    throw new APIError('BAD_REQUEST', { message: `Unknown role "${role}"` });
  }
}

/** nextRole = null means the member is being removed. */
export async function assertNotLastAdmin(prisma: PrismaClient, orgId: string, memberId: string, nextRole: OrgRole | null) {
  const target = await prisma.member.findUnique({ where: { id: memberId } });
  if (!target || target.role !== 'admin' || nextRole === 'admin') return;
  const admins = await prisma.member.count({ where: { organizationId: orgId, role: 'admin' } });
  if (admins <= 1) throw new APIError('BAD_REQUEST', { message: 'An operator needs at least one admin' });
}
```
In `auth.ts`, add to the `organization({...})` options (and a small audit writer that uses raw SQL with `set_config`, because hooks run outside Nest DI):
```ts
        organizationHooks: {
          beforeCreateInvitation: async ({ invitation }) => { assertKnownRole(String(invitation.role)); },
          beforeUpdateMemberRole: async ({ member, newRole, organization: org }) => {
            assertKnownRole(String(newRole));
            await assertNotLastAdmin(prisma, org.id, member.id, newRole as OrgRole);
          },
          afterUpdateMemberRole: async ({ member, previousRole, user, organization: org }) => {
            await writeAudit(prisma, org.id, user.id, 'member.role_change', 'member', member.id, { role: previousRole }, { role: member.role });
          },
          beforeRemoveMember: async ({ member, organization: org }) => {
            await assertNotLastAdmin(prisma, org.id, member.id, null);
          },
          afterRemoveMember: async ({ member, user, organization: org }) => {
            await writeAudit(prisma, org.id, user.id, 'member.remove', 'member', member.id, { role: member.role }, null);
          },
          afterAcceptInvitation: async ({ member, user, organization: org }) => {
            await writeAudit(prisma, org.id, user.id, 'member.join', 'member', member.id, null, { role: member.role });
          },
        },
```
and at the bottom of `auth.ts`:
```ts
async function writeAudit(prisma: PrismaClient, orgId: string, actorUserId: string, action: string, entity: string, entityId: string, before: unknown, after: unknown) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
    await tx.$executeRaw`INSERT INTO audit_log (id, org_id, actor_user_id, action, entity, entity_id, before, after, at)
      VALUES (${randomUUID()}, ${orgId}, ${actorUserId}, ${action}, ${entity}, ${entityId}, ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb, now())`;
  });
}
```
Hook parameter names must match the installed Better Auth version's types; if `tsc` reports a different shape (e.g. `previousRole` absent), read the role before the update in the `before` hook and pass it via a `Map<memberId, role>` local to `createAuth`. The tests define the behaviour.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @boogbe/api test && pnpm test:int`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/api
git commit -m "feat(auth): role whitelist, last-admin guard and member audit via org hooks [AUTH-04 AUTH-08]"
```

---

### Task 10 (T-M0-10) [infra]: Worker process, job runner, cross-tenant isolation harness

**Files:**
- Create: `apps/api/src/worker.ts`, `apps/api/src/worker.module.ts`, `apps/api/src/common/jobs/job-runner.ts`, `apps/api/src/common/jobs/jobs.module.ts`
- Create: `apps/api/test/helpers/routes.ts`, `apps/api/test/isolation.int.ts`, `apps/api/test/jobs.int.ts`

**Interfaces:**
- Produces: `class JobRunner { forEachActiveOrg(name: string, fn: (org: { id: string; timezone: string }) => Promise<void>): Promise<{ ok: number; failed: number }>; once(name: string, fn: () => Promise<void>): Promise<void> }` — writes `job_run` rows; one org failing never stops the others.
- `WorkerModule` = `AppModule` minus controllers + `ScheduleModule.forRoot()` + `JobsModule`; job classes are added to `WorkerModule.providers` by later milestones.
- `listRoutes(app): { method: string; path: string; access: AccessRule }[]` for the isolation harness.
- `isolation.int.ts` contract: **every** route with `kind: 'permission'` and a `:id`-style param is called by an admin of org A with ids that belong to org B → expect `404` (or `400` for validation) — never `200`. Later milestones register fixtures for their resources in `ISOLATION_FIXTURES` (exported map `resourceName → (orgId) => Promise<string /*id*/>`).

- [ ] **Step 1: Write failing tests**

`apps/api/test/jobs.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { WorkerModule } from '../src/worker.module';
import { JobRunner } from '../src/common/jobs/job-runner';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';

describe('JobRunner', () => {
  let runner: JobRunner; let close: () => Promise<void>;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const mod = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await mod.init();
    runner = mod.get(JobRunner); close = () => mod.close();
  });
  afterAll(async () => { await close(); });
  beforeEach(async () => { await truncateAll(); });

  it('runs per active org, isolates failures and records job_run rows', async () => {
    const a = await seedOrg('A'); const b = await seedOrg('B'); const s = await seedOrg('S');
    const m = await migratorClient();
    await m.query(`update organization set status='suspended' where id=$1`, [s.id]);
    const seen: string[] = [];
    const r = await runner.forEachActiveOrg('test.job', async (org) => {
      seen.push(org.id);
      if (org.id === a.id) throw new Error('boom');
    });
    expect(r).toEqual({ ok: 1, failed: 1 });
    expect(seen.sort()).toEqual([a.id, b.id].sort());
    const { rows } = await m.query(`select org_id, ok, error from job_run where name='test.job' order by ok`);
    await m.end();
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ org_id: a.id, ok: false, error: 'boom' }), expect.objectContaining({ org_id: b.id, ok: true })]));
  });
});
```

`apps/api/test/helpers/routes.ts`:
```ts
import type { INestApplication } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { ACCESS_KEY, type AccessRule } from '../../src/common/auth/decorators';

export function listRoutes(app: INestApplication) {
  const discovery = app.get(DiscoveryService); const scanner = app.get(MetadataScanner); const reflector = app.get(Reflector);
  const out: { method: string; path: string; access: AccessRule }[] = [];
  const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  for (const c of discovery.getControllers()) {
    const base = Reflect.getMetadata('path', c.metatype) as string;
    const proto = Object.getPrototypeOf(c.instance);
    for (const name of scanner.getAllMethodNames(proto)) {
      const h = proto[name];
      const sub = Reflect.getMetadata('path', h) as string | undefined;
      if (sub === undefined) continue;
      const method = METHODS[Reflect.getMetadata('method', h) as number]!;
      const access = reflector.getAllAndOverride<AccessRule>(ACCESS_KEY, [h, c.metatype]);
      out.push({ method, path: `/v1/${[base, sub].filter((s) => s && s !== '/').join('/')}`.replace(/\/+/g, '/'), access });
    }
  }
  return out;
}

/** Later milestones add an entry per resource: given an org id, create a resource in that org and return its id. */
export const ISOLATION_FIXTURES: Record<string, (orgId: string) => Promise<string>> = {};
/** Maps a route param name to the fixture that produces a valid id for it. */
export const PARAM_FIXTURE: Record<string, string> = {};
```
(`DiscoveryModule` must be imported by `AppModule` for `DiscoveryService` to resolve — add it.)

`apps/api/test/isolation.int.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { ISOLATION_FIXTURES, listRoutes, PARAM_FIXTURE } from './helpers/routes';

describe('cross-tenant isolation [NFR-01]', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); await truncateAll(); });
  afterAll(async () => { await t.close(); });

  it('an admin of org A gets 404 for every org-B resource on every permission route', async () => {
    const a = await seedOrg('A'); const b = await seedOrg('B');
    const { agent } = await signInAs(t, 'admin', a.id);
    const routes = listRoutes(t.app).filter((r) => r.access.kind === 'permission' && /:\w+/.test(r.path));
    const leaks: string[] = []; const unmapped: string[] = [];
    for (const r of routes) {
      let path = r.path;
      for (const [, param] of r.path.matchAll(/:(\w+)/g)) {
        const fixture = PARAM_FIXTURE[param!];
        if (!fixture) { unmapped.push(`${r.method} ${r.path} (:${param})`); continue; }
        path = path.replace(`:${param}`, await ISOLATION_FIXTURES[fixture]!(b.id));
      }
      if (/:\w+/.test(path)) continue;
      const res = await agent[r.method.toLowerCase() as 'get'](path).send({});
      if (![400, 404].includes(res.status)) leaks.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(unmapped, 'Register a fixture in test/helpers/routes.ts for these params').toEqual([]);
    expect(leaks).toEqual([]);
  });
});
```
(With M0's routes there are no permission routes with params, so the test passes vacuously but is wired; each later milestone's plan registers fixtures.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:int`
Expected: FAIL — `worker.module` missing.

- [ ] **Step 3: Implement**

`apps/api/src/common/jobs/job-runner.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { newId } from '../db/ids';

@Injectable()
export class JobRunner {
  private readonly log = new Logger('Jobs');
  constructor(private readonly prisma: PrismaService) {}

  async forEachActiveOrg(name: string, fn: (org: { id: string; timezone: string }) => Promise<void>) {
    const orgs = await this.prisma.organization.findMany({ where: { status: 'active' }, select: { id: true, timezone: true } });
    let ok = 0; let failed = 0;
    for (const org of orgs) {
      const id = newId();
      await this.prisma.jobRun.create({ data: { id, name, orgId: org.id } });
      try {
        await fn(org);
        ok++;
        await this.prisma.jobRun.update({ where: { id }, data: { ok: true, finishedAt: new Date() } });
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        this.log.error(`${name} org=${org.id}: ${msg}`);
        await this.prisma.jobRun.update({ where: { id }, data: { ok: false, error: msg.slice(0, 2000), finishedAt: new Date() } });
      }
    }
    return { ok, failed };
  }

  async once(name: string, fn: () => Promise<void>) {
    const id = newId();
    await this.prisma.jobRun.create({ data: { id, name } });
    try {
      await fn();
      await this.prisma.jobRun.update({ where: { id }, data: { ok: true, finishedAt: new Date() } });
    } catch (e) {
      await this.prisma.jobRun.update({ where: { id }, data: { ok: false, error: String(e).slice(0, 2000), finishedAt: new Date() } });
      throw e;
    }
  }
}
```
`jobs.module.ts`: `@Global() @Module({ providers: [JobRunner], exports: [JobRunner] }) export class JobsModule {}`
`apps/api/src/worker.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from './common/db/db.module';
import { MailModule } from './common/mail/mail.module';
import { AuthModule } from './common/auth/auth.module';
import { AuditModule } from './common/audit/audit.module';
import { JobsModule } from './common/jobs/jobs.module';

/** Cron jobs only. Later milestones add their *.jobs.ts providers here. */
@Module({
  imports: [ScheduleModule.forRoot(), DbModule, MailModule, AuthModule, AuditModule, JobsModule],
  providers: [],
})
export class WorkerModule {}
```
`apps/api/src/worker.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { loadEnv } from './env';

async function main() {
  loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}
void main();
```
`AppModule` must **not** import `ScheduleModule` (crons never run in the API process).

- [ ] **Step 4: Run tests**

Run: `pnpm test:int`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/api
git commit -m "feat(jobs): worker process, per-org job runner and cross-tenant route harness [NFR-01 NFR-08]"
```

---

### Task 11 (T-M0-11) [ui]: App scaffold, UI primitives, API + auth clients, sign-in, accept invite, password reset

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/src/index.ts`, `packages/ui/src/tokens.css`, `packages/ui/src/{Button,Input,Field,Card,Badge,Spinner,EmptyState,Select}.tsx`
- Create: `apps/app/package.json`, `apps/app/tsconfig.json`, `apps/app/vite.config.ts`, `apps/app/vitest.config.ts`, `apps/app/index.html`, `apps/app/public/_headers`
- Create: `apps/app/src/{main.tsx,App.tsx,index.css,router.tsx}`, `apps/app/src/lib/{api.ts,auth-client.ts,format.ts,use-me.ts}`, `apps/app/src/test/setup.ts`
- Create: `apps/app/src/routes/auth/{SignIn.tsx,AcceptInvite.tsx,ForgotPassword.tsx,ResetPassword.tsx}`, `apps/app/src/routes/{Home.tsx,NotFound.tsx}`
- Test: `apps/app/src/lib/api.test.ts`, `apps/app/src/routes/auth/SignIn.test.tsx`, `apps/app/src/routes/auth/AcceptInvite.test.tsx`

**Interfaces:**
- Produces: `api<T>(path: string, init?: { method?: string; body?: unknown; schema?: ZodType<T> }): Promise<T>` throwing `ApiError { code: ErrorCode; message: string; status: number; details?: unknown }`; `useApi<T>(path: string | null, schema?: ZodType<T>)` (SWR); `authClient` (better-auth/react with `organizationClient()` + `adminClient()`); `useMe(): { me: MeResponse | undefined; isLoading; mutate }`; UI components: `Button({ variant: 'primary'|'secondary'|'danger'|'ghost', loading?, ...buttonProps })`, `Input`, `Field({ label, error?, hint?, children })`, `Card`, `Badge({ tone: 'neutral'|'success'|'warning'|'danger'|'info' })`, `Spinner`, `EmptyState({ title, body?, action? })`, `Select`.

- [ ] **Step 1: Packages**

`packages/ui/package.json`:
```json
{
  "name": "@boogbe/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" },
  "peerDependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },
  "dependencies": { "clsx": "^2.1.1" },
  "devDependencies": { "@types/react": "^18.3.11", "@types/react-dom": "^18.3.0", "typescript": "^5.6.3", "react": "^18.3.1", "react-dom": "^18.3.1" }
}
```
`packages/ui/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM"] }, "include": ["src"] }`

`packages/ui/src/tokens.css` (Tailwind 4 theme tokens; light + dark):
```css
@theme {
  --color-ink: #182d32;
  --color-ink-muted: #5b6d72;
  --color-surface: #ffffff;
  --color-surface-2: #f4f6f5;
  --color-line: #dfe5e3;
  --color-brand: #0f6b5c;
  --color-brand-ink: #ffffff;
  --color-success: #1f7a4d;
  --color-warning: #a35d00;
  --color-danger: #b42318;
  --color-info: #175cd3;
  --radius-card: 14px;
  --font-sans: 'Inter', system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-ink: #e8eeec; --color-ink-muted: #9fb0ab; --color-surface: #0f1715; --color-surface-2: #16211e;
    --color-line: #26332f; --color-brand: #3fb59b; --color-brand-ink: #06231d;
  }
}
```
`packages/ui/src/Button.tsx`:
```tsx
import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const styles: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink hover:opacity-90',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
  ghost: 'text-ink hover:bg-surface-2',
};
export function Button({ variant = 'primary', loading, disabled, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx('inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium disabled:opacity-50', styles[variant], className)}
    >
      {loading && <Spinner size={16} />}
      {children}
    </button>
  );
}
```
`packages/ui/src/Spinner.tsx`:
```tsx
export function Spinner({ size = 20 }: { size?: number }) {
  return <span role="status" aria-label="Loading" style={{ width: size, height: size }} className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent" />;
}
```
`packages/ui/src/Input.tsx`:
```tsx
import clsx from 'clsx';
import { forwardRef, type InputHTMLAttributes } from 'react';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} {...rest} className={clsx('min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-brand aria-[invalid=true]:border-danger', className)} />;
});
```
`packages/ui/src/Select.tsx`:
```tsx
import clsx from 'clsx';
import { forwardRef, type SelectHTMLAttributes } from 'react';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} {...rest} className={clsx('min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-ink', className)} />;
});
```
`packages/ui/src/Field.tsx`:
```tsx
import { cloneElement, isValidElement, useId, type ReactElement } from 'react';
export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactElement }) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
      {isValidElement(children) ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, 'aria-invalid': !!error, 'aria-describedby': describedBy }) : children}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-ink-muted">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
```
`packages/ui/src/Card.tsx`:
```tsx
import clsx from 'clsx';
import type { HTMLAttributes } from 'react';
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={clsx('rounded-[var(--radius-card)] border border-line bg-surface p-4', className)} />;
}
```
`packages/ui/src/Badge.tsx`:
```tsx
import clsx from 'clsx';
import type { ReactNode } from 'react';
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink', success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', danger: 'bg-danger/10 text-danger', info: 'bg-info/10 text-info',
};
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}
```
`packages/ui/src/EmptyState.tsx`:
```tsx
import type { ReactNode } from 'react';
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-line p-8 text-center">
      <p className="font-medium text-ink">{title}</p>
      {body && <p className="max-w-sm text-sm text-ink-muted">{body}</p>}
      {action}
    </div>
  );
}
```
`packages/ui/src/index.ts`:
```ts
export * from './Button'; export * from './Input'; export * from './Select'; export * from './Field';
export * from './Card'; export * from './Badge'; export * from './Spinner'; export * from './EmptyState';
```

`apps/app/package.json`:
```json
{
  "name": "@boogbe/app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc --noEmit && vite build", "preview": "vite preview", "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@boogbe/shared": "workspace:*",
    "@boogbe/ui": "workspace:*",
    "@hookform/resolvers": "^5.0.0",
    "better-auth": "^1.3.0",
    "date-fns": "^4.1.0",
    "lucide-react": "^0.453.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.53.0",
    "react-router-dom": "^6.27.0",
    "swr": "^2.2.5",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.2",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.3",
    "vite": "^5.4.9",
    "vitest": "^2.1.9"
  }
}
```
`apps/app/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["vite/client", "@testing-library/jest-dom"] }, "include": ["src"] }`
`apps/app/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [react(), tailwind()],
  server: { port: 5173, proxy: { '/v1': 'http://localhost:3060' } },
  build: { sourcemap: true },
});
```
`apps/app/vitest.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
export default defineConfig({ plugins: [react()], test: { environment: 'jsdom', setupFiles: ['src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'] } });
```
`apps/app/src/test/setup.ts`: `import '@testing-library/jest-dom/vitest';`
`apps/app/index.html`:
```html
<!doctype html>
<html lang="en-NG">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Boogbe</title>
  </head>
  <body class="bg-surface-2 text-ink">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```
`apps/app/public/_headers`:
```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; connect-src 'self' https://api.boogbe.com https://staging-api.boogbe.com; img-src 'self' data: blob: https://*.r2.cloudflarestorage.com; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'
```
`apps/app/src/index.css`:
```css
@import 'tailwindcss';
@import '@boogbe/ui/src/tokens.css';
@source '../../../packages/ui/src';
```

- [ ] **Step 2: Write failing tests**

`apps/app/src/lib/api.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { api, ApiError } from './api';

afterEach(() => vi.restoreAllMocks());

describe('api', () => {
  it('sends credentials and JSON, parses with schema', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ n: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const r = await api('/v1/x', { method: 'POST', body: { a: 1 }, schema: z.object({ n: z.number() }) });
    expect(r).toEqual({ n: 1 });
    expect(f).toHaveBeenCalledWith('/v1/x', expect.objectContaining({ method: 'POST', credentials: 'include', body: '{"a":1}' }));
  });
  it('throws ApiError with code from the envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'DATES_UNAVAILABLE', message: 'Taken' } }), { status: 409 }));
    await expect(api('/v1/x')).rejects.toMatchObject({ code: 'DATES_UNAVAILABLE', status: 409, message: 'Taken' });
    await expect(api('/v1/x')).rejects.toBeInstanceOf(ApiError);
  });
  it('maps network failure to a friendly error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/v1/x')).rejects.toMatchObject({ code: 'INTERNAL', message: 'Network problem — check your connection and try again.' });
  });
});
```
`apps/app/src/routes/auth/SignIn.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SignIn } from './SignIn';

vi.mock('../../lib/auth-client', () => ({
  authClient: { signIn: { email: vi.fn().mockResolvedValue({ error: { status: 401, message: 'Invalid email or password' } }) } },
}));

describe('SignIn', () => {
  it('shows validation then server errors', async () => {
    render(<MemoryRouter><SignIn /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/enter a valid email/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.ng');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});
```
`apps/app/src/routes/auth/AcceptInvite.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AcceptInvite } from './AcceptInvite';

vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api: vi.fn().mockResolvedValue({ id: 'i1', email: 'a@t.ng', orgName: 'Tanuhomes', role: 'housekeeper', status: 'pending', expired: false, userExists: false }),
}));
vi.mock('../../lib/auth-client', () => ({ authClient: { useSession: () => ({ data: null, isPending: false }) } }));

describe('AcceptInvite', () => {
  it('shows org, role and a create-account form for new users', async () => {
    render(<MemoryRouter initialEntries={['/auth/accept-invite/i1']}><Routes><Route path="/auth/accept-invite/:id" element={<AcceptInvite />} /></Routes></MemoryRouter>);
    expect(await screen.findByText(/join tanuhomes as housekeeper/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('a@t.ng')).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm install && pnpm --filter @boogbe/app test`
Expected: FAIL — modules missing.

- [ ] **Step 4: Implement**

`apps/app/src/lib/api.ts`:
```ts
import useSWR from 'swr';
import type { ZodType } from 'zod';
import type { ErrorCode } from '@boogbe/shared';

const ORIGIN = import.meta.env.VITE_API_ORIGIN ?? '';

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public status: number, public details?: unknown) { super(message); }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; schema?: ZodType<T> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ORIGIN}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError('INTERNAL', 'Network problem — check your connection and try again.', 0);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(e?.code ?? 'INTERNAL', e?.message ?? 'Something went wrong', res.status, e?.details);
  }
  return init.schema ? init.schema.parse(json) : (json as T);
}

export function useApi<T>(path: string | null, schema?: ZodType<T>) {
  return useSWR<T, ApiError>(path, (p: string) => api<T>(p, { schema }));
}
```
`apps/app/src/lib/auth-client.ts`:
```ts
import { createAuthClient } from 'better-auth/react';
import { adminClient, organizationClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: `${import.meta.env.VITE_API_ORIGIN || window.location.origin}`,
  basePath: '/v1/auth',
  fetchOptions: { credentials: 'include' },
  plugins: [organizationClient(), adminClient()],
});
```
`apps/app/src/lib/use-me.ts`:
```ts
import { MeResponse } from '@boogbe/shared';
import { useApi } from './api';
export function useMe() {
  const { data, isLoading, mutate, error } = useApi('/v1/me', MeResponse);
  return { me: data, isLoading, mutate, error };
}
```
`apps/app/src/lib/format.ts`:
```ts
import { formatNaira } from '@boogbe/shared';
export { formatNaira };
const d = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** '2026-10-09' → '9 Oct 2026' */
export const formatDate = (iso: string) => d.format(new Date(`${iso}T00:00:00Z`));
```
`apps/app/src/routes/auth/SignIn.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, Field, Input } from '@boogbe/ui';
import { authClient } from '../../lib/auth-client';

const Schema = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') });

export function SignIn() {
  const nav = useNavigate(); const [params] = useSearchParams();
  const [serverError, setServerError] = useState<string>();
  const { register, handleSubmit, formState } = useForm<z.infer<typeof Schema>>({ resolver: zodResolver(Schema) });
  const onSubmit = handleSubmit(async (v) => {
    setServerError(undefined);
    const r = await authClient.signIn.email(v);
    if (r.error) return setServerError(r.error.status === 429 ? 'Too many attempts. Try again in 15 minutes.' : 'Invalid email or password');
    nav(params.get('next') ?? '/', { replace: true });
  });
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <h1 className="mb-6 text-2xl font-semibold">Sign in to Boogbe</h1>
      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field label="Email" error={formState.errors.email?.message}><Input type="email" autoComplete="email" {...register('email')} /></Field>
          <Field label="Password" error={formState.errors.password?.message}><Input type="password" autoComplete="current-password" {...register('password')} /></Field>
          {serverError && <p role="alert" className="text-sm text-danger">{serverError}</p>}
          <Button type="submit" loading={formState.isSubmitting}>Sign in</Button>
          <Link to="/auth/forgot" className="text-sm text-brand">Forgot password?</Link>
        </form>
      </Card>
    </main>
  );
}
```
`apps/app/src/routes/auth/AcceptInvite.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { PublicInvitation, ROLE_LABELS } from '@boogbe/shared';
import { Button, Card, EmptyState, Field, Input, Spinner } from '@boogbe/ui';
import { api } from '../../lib/api';
import { authClient } from '../../lib/auth-client';

const NewUser = z.object({ name: z.string().trim().min(2, 'Enter your name'), password: z.string().min(10, 'At least 10 characters') });
const Existing = z.object({ password: z.string().min(1, 'Enter your password') });

export function AcceptInvite() {
  const { id = '' } = useParams(); const nav = useNavigate();
  const [inv, setInv] = useState<PublicInvitation | null>(); const [err, setErr] = useState<string>();
  useEffect(() => { api(`/v1/invitations/${id}/public`, { schema: PublicInvitation }).then(setInv).catch(() => setInv(null)); }, [id]);
  const form = useForm<{ name?: string; password: string }>({ resolver: zodResolver(inv?.userExists ? Existing : NewUser) as never });

  if (inv === undefined) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
  if (inv === null || inv.status !== 'pending' || inv.expired)
    return <main className="mx-auto max-w-sm p-4 pt-24"><EmptyState title="This invitation is no longer valid" body="Ask the person who invited you to send a new one." /></main>;

  const onSubmit = form.handleSubmit(async (v) => {
    setErr(undefined);
    const r = inv.userExists
      ? await authClient.signIn.email({ email: inv.email, password: v.password })
      : await authClient.signUp.email({ email: inv.email, password: v.password, name: v.name! });
    if (r.error) return setErr(r.error.message ?? 'Could not continue');
    const a = await authClient.organization.acceptInvitation({ invitationId: inv.id });
    if (a.error) return setErr(a.error.message ?? 'Could not accept the invitation');
    await authClient.organization.setActive({ organizationId: a.data!.member.organizationId });
    nav('/', { replace: true });
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <h1 className="mb-1 text-2xl font-semibold">Join {inv.orgName} as {ROLE_LABELS[inv.role]}</h1>
      <p className="mb-6 text-sm text-ink-muted">{inv.userExists ? 'Sign in to accept.' : 'Create your Boogbe account to accept.'}</p>
      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field label="Email"><Input value={inv.email} disabled readOnly /></Field>
          {!inv.userExists && <Field label="Your name" error={form.formState.errors.name?.message}><Input autoComplete="name" {...form.register('name')} /></Field>}
          <Field label="Password" error={form.formState.errors.password?.message} hint={inv.userExists ? undefined : 'At least 10 characters'}>
            <Input type="password" autoComplete={inv.userExists ? 'current-password' : 'new-password'} {...form.register('password')} />
          </Field>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <Button type="submit" loading={form.formState.isSubmitting}>Accept invitation</Button>
        </form>
      </Card>
    </main>
  );
}
```
`apps/app/src/routes/auth/ForgotPassword.tsx`:
```tsx
import { useState } from 'react';
import { Button, Card, Field, Input } from '@boogbe/ui';
import { authClient } from '../../lib/auth-client';

export function ForgotPassword() {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <h1 className="mb-6 text-2xl font-semibold">Reset your password</h1>
      <Card>
        {sent ? <p>If that email has a Boogbe account, a reset link is on its way. It expires in 1 hour.</p> : (
          <form className="flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/auth/reset` }); setSent(true); setBusy(false); }}>
            <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Button type="submit" loading={busy}>Send reset link</Button>
          </form>
        )}
      </Card>
    </main>
  );
}
```
`apps/app/src/routes/auth/ResetPassword.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Field, Input } from '@boogbe/ui';
import { authClient } from '../../lib/auth-client';

export function ResetPassword() {
  const [params] = useSearchParams(); const nav = useNavigate();
  const [pw, setPw] = useState(''); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  const token = params.get('token') ?? '';
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <h1 className="mb-6 text-2xl font-semibold">Choose a new password</h1>
      <Card>
        <form className="flex flex-col gap-4" onSubmit={async (e) => {
          e.preventDefault();
          if (pw.length < 10) return setErr('At least 10 characters');
          setBusy(true);
          const r = await authClient.resetPassword({ newPassword: pw, token });
          setBusy(false);
          if (r.error) return setErr('This link has expired. Request a new one.');
          nav('/auth/sign-in', { replace: true });
        }}>
          <Field label="New password" error={err} hint="At least 10 characters"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Button type="submit" loading={busy}>Save password</Button>
        </form>
      </Card>
    </main>
  );
}
```
`apps/app/src/routes/NotFound.tsx`:
```tsx
import { EmptyState } from '@boogbe/ui';
export function NotFound() { return <main className="p-8"><EmptyState title="Page not found" /></main>; }
```
`apps/app/src/routes/Home.tsx` (placeholder landing until M1 adds the calendar; it is a real page, not a TODO):
```tsx
import { Card } from '@boogbe/ui';
import { useMe } from '../lib/use-me';
export function Home() {
  const { me } = useMe();
  return <Card><h1 className="text-xl font-semibold">Welcome to {me?.activeOrg?.name}</h1><p className="text-ink-muted">Your calendar will appear here.</p></Card>;
}
```
`apps/app/src/router.tsx` (shell and role areas are completed in Task 12; this version wires auth routes):
```tsx
import { createBrowserRouter } from 'react-router-dom';
import { SignIn } from './routes/auth/SignIn';
import { AcceptInvite } from './routes/auth/AcceptInvite';
import { ForgotPassword } from './routes/auth/ForgotPassword';
import { ResetPassword } from './routes/auth/ResetPassword';
import { Home } from './routes/Home';
import { NotFound } from './routes/NotFound';

export const router = createBrowserRouter([
  { path: '/auth/sign-in', element: <SignIn /> },
  { path: '/auth/accept-invite/:id', element: <AcceptInvite /> },
  { path: '/auth/forgot', element: <ForgotPassword /> },
  { path: '/auth/reset', element: <ResetPassword /> },
  { path: '/', element: <Home /> },
  { path: '*', element: <NotFound /> },
]);
```
`apps/app/src/App.tsx`:
```tsx
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
export function App() { return <RouterProvider router={router} />; }
```
`apps/app/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```

- [ ] **Step 5: Run tests and build**

Run: `pnpm --filter @boogbe/app test && pnpm --filter @boogbe/app build`
Expected: PASS; build writes `apps/app/dist`.

- [ ] **Step 6: Commit**
```bash
git add packages/ui apps/app pnpm-lock.yaml
git commit -m "feat(app): scaffold app, UI primitives, sign-in, accept-invite and password reset [AUTH-01 AUTH-03 PLT-02]"
```

---

### Task 12 (T-M0-12) [ui]: App shell, role landing, org switcher, platform pages, team & sessions settings

**Files:**
- Create: `apps/app/src/components/shell/{RequireAuth.tsx,AppShell.tsx,OrgSwitcher.tsx,RoleLanding.tsx}`
- Create: `apps/app/src/routes/platform/{OperatorsList.tsx,CreateOperator.tsx,OperatorDetail.tsx}`
- Create: `apps/app/src/routes/settings/{Team.tsx,Sessions.tsx,OrgProfile.tsx}`
- Modify: `apps/app/src/router.tsx`
- Test: `apps/app/src/components/shell/RoleLanding.test.tsx`, `apps/app/src/components/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: `useMe()`, `authClient`, `api`, contracts `Operator`, `OperatorDetail`, `CreateOperatorInput`, `OrgSettingsResponse`, `UpdateOrgSettingsInput`, `ROLE_LABELS`, `can()`.
- Produces: `landingPath(me: MeResponse): string` — `isPlatformAdmin && !activeOrg` → `/platform`; no memberships → `/no-access`; `activeOrg.role`: `admin|frontdesk` → `/calendar`, `housekeeper` → `/hk`, `landlord` → `/owner`; `<AppShell nav={NavItem[]}>` where `NavItem = { to: string; label: string; icon: LucideIcon; permission?: Permission }` filtered by `can(role, permission)`. Route areas: `/calendar` (Home until M1), `/settings/*`, `/hk` (until M6 renders `EmptyState "Your tasks will appear here"`), `/owner` (until M7 renders `EmptyState "Your statements will appear here"`), `/platform/*`.

- [ ] **Step 1: Write failing tests**

`apps/app/src/components/shell/RoleLanding.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import type { MeResponse } from '@boogbe/shared';
import { landingPath } from './RoleLanding';

const base: MeResponse = { user: { id: 'u', name: 'U', email: 'u@x', isPlatformAdmin: false }, activeOrg: null, memberships: [] };
const org = (role: MeResponse['memberships'][number]['role']) => ({ ...base, activeOrg: { id: 'o', name: 'T', slug: 't', role, timezone: 'Africa/Lagos', currency: 'NGN' }, memberships: [{ orgId: 'o', orgName: 'T', role }] });

describe('landingPath', () => {
  it('routes each role to its area', () => {
    expect(landingPath(org('admin'))).toBe('/calendar');
    expect(landingPath(org('frontdesk'))).toBe('/calendar');
    expect(landingPath(org('housekeeper'))).toBe('/hk');
    expect(landingPath(org('landlord'))).toBe('/owner');
  });
  it('platform admin without an org goes to /platform', () => {
    expect(landingPath({ ...base, user: { ...base.user, isPlatformAdmin: true } })).toBe('/platform');
  });
  it('member without active org picks one; nobody else gets /no-access', () => {
    expect(landingPath({ ...base, memberships: [{ orgId: 'o', orgName: 'T', role: 'admin' }] })).toBe('/choose-operator');
    expect(landingPath(base)).toBe('/no-access');
  });
});
```
`apps/app/src/components/shell/AppShell.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CalendarDays, Settings, Users } from 'lucide-react';
import { AppShell } from './AppShell';

vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { user: { id: 'u', name: 'Ada', email: 'a@x', isPlatformAdmin: false }, activeOrg: { id: 'o', name: 'Tanuhomes', slug: 't', role: 'frontdesk', timezone: 'Africa/Lagos', currency: 'NGN' }, memberships: [{ orgId: 'o', orgName: 'Tanuhomes', role: 'frontdesk' }] } }) }));
vi.mock('../../lib/auth-client', () => ({ authClient: { organization: { setActive: vi.fn() }, signOut: vi.fn() } }));

describe('AppShell', () => {
  it('hides nav items the role cannot use', () => {
    render(<MemoryRouter><AppShell nav={[
      { to: '/calendar', label: 'Calendar', icon: CalendarDays, permission: 'calendar.read' },
      { to: '/settings/team', label: 'Team', icon: Users, permission: 'members.write' },
      { to: '/settings', label: 'Settings', icon: Settings, permission: 'org.settings.write' },
    ]}><p>content</p></AppShell></MemoryRouter>);
    expect(screen.getAllByRole('link', { name: /calendar/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /team/i })).toBeNull();
    expect(screen.getByText('Tanuhomes')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @boogbe/app test`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement shell**

`apps/app/src/components/shell/RoleLanding.tsx`:
```tsx
import { Navigate } from 'react-router-dom';
import type { MeResponse } from '@boogbe/shared';
import { Spinner } from '@boogbe/ui';
import { useMe } from '../../lib/use-me';

export function landingPath(me: MeResponse): string {
  if (me.activeOrg) return { admin: '/calendar', frontdesk: '/calendar', housekeeper: '/hk', landlord: '/owner' }[me.activeOrg.role];
  if (me.memberships.length) return '/choose-operator';
  if (me.user.isPlatformAdmin) return '/platform';
  return '/no-access';
}
export function RoleLanding() {
  const { me } = useMe();
  if (!me) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
  return <Navigate to={landingPath(me)} replace />;
}
```
(Order matters: a platform admin who is also a member lands in their org; `/platform` is reachable from the avatar menu.) Update the test expectation accordingly — the test above already encodes: platform admin with no memberships → `/platform`.

`apps/app/src/components/shell/RequireAuth.tsx`:
```tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@boogbe/ui';
import { useMe } from '../../lib/use-me';

export function RequireAuth({ platform = false }: { platform?: boolean }) {
  const { me, isLoading, error } = useMe(); const loc = useLocation();
  if (isLoading) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
  if (error?.status === 401 || !me) return <Navigate to={`/auth/sign-in?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (platform && !me.user.isPlatformAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}
```
`apps/app/src/components/shell/OrgSwitcher.tsx`:
```tsx
import { useSWRConfig } from 'swr';
import { ROLE_LABELS } from '@boogbe/shared';
import { Select } from '@boogbe/ui';
import { authClient } from '../../lib/auth-client';
import { useMe } from '../../lib/use-me';

export function OrgSwitcher() {
  const { me } = useMe(); const { mutate } = useSWRConfig();
  if (!me || me.memberships.length < 2) return <span className="font-semibold">{me?.activeOrg?.name}</span>;
  return (
    <Select aria-label="Operator" value={me.activeOrg?.id ?? ''} onChange={async (e) => {
      await authClient.organization.setActive({ organizationId: e.target.value });
      await mutate(() => true, undefined, { revalidate: true }); // every cached query belongs to the old org
      window.location.assign('/');
    }}>
      {me.memberships.map((m) => <option key={m.orgId} value={m.orgId}>{m.orgName} · {ROLE_LABELS[m.role]}</option>)}
    </Select>
  );
}
```
`apps/app/src/components/shell/AppShell.tsx`:
```tsx
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { can, type Permission } from '@boogbe/shared';
import { authClient } from '../../lib/auth-client';
import { useMe } from '../../lib/use-me';
import { OrgSwitcher } from './OrgSwitcher';

export interface NavItem { to: string; label: string; icon: LucideIcon; permission?: Permission }

export function AppShell({ nav, children }: { nav: NavItem[]; children: ReactNode }) {
  const { me } = useMe();
  const role = me?.activeOrg?.role;
  const items = nav.filter((n) => !n.permission || (role && can(role, n.permission)));
  const link = ({ isActive }: { isActive: boolean }) => clsx('flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm', isActive ? 'bg-brand/10 text-brand' : 'text-ink hover:bg-surface-2');
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r border-line bg-surface p-3 md:flex md:flex-col md:gap-1">
        <div className="mb-4 px-2"><OrgSwitcher /></div>
        {items.map((n) => <NavLink key={n.to} to={n.to} className={link}><n.icon size={18} aria-hidden />{n.label}</NavLink>)}
        <button className="mt-auto flex min-h-11 items-center gap-2 px-3 text-sm text-ink-muted" onClick={async () => { await authClient.signOut(); window.location.assign('/auth/sign-in'); }}><LogOut size={18} aria-hidden />Sign out</button>
      </aside>
      <header className="flex items-center justify-between border-b border-line bg-surface p-3 md:hidden"><OrgSwitcher /></header>
      <main className="p-4 pb-24 md:p-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t border-line bg-surface md:hidden" aria-label="Main">
        {items.slice(0, 5).map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => clsx('flex min-h-14 flex-1 flex-col items-center justify-center text-xs', isActive ? 'text-brand' : 'text-ink-muted')}>
            <n.icon size={20} aria-hidden />{n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
```

- [ ] **Step 4: Implement platform pages**

`apps/app/src/routes/platform/OperatorsList.tsx`:
```tsx
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Operator } from '@boogbe/shared';
import { Badge, Button, Card, EmptyState, Spinner } from '@boogbe/ui';
import { useApi } from '../../lib/api';
import { formatDate } from '../../lib/format';

export function OperatorsList() {
  const { data, isLoading } = useApi('/v1/platform/operators', z.object({ items: z.array(Operator) }));
  if (isLoading || !data) return <Spinner />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Operators</h1><Link to="/platform/new"><Button>New operator</Button></Link></div>
      {data.items.length === 0 ? <EmptyState title="No operators yet" body="Create the first one — Tanuhomes." /> : data.items.map((o) => (
        <Link key={o.id} to={`/platform/operators/${o.id}`}>
          <Card className="flex items-center justify-between">
            <div><p className="font-medium">{o.name}</p><p className="text-sm text-ink-muted">{o.slug} · created {formatDate(o.createdAt.slice(0, 10))} · {o.memberCount} members · {o.pendingInvites} pending</p></div>
            <Badge tone={o.status === 'active' ? 'success' : 'danger'}>{o.status}</Badge>
          </Card>
        </Link>
      ))}
    </div>
  );
}
```
`apps/app/src/routes/platform/CreateOperator.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { CreateOperatorInput, Operator } from '@boogbe/shared';
import { Button, Card, Field, Input } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';

export function CreateOperator() {
  const nav = useNavigate();
  const f = useForm<CreateOperatorInput>({ resolver: zodResolver(CreateOperatorInput) as never, defaultValues: { timezone: 'Africa/Lagos' } });
  const onSubmit = f.handleSubmit(async (v) => {
    try {
      const op = await api('/v1/platform/operators', { method: 'POST', body: v, schema: Operator });
      nav(`/platform/operators/${op.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT') f.setError('slug', { message: 'That slug is taken' });
      else f.setError('root', { message: (e as Error).message });
    }
  });
  return (
    <Card className="max-w-lg">
      <h1 className="mb-4 text-xl font-semibold">New operator</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Business name" error={f.formState.errors.name?.message}><Input {...f.register('name')} /></Field>
        <Field label="Slug" hint="Used in links, e.g. tanuhomes" error={f.formState.errors.slug?.message}><Input {...f.register('slug')} /></Field>
        <Field label="Contact email" error={f.formState.errors.contactEmail?.message}><Input type="email" {...f.register('contactEmail', { setValueAs: (v) => v || undefined })} /></Field>
        <Field label="WhatsApp number" hint="+234…" error={f.formState.errors.whatsappPhone?.message}><Input {...f.register('whatsappPhone', { setValueAs: (v) => v || undefined })} /></Field>
        {f.formState.errors.root && <p role="alert" className="text-sm text-danger">{f.formState.errors.root.message}</p>}
        <Button type="submit" loading={f.formState.isSubmitting}>Create operator</Button>
      </form>
    </Card>
  );
}
```
`apps/app/src/routes/platform/OperatorDetail.tsx`:
```tsx
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { OperatorDetail as Detail, ROLE_LABELS } from '@boogbe/shared';
import { Badge, Button, Card, Field, Input, Spinner } from '@boogbe/ui';
import { api, useApi } from '../../lib/api';

export function OperatorDetail() {
  const { id = '' } = useParams();
  const { data, mutate } = useApi(`/v1/platform/operators/${id}`, Detail);
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  if (!data) return <Spinner />;
  const act = async (path: string) => { await api(path, { method: 'POST' }); await mutate(); };
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{data.name}</h1>
        <Badge tone={data.status === 'active' ? 'success' : 'danger'}>{data.status}</Badge>
      </div>
      <Card>
        <h2 className="mb-3 font-medium">Invite an admin</h2>
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setMsg(undefined);
          try { await api(`/v1/platform/operators/${id}/invite-admin`, { method: 'POST', body: { email } }); setEmail(''); setMsg('Invitation sent'); await mutate(); }
          catch (err) { setMsg((err as Error).message); } finally { setBusy(false); }
        }}>
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button type="submit" loading={busy} className="self-end">Send</Button>
        </form>
        {msg && <p role="status" className="mt-2 text-sm">{msg}</p>}
      </Card>
      <Card>
        <h2 className="mb-3 font-medium">Members</h2>
        {data.members.map((m) => <p key={m.id} className="text-sm">{m.name} · {m.email} · {ROLE_LABELS[m.role]}</p>)}
        <h2 className="mb-3 mt-4 font-medium">Invitations</h2>
        {data.invitations.map((i) => (
          <div key={i.id} className="flex items-center justify-between text-sm">
            <span>{i.email} · {i.role} · {i.status}</span>
            {i.status === 'pending' && <span className="flex gap-2"><Button variant="ghost" onClick={() => act(`/v1/platform/invitations/${i.id}/resend`)}>Resend</Button><Button variant="ghost" onClick={() => act(`/v1/platform/invitations/${i.id}/revoke`)}>Revoke</Button></span>}
          </div>
        ))}
      </Card>
      {data.status === 'active'
        ? <Button variant="danger" onClick={() => confirm(`Suspend ${data.name}? Their team will lose access.`) && act(`/v1/platform/operators/${id}/suspend`)}>Suspend operator</Button>
        : <Button onClick={() => act(`/v1/platform/operators/${id}/reactivate`)}>Reactivate operator</Button>}
    </div>
  );
}
```

- [ ] **Step 5: Implement settings pages**

`apps/app/src/routes/settings/Team.tsx`:
```tsx
import { useState } from 'react';
import useSWR from 'swr';
import { ORG_ROLES, ROLE_LABELS, type OrgRole } from '@boogbe/shared';
import { Button, Card, Field, Input, Select, Spinner } from '@boogbe/ui';
import { authClient } from '../../lib/auth-client';
import { useMe } from '../../lib/use-me';

export function Team() {
  const { me } = useMe();
  const orgId = me?.activeOrg?.id;
  const { data, mutate } = useSWR(orgId ? ['org-full', orgId] : null, async () => (await authClient.organization.getFullOrganization({ query: { organizationId: orgId! } })).data);
  const [email, setEmail] = useState(''); const [role, setRole] = useState<OrgRole>('frontdesk'); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  if (!data) return <Spinner />;
  const run = async (p: Promise<{ error: { message?: string } | null }>) => { setErr(undefined); const r = await p; if (r.error) setErr(r.error.message ?? 'Failed'); await mutate(); };
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Team</h1>
      <Card>
        <form className="grid gap-2 md:grid-cols-[1fr_180px_auto]" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await run(authClient.organization.inviteMember({ email, role: role as never, organizationId: orgId })); setEmail(''); setBusy(false); }}>
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>{ORG_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></Field>
          <Button type="submit" loading={busy} className="self-end">Invite</Button>
        </form>
        {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      </Card>
      <Card className="flex flex-col gap-2">
        {data.members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{m.user.name} <span className="text-sm text-ink-muted">{m.user.email}</span></span>
            <span className="flex gap-2">
              <Select aria-label={`Role for ${m.user.name}`} value={m.role} onChange={(e) => run(authClient.organization.updateMemberRole({ memberId: m.id, role: e.target.value as never, organizationId: orgId }))}>
                {ORG_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </Select>
              <Button variant="ghost" onClick={() => confirm(`Remove ${m.user.name}?`) && run(authClient.organization.removeMember({ memberIdOrEmail: m.id, organizationId: orgId }))}>Remove</Button>
            </span>
          </div>
        ))}
        {data.invitations.filter((i) => i.status === 'pending').map((i) => (
          <div key={i.id} className="flex items-center justify-between text-sm text-ink-muted">
            <span>{i.email} · {ROLE_LABELS[i.role as OrgRole]} · invited</span>
            <Button variant="ghost" onClick={() => run(authClient.organization.cancelInvitation({ invitationId: i.id }))}>Cancel</Button>
          </div>
        ))}
      </Card>
    </div>
  );
}
```
`apps/app/src/routes/settings/Sessions.tsx`:
```tsx
import useSWR from 'swr';
import { Button, Card, Spinner } from '@boogbe/ui';
import { authClient } from '../../lib/auth-client';

export function Sessions() {
  const { data, mutate } = useSWR('sessions', async () => (await authClient.listSessions()).data);
  if (!data) return <Spinner />;
  return (
    <Card className="flex max-w-2xl flex-col gap-2">
      <h1 className="text-xl font-semibold">Signed-in devices</h1>
      {data.map((s) => <p key={s.id} className="text-sm">{s.userAgent ?? 'Unknown device'} · {new Date(s.createdAt).toLocaleString('en-NG')}</p>)}
      <Button variant="secondary" onClick={async () => { await authClient.revokeOtherSessions(); await mutate(); }}>Sign out other devices</Button>
    </Card>
  );
}
```
`apps/app/src/routes/settings/OrgProfile.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { OrgSettingsResponse, UpdateOrgSettingsInput } from '@boogbe/shared';
import { Button, Card, Field, Input, Spinner } from '@boogbe/ui';
import { api, useApi } from '../../lib/api';

export function OrgProfile() {
  const { data, mutate } = useApi('/v1/org/settings', OrgSettingsResponse);
  const f = useForm<UpdateOrgSettingsInput>({ resolver: zodResolver(UpdateOrgSettingsInput) as never });
  useEffect(() => { if (data) f.reset({ name: data.org.name, contactEmail: data.org.contactEmail, whatsappPhone: data.org.whatsappPhone, address: data.org.address, ...data.settings }); }, [data, f]);
  if (!data) return <Spinner />;
  const e = f.formState.errors;
  return (
    <Card className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">Business settings</h1>
      <form className="grid gap-4 md:grid-cols-2" noValidate onSubmit={f.handleSubmit(async (v) => { await api('/v1/org/settings', { method: 'PATCH', body: v }); await mutate(); })}>
        <Field label="Business name" error={e.name?.message}><Input {...f.register('name')} /></Field>
        <Field label="Contact email" error={e.contactEmail?.message}><Input type="email" {...f.register('contactEmail')} /></Field>
        <Field label="WhatsApp number" hint="+234…" error={e.whatsappPhone?.message}><Input {...f.register('whatsappPhone')} /></Field>
        <Field label="Address" error={e.address?.message}><Input {...f.register('address')} /></Field>
        <Field label="Check-in time" error={e.checkInTime?.message}><Input type="time" {...f.register('checkInTime')} /></Field>
        <Field label="Check-out time" error={e.checkOutTime?.message}><Input type="time" {...f.register('checkOutTime')} /></Field>
        <Field label="Hold tentative bookings for (hours)" error={e.holdHours?.message}><Input type="number" {...f.register('holdHours', { valueAsNumber: true })} /></Field>
        <Field label="Booking reference prefix" error={e.bookingPrefix?.message}><Input {...f.register('bookingPrefix')} /></Field>
        <Field label="Receipt prefix" error={e.receiptPrefix?.message}><Input {...f.register('receiptPrefix')} /></Field>
        <Field label="Statement prefix" error={e.statementPrefix?.message}><Input {...f.register('statementPrefix')} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...f.register('autoConfirmOnPayment')} />Confirm bookings automatically on first payment</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...f.register('ownerSeesGuestNames')} />Property owners can see guest names</label>
        <Button type="submit" loading={f.formState.isSubmitting} className="md:col-span-2">Save</Button>
      </form>
    </Card>
  );
}
```

- [ ] **Step 6: Wire the router**

Replace `apps/app/src/router.tsx`:
```tsx
import { CalendarDays, Settings, ShieldCheck, Users } from 'lucide-react';
import { createBrowserRouter, Outlet } from 'react-router-dom';
import { EmptyState } from '@boogbe/ui';
import { AppShell, type NavItem } from './components/shell/AppShell';
import { RequireAuth } from './components/shell/RequireAuth';
import { RoleLanding } from './components/shell/RoleLanding';
import { SignIn } from './routes/auth/SignIn';
import { AcceptInvite } from './routes/auth/AcceptInvite';
import { ForgotPassword } from './routes/auth/ForgotPassword';
import { ResetPassword } from './routes/auth/ResetPassword';
import { Home } from './routes/Home';
import { NotFound } from './routes/NotFound';
import { OperatorsList } from './routes/platform/OperatorsList';
import { CreateOperator } from './routes/platform/CreateOperator';
import { OperatorDetail } from './routes/platform/OperatorDetail';
import { Team } from './routes/settings/Team';
import { Sessions } from './routes/settings/Sessions';
import { OrgProfile } from './routes/settings/OrgProfile';
import { ChooseOperator } from './routes/ChooseOperator';

/** Later milestones append to these arrays; keep one source of truth for nav. */
export const OPERATOR_NAV: NavItem[] = [
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, permission: 'calendar.read' },
  { to: '/settings/team', label: 'Team', icon: Users, permission: 'members.write' },
  { to: '/settings', label: 'Settings', icon: Settings, permission: 'org.settings.read' },
];
const PLATFORM_NAV: NavItem[] = [{ to: '/platform', label: 'Operators', icon: ShieldCheck }];

const operator = (children: React.ReactNode) => <AppShell nav={OPERATOR_NAV}>{children}</AppShell>;

export const router = createBrowserRouter([
  { path: '/auth/sign-in', element: <SignIn /> },
  { path: '/auth/accept-invite/:id', element: <AcceptInvite /> },
  { path: '/auth/forgot', element: <ForgotPassword /> },
  { path: '/auth/reset', element: <ResetPassword /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <RoleLanding /> },
      { path: '/choose-operator', element: <ChooseOperator /> },
      { path: '/no-access', element: <main className="p-8"><EmptyState title="No operator yet" body="Ask your operator to invite you." /></main> },
      { path: '/calendar', element: operator(<Home />) },
      { path: '/settings', element: operator(<OrgProfile />) },
      { path: '/settings/team', element: operator(<Team />) },
      { path: '/settings/sessions', element: operator(<Sessions />) },
      { path: '/hk', element: <main className="p-4"><EmptyState title="Your tasks will appear here" /></main> },
      { path: '/owner', element: <main className="p-4"><EmptyState title="Your statements will appear here" /></main> },
    ],
  },
  {
    element: <RequireAuth platform />,
    children: [{ element: <AppShell nav={PLATFORM_NAV}><Outlet /></AppShell>, children: [
      { path: '/platform', element: <OperatorsList /> },
      { path: '/platform/new', element: <CreateOperator /> },
      { path: '/platform/operators/:id', element: <OperatorDetail /> },
    ] }],
  },
  { path: '*', element: <NotFound /> },
]);
```
`apps/app/src/routes/ChooseOperator.tsx`:
```tsx
import { ROLE_LABELS } from '@boogbe/shared';
import { Button, Card } from '@boogbe/ui';
import { authClient } from '../lib/auth-client';
import { useMe } from '../lib/use-me';

export function ChooseOperator() {
  const { me } = useMe();
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-3 p-4 pt-16">
      <h1 className="text-xl font-semibold">Choose an operator</h1>
      {me?.memberships.map((m) => (
        <Card key={m.orgId} className="flex items-center justify-between">
          <span>{m.orgName} <span className="text-sm text-ink-muted">{ROLE_LABELS[m.role]}</span></span>
          <Button onClick={async () => { await authClient.organization.setActive({ organizationId: m.orgId }); window.location.assign('/'); }}>Open</Button>
        </Card>
      ))}
    </main>
  );
}
```

- [ ] **Step 7: Run tests and build**

Run: `pnpm --filter @boogbe/app test && pnpm --filter @boogbe/app build`
Expected: PASS.

- [ ] **Step 8: Commit**
```bash
git add apps/app
git commit -m "feat(app): shell, role landing, org switcher, platform and team settings [AUTH-04 AUTH-05 AUTH-07 PLT-01..05 ORG-01..04]"
```

---

### Task 13 (T-M0-13) [infra]: CI, deploy scripts, PM2, nginx, backups, runbook

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy-api.yml`, `.github/workflows/deploy-app.yml`
- Create: `deploy/deploy.sh`, `deploy/backup.sh`, `ecosystem.config.js`
- Create: `deploy/nginx/boogbe-api.conf`, copy `deploy/nginx/cloudflare-realip.conf` and `deploy/nginx/update-cloudflare-ips.sh` from Unclutter `deploy/nginx/`
- Create: `docs/RUNBOOK.md`
- Test: CI run on a PR (green) + `bash -n deploy/*.sh`

**Interfaces:**
- `deploy/deploy.sh <prod|staging>` — idempotent; aborts on failed backup; `prisma migrate deploy` as migrator; reloads `boogbe-<instance>-api` and `boogbe-<instance>-worker`; waits for `/v1/health`.
- `deploy/backup.sh <prod|staging>` — `pg_dump -Fc` → gzip-free custom format → upload to R2 `backups/<instance>/YYYY/MM/DD/boogbe-<ts>.dump` via `aws s3 cp --endpoint-url $R2_ENDPOINT`; deletes R2 objects older than 30 days.

- [ ] **Step 1: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request: { branches: [dev, main] }
  push: { branches: [dev, main] }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres }
        ports: ['5433:5432']
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      TEST_DATABASE_URL: postgresql://boogbe_app:app@localhost:5433/boogbe_test
      TEST_DATABASE_MIGRATE_URL: postgresql://boogbe_migrator:migrator@localhost:5433/boogbe_test
      DATABASE_URL: postgresql://boogbe_app:app@localhost:5433/boogbe_test
      BETTER_AUTH_SECRET: ci-secret-ci-secret-ci-secret-ci-secret-1
      BETTER_AUTH_URL: http://localhost:5173
      APP_ORIGIN: http://localhost:5173
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Create roles and databases
        run: |
          PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -f deploy/sql/roles.sql
          PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -f deploy/sql/db-init.sql
      - run: pnpm --filter @boogbe/api prisma:generate
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm test:int
      - run: pnpm build
```
(`.env` is absent in CI; `global-setup.ts` loads `.env` only if present — `dotenv` `config()` is a no-op when the file is missing.)

- [ ] **Step 2: PM2 + deploy scripts**

`ecosystem.config.js`:
```js
// One file for both instances. BOOGBE_INSTANCE=prod|staging selects names, ports and cwd.
const instance = process.env.BOOGBE_INSTANCE || 'prod';
const cwd = instance === 'prod' ? '/home/boogbe/app' : '/home/boogbe/staging';
const port = instance === 'prod' ? 3060 : 3061;
const common = {
  cwd, instances: 1, exec_mode: 'fork', // single instance on purpose: throttler is in-memory (as Unclutter)
  autorestart: true, min_uptime: '30s', max_restarts: 10, restart_delay: 2000, max_memory_restart: '600M',
  kill_timeout: 10000, merge_logs: true, time: true,
};
module.exports = {
  apps: [
    { ...common, name: `boogbe-${instance}-api`, script: './apps/api/dist/main.js', error_file: './logs/api-error.log', out_file: './logs/api-out.log', env_production: { NODE_ENV: 'production', PORT: port, BOOGBE_ROLE: 'api' } },
    { ...common, name: `boogbe-${instance}-worker`, script: './apps/api/dist/worker.js', error_file: './logs/worker-error.log', out_file: './logs/worker-out.log', env_production: { NODE_ENV: 'production', BOOGBE_ROLE: 'worker' } },
  ],
};
```
`deploy/deploy.sh` (patterned on Unclutter `deploy.sh`: pipefail, env read without sourcing, backup-before-migrate, PM2 path check, health wait):
```bash
#!/bin/bash
set -euo pipefail
INSTANCE="${1:?usage: deploy.sh prod|staging}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
BRANCH=$([ "$INSTANCE" = prod ] && echo main || echo dev)
PORT=$([ "$INSTANCE" = prod ] && echo 3060 || echo 3061)
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/boogbe-$INSTANCE}"
export BOOGBE_INSTANCE="$INSTANCE"

env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
MIGRATE_URL="$(env_get DATABASE_MIGRATE_URL)"
[ -n "$MIGRATE_URL" ] || { echo "DATABASE_MIGRATE_URL missing in .env"; exit 1; }

echo "→ pull $BRANCH"; git fetch --quiet origin "$BRANCH"; git checkout --quiet "$BRANCH"; git reset --hard --quiet "origin/$BRANCH"
echo "→ install"; pnpm install --frozen-lockfile
echo "→ prisma generate"; pnpm --filter @boogbe/api prisma:generate
echo "→ build api"; NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter @boogbe/api build

echo "→ backup"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S).dump"
PG_URL="${MIGRATE_URL%%\?*}"
if ! pg_dump --format=custom --no-owner --no-acl --file="$BACKUP_FILE" "$PG_URL"; then echo "✗ backup failed — aborting before migrations"; rm -f "$BACKUP_FILE"; exit 1; fi
[ -s "$BACKUP_FILE" ] || { echo "✗ empty backup — aborting"; rm -f "$BACKUP_FILE"; exit 1; }
find "$BACKUP_DIR" -name 'pre-deploy-*.dump' -mtime +14 -delete || true

echo "→ migrate"; DATABASE_URL="$MIGRATE_URL" pnpm --filter @boogbe/api prisma:migrate:deploy

echo "→ reload"
mkdir -p logs
for p in api worker; do
  NAME="boogbe-$INSTANCE-$p"
  EXPECTED="$DIR/apps/api/dist/$([ $p = api ] && echo main || echo worker).js"
  RUNNING="$(pm2 jlist 2>/dev/null | node -e "let r='';process.stdin.on('data',c=>r+=c).on('end',()=>{try{const a=JSON.parse(r).find(x=>x.name==='$NAME');process.stdout.write(a?.pm2_env?.pm_exec_path??'')}catch{}})" || true)"
  if [ -n "$RUNNING" ] && [ "$RUNNING" != "$EXPECTED" ]; then pm2 delete "$NAME" || true; fi
done
pm2 startOrReload ecosystem.config.js --env production
pm2 save

echo "→ health"
for i in $(seq 1 30); do
  if node -e "fetch('http://127.0.0.1:$PORT/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then echo "✓ healthy"; exit 0; fi
  sleep 2
done
echo "✗ API did not become healthy"; pm2 logs "boogbe-$INSTANCE-api" --lines 50 --nostream; exit 1
```
`deploy/backup.sh`:
```bash
#!/bin/bash
set -euo pipefail
INSTANCE="${1:?usage: backup.sh prod|staging}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"; cd "$DIR"
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
URL="$(env_get DATABASE_MIGRATE_URL)"; URL="${URL%%\?*}"
export AWS_ACCESS_KEY_ID="$(env_get R2_ACCESS_KEY_ID)" AWS_SECRET_ACCESS_KEY="$(env_get R2_SECRET_ACCESS_KEY)" AWS_DEFAULT_REGION=auto
ENDPOINT="$(env_get R2_ENDPOINT)"; BUCKET="$(env_get R2_BUCKET)"
TS=$(date -u +%Y%m%dT%H%M%SZ); KEY="backups/$INSTANCE/$(date -u +%Y/%m/%d)/boogbe-$TS.dump"
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
pg_dump --format=custom --no-owner --no-acl --file="$TMP" "$URL"
[ -s "$TMP" ] || { echo "empty dump"; exit 1; }
aws s3 cp "$TMP" "s3://$BUCKET/$KEY" --endpoint-url "$ENDPOINT" --only-show-errors
CUTOFF=$(date -u -d '30 days ago' +%Y-%m-%d)
aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "backups/$INSTANCE/" --endpoint-url "$ENDPOINT" --query "Contents[?LastModified<'$CUTOFF'].Key" --output text \
  | tr '\t' '\n' | grep -v '^None$' | while read -r k; do [ -n "$k" ] && aws s3 rm "s3://$BUCKET/$k" --endpoint-url "$ENDPOINT" --only-show-errors; done
echo "backup ok: $KEY"
```
Cron on the VPS (documented in RUNBOOK): `30 1 * * * /home/boogbe/app/deploy/backup.sh prod >> /home/boogbe/app/logs/backup.log 2>&1` (01:30 UTC = 02:30 Lagos).

`deploy/nginx/boogbe-api.conf`:
```nginx
# api.boogbe.com and staging-api.boogbe.com → PM2 on localhost. Only Cloudflare may reach the origin.
include /etc/nginx/snippets/cloudflare-realip.conf;
server {
  listen 443 ssl http2;
  server_name api.boogbe.com;
  ssl_certificate     /etc/ssl/cloudflare/boogbe-origin.pem;
  ssl_certificate_key /etc/ssl/cloudflare/boogbe-origin.key;
  client_max_body_size 12m;
  location / {
    proxy_pass http://127.0.0.1:3060;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 60s;
  }
}
server {
  listen 443 ssl http2;
  server_name staging-api.boogbe.com;
  ssl_certificate     /etc/ssl/cloudflare/boogbe-origin.pem;
  ssl_certificate_key /etc/ssl/cloudflare/boogbe-origin.key;
  client_max_body_size 12m;
  location / {
    proxy_pass http://127.0.0.1:3061;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

- [ ] **Step 3: Deploy workflows**

`.github/workflows/deploy-api.yml`:
```yaml
name: Deploy API
on:
  workflow_run: { workflows: [CI], types: [completed], branches: [dev, main] }
  workflow_dispatch: {}
jobs:
  deploy:
    if: github.event_name == 'workflow_dispatch' || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push')
    runs-on: ubuntu-latest
    concurrency: { group: deploy-api-${{ github.event.workflow_run.head_branch || github.ref_name }}, cancel-in-progress: false }
    steps:
      - uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.PROD_SSH_HOST }}
          username: ${{ secrets.PROD_SSH_USER }}
          key: ${{ secrets.PROD_SSH_KEY }}
          command_timeout: 20m
          script: |
            BRANCH="${{ github.event.workflow_run.head_branch || github.ref_name }}"
            if [ "$BRANCH" = main ]; then cd /home/boogbe/app && bash deploy/deploy.sh prod; else cd /home/boogbe/staging && bash deploy/deploy.sh staging; fi
```
`.github/workflows/deploy-app.yml`:
```yaml
name: Deploy App
on:
  workflow_run: { workflows: [CI], types: [completed], branches: [dev, main] }
jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { ref: ${{ github.event.workflow_run.head_sha }} }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @boogbe/app build
        env:
          VITE_API_ORIGIN: ${{ github.event.workflow_run.head_branch == 'main' && 'https://api.boogbe.com' || 'https://staging-api.boogbe.com' }}
      - run: npx wrangler@3 pages deploy apps/app/dist --project-name boogbe-app --branch ${{ github.event.workflow_run.head_branch }}
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
```
SPA fallback: add `apps/app/public/_redirects` with `/* /index.html 200`.

- [ ] **Step 4: Runbook**

`docs/RUNBOOK.md`:
````markdown
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
3. As `boogbe`: `git clone <repo> /home/boogbe/app` (branch `main`) and `/home/boogbe/staging` (branch `dev`). Create `.env` in each (see `.env.example`; `NODE_ENV=production`, `COOKIE_DOMAIN=.boogbe.com`, `BETTER_AUTH_URL=https://app.boogbe.com` / `https://staging-app.boogbe.com`, `APP_ORIGIN` same, R2 + Resend + Sentry keys).
4. nginx: Cloudflare Origin Certificate for `*.boogbe.com` at `/etc/ssl/cloudflare/`; copy `deploy/nginx/cloudflare-realip.conf` to `/etc/nginx/snippets/`; copy `deploy/nginx/boogbe-api.conf` to `sites-enabled`; firewall 443 to Cloudflare IPs only (`deploy/nginx/update-cloudflare-ips.sh` weekly cron).
5. First deploy: `bash deploy/deploy.sh staging` then `prod`. `pm2 startup` + `pm2 save`.
6. Platform admin: add your email to `PLATFORM_ADMIN_EMAILS` in `.env`, then `pnpm --filter @boogbe/api create-platform-admin -- you@edgdmedia.com "Your Name" '<password>'`.
7. Backups cron (crontab -e as boogbe): `30 1 * * * /home/boogbe/app/deploy/backup.sh prod >> /home/boogbe/app/logs/backup.log 2>&1`.

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
- Code: `git -C /home/boogbe/app reset --hard <previous sha> && bash deploy/deploy.sh prod` (migrations are forward-only; never roll back a migration — write a new one).
- Data: restore the latest `pre-deploy-*.dump` with `pg_restore --clean --if-exists --no-owner -d boogbe`.
````

- [ ] **Step 5: Verify**

Run: `bash -n deploy/deploy.sh && bash -n deploy/backup.sh && node -e "require('./ecosystem.config.js')"`
Expected: no output, exit 0.
Push the branch and open a PR to `dev`. Expected: CI `verify` green.

- [ ] **Step 6: Commit**
```bash
git add .github deploy ecosystem.config.js docs/RUNBOOK.md apps/app/public/_redirects
git commit -m "chore(infra): CI, deploy and backup scripts, PM2, nginx and runbook [NFR-03 NFR-04]"
```

---

### Task 14 (T-M0-14) [e2e]: Playwright + E2E-01, staging verification

**Files:**
- Create: `playwright.config.ts`, `e2e/fixtures.ts`, `e2e/e01-onboard-operator.spec.ts`, `apps/api/scripts/e2e-reset.ts`
- Modify: `.github/workflows/ci.yml` (e2e job on PRs to `main`)

**Interfaces:**
- `e2e/fixtures.ts` exports `resetDb()` (runs `pnpm --filter @boogbe/api exec tsx scripts/e2e-reset.ts`), `platformAdmin = { email: 'platform@e2e.boogbe', password: 'e2e-platform-password' }`, `lastEmailTo(email)` (reads `GET /v1/__test/mail?to=` — a route registered **only** when `NODE_ENV=test` and `E2E=1`, decorated `@Public()`).

- [ ] **Step 1: Test-only mail endpoint (API)**

`apps/api/src/modules/test-support/test-support.controller.ts`:
```ts
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Public } from '../../common/auth/decorators';
import { MAILER } from '../../common/mail/mail.module';
import type { MemoryMailer } from '../../common/mail/mailer';

@Controller('__test')
export class TestSupportController {
  constructor(@Inject(MAILER) private readonly mailer: MemoryMailer) {}
  @Get('mail') @Public() mail(@Query('to') to: string) { return this.mailer.lastTo(to) ?? null; }
}
```
`test-support.module.ts`: `@Module({ controllers: [TestSupportController] })`. In `AppModule` imports: `...(process.env.E2E === '1' && process.env.NODE_ENV !== 'production' ? [TestSupportModule] : [])`. The MAILER factory must return `MemoryMailer` when `E2E === '1'`.

`apps/api/scripts/e2e-reset.ts`:
```ts
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { createAuth } from '../src/common/auth/auth';
import { MemoryMailer } from '../src/common/mail/mailer';
import { loadEnv } from '../src/env';

async function main() {
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate --schema ../../prisma/schema.prisma', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: process.env.DATABASE_MIGRATE_URL } });
  const env = loadEnv({ ...process.env, PLATFORM_ADMIN_EMAILS: 'platform@e2e.boogbe' });
  const prisma = new PrismaClient();
  const auth = createAuth({ prisma, mailer: new MemoryMailer(), env });
  const r = await auth.api.signUpEmail({ body: { email: 'platform@e2e.boogbe', name: 'Platform', password: 'e2e-platform-password' } });
  await prisma.user.update({ where: { id: r.user.id }, data: { role: 'admin', emailVerified: true } });
  await prisma.$disconnect();
}
void main();
```

- [ ] **Step 2: Playwright config + fixtures**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 740 } } },
  ],
  webServer: [
    { command: 'E2E=1 NODE_ENV=test pnpm --filter @boogbe/api dev', url: 'http://localhost:3060/v1/health', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: 'pnpm --filter @boogbe/app dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
  ],
});
```
`e2e/fixtures.ts`:
```ts
import { execSync } from 'node:child_process';
export const platformAdmin = { email: 'platform@e2e.boogbe', password: 'e2e-platform-password' };
export function resetDb() { execSync('pnpm --filter @boogbe/api exec tsx scripts/e2e-reset.ts', { stdio: 'inherit' }); }
export async function lastEmailTo(email: string): Promise<{ text: string } | null> {
  const r = await fetch(`http://localhost:3060/v1/__test/mail?to=${encodeURIComponent(email)}`);
  return r.json();
}
```

- [ ] **Step 3: Write E2E-01**

`e2e/e01-onboard-operator.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { lastEmailTo, platformAdmin, resetDb } from './fixtures';

test.beforeAll(() => resetDb());

test('E2E-01 platform admin creates operator, invites admin, admin lands on calendar', async ({ page, browser }) => {
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(platformAdmin.email);
  await page.getByLabel('Password').fill(platformAdmin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Operators' })).toBeVisible();

  await page.getByRole('button', { name: 'New operator' }).click();
  await page.getByLabel('Business name').fill('Tanuhomes');
  await page.getByLabel('Slug').fill('tanuhomes');
  await page.getByRole('button', { name: 'Create operator' }).click();
  await expect(page.getByRole('heading', { name: 'Tanuhomes' })).toBeVisible();

  await page.getByLabel('Email').fill('admin@tanuhomes.test');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toHaveText('Invitation sent');

  const mail = await lastEmailTo('admin@tanuhomes.test');
  const url = /(http\S+\/auth\/accept-invite\/\S+)/.exec(mail!.text)![1]!;

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(url);
  await expect(p2.getByRole('heading', { name: /Join Tanuhomes as Admin/ })).toBeVisible();
  await p2.getByLabel('Your name').fill('Tanu Admin');
  await p2.getByLabel('Password').fill('correct-horse-battery');
  await p2.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(p2).toHaveURL(/\/calendar$/);
  await expect(p2.getByText('Welcome to Tanuhomes')).toBeVisible();
});
```

- [ ] **Step 4: Run**

Run: `pnpm test:e2e --project=desktop`
Expected: 1 passed. Then `--project=mobile`: 1 passed.

- [ ] **Step 5: CI e2e job**

Append to `.github/workflows/ci.yml` a job:
```yaml
  e2e:
    if: github.base_ref == 'main'
    needs: verify
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres }
        ports: ['5433:5432']
        options: --health-cmd "pg_isready -U postgres" --health-interval 5s --health-retries 10
    env:
      DATABASE_URL: postgresql://boogbe_app:app@localhost:5433/boogbe_dev
      DATABASE_MIGRATE_URL: postgresql://boogbe_migrator:migrator@localhost:5433/boogbe_dev
      BETTER_AUTH_SECRET: ci-secret-ci-secret-ci-secret-ci-secret-1
      BETTER_AUTH_URL: http://localhost:5173
      APP_ORIGIN: http://localhost:5173
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: |
          PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -f deploy/sql/roles.sql
          PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -f deploy/sql/db-init.sql
      - run: pnpm --filter @boogbe/api prisma:generate
      - run: npx playwright install --with-deps chromium
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report }
```

- [ ] **Step 6: Staging verification (manual, by the owner with Claude Code)**

After merge to `dev` and the deploy workflow succeeds: open `https://staging-app.boogbe.com`, sign in as platform admin, create "Tanuhomes", invite the owner's email, accept, land on the calendar. Record the result in `docs/COORDINATION.md` notes for T-M0-14.

- [ ] **Step 7: Commit**
```bash
git add playwright.config.ts e2e apps/api .github
git commit -m "test(e2e): playwright harness and E2E-01 operator onboarding [PLT-01 PLT-02]"
```

---

## Self-review notes (completed)
- Spec coverage for M0 scope: PLT-01..05 (Tasks 8, 12), AUTH-01..09 (Tasks 5, 6, 9, 11, 12), ORG-01..04 (8, 12 — logo upload deferred to M1 Task "files" since R2 file service lands with property photos; ORG-01 logo is delivered in M1 T-M1-02), NFR-01 (7, 10), NFR-03/04/08 (13), AUD-01 base (7, 9).
- Types used across tasks: `OrgCtx`, `RequestCtx`, `OrgDb.run`, `OrgTx`, `newId`, `AuditService.record`, `AUTH`, `MAILER`, `MemoryMailer.lastTo`, `ISOLATION_FIXTURES`, `PARAM_FIXTURE`, `OPERATOR_NAV` — consistent.
- Removed `permission.guard.ts` (single `SessionGuard`) — file map updated by Task 6 note.
