# M6 — Housekeeping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Claim each task in `docs/COORDINATION.md` before starting.

**Goal:** Turnover tasks appear automatically when guests leave, due before the next arrival; housekeepers get a fast phone view of today's and upcoming tasks, start/finish them with notes and photos, and report issues; admins/front desk manage everything on a task board. Exit: E2E-05 passes at 360×740.

**Architecture:** `task` + `task_photo` tenant tables. `TurnoverService` creates turnovers from `BookingHooks.afterTransition('checked_out')` and from an hourly sweep for stays whose check-out time has passed without a checkout click (idempotent via a partial unique index on `booking_id` for turnovers). Housekeeper endpoints are scoped to `assignee_member_id = ctx.memberId` (`tasks.*_own`); staff endpoints use `tasks.read/write`. Photos reuse M1's presigned upload (`task_photo` kind, ≤ 1 MB after client-side compression).

**Tech Stack:** as M5 (no new dependencies — image compression uses `<canvas>`).

**Spec:** FRD HSK-01..07; NFR-07 (housekeeper bundle ≤ 250 KB gzipped JS).

**Depends on:** M2 (booking hooks), M1 (files). Independent of M3–M5.

## Global Constraints

- Task types `turnover|cleaning|maintenance|inspection`; status `todo|in_progress|done|cancelled`; priority `low|normal|high`.
- Turnover due: next arrival's `check_in` date at operator `check_in_time`, if another active booking for the unit starts on or before `check_out + 1 day`; otherwise `check_out + 1 day` at 18:00 local.
- At most one turnover per booking (partial unique index). Cancelling a booking cancels its open (`todo`/`in_progress`) turnover.
- A housekeeper sees only tasks assigned to them; anything else is 404 (not 403) to avoid leaking existence.
- Max 5 photos per task; each confirmed `file` of kind `task_photo`.
- Housekeeper route `/hk` is code-split; its JS ≤ 250 KB gzipped (checked by `pnpm --filter @boogbe/app run size`).

## Review Focus

1. **Checkout clicked after the sweep already created the turnover** → still one task (T-M6-04 test `checkout after sweep keeps one turnover`).
2. **Back-to-back stay (same-day turnover)** → due at today's check-in time, priority `high` (T-M6-01 test `same-day arrival is due at check-in time, high priority`).
3. **Housekeeper tries another housekeeper's task id** → 404 (T-M6-03 test `other housekeeper's task is 404`).
4. **Unit has no default assignee** → task created unassigned and shows in the board's "Unassigned" filter; nobody's phone list (T-M6-04 test `no default assignee leaves task unassigned`).
5. **A 6th photo or a photo of another kind** → 400 (T-M6-04 test `photo limits`).

## Parallel split

| Task | Track | Agent | Depends on |
|---|---|---|---|
| T-M6-01 Domain + contracts | domain | Claude Code | M2 |
| T-M6-02 Schema | schema | Claude Code | T-M6-01 |
| T-M6-03 Tasks API (board, own, assignees) | api | Claude Code | T-M6-02 |
| T-M6-04 Turnover automation, sweep, cancel, issues, photos | api | Claude Code | T-M6-03 |
| T-M6-05 Task board UI + unit default assignee | ui | OpenCode | T-M6-01 (stub), merge after T-M6-03 |
| T-M6-06 Housekeeper app + compression + E2E-05 | ui/e2e | OpenCode | T-M6-04 |

---

### Task 1 (T-M6-01) [domain]: Turnover due-time rule and task contracts

**Files:** Create `packages/shared/src/domain/turnover.ts`, `packages/shared/src/contracts/tasks.ts`; modify `index.ts`; Test `packages/shared/src/domain/turnover.test.ts`.

**Interfaces (produced):**
```ts
export function turnoverDue(p: { checkOut: IsoDate; nextCheckIn: IsoDate | null; checkInTime: string; timeZone: string }): { dueAt: Date; priority: 'normal' | 'high' }
// contracts/tasks.ts
TaskType, TaskStatus, TaskPriority enums; TASK_TYPE_LABELS, TASK_STATUS_LABELS
Task { id; type; title; notes: string|null; status; priority; dueAt: string; unit: { id; name; propertyName; address }; booking: { id; ref; guestName } | null; assignee: { memberId; name } | null; nextArrival: { checkIn: string; time: string; ref: string } | null; photos: { fileId: string }[]; completedAt: string|null; createdAt }
CreateTaskInput { type; unitId; title (2..120); notes?; dueAt: ISO datetime; assigneeMemberId: string|null; priority }
UpdateTaskInput { title?; notes?; dueAt?; assigneeMemberId?: string|null; priority?; status?: 'todo'|'cancelled' }
TaskListQuery { status?; assigneeMemberId?: string | 'unassigned'; unitId?; from?: IsoDate; to?: IsoDate }
MyTasksQuery { scope: 'today'|'upcoming' }
CompleteTaskInput { note?: string (≤1000); photoFileIds: string[] (≤5) }
ReportIssueInput { title (3..120); note?: string; photoFileIds: string[] (≤5); priority: TaskPriority default 'normal' }
Assignee { memberId; name; role }
```

- [ ] **Step 1: Failing test** `packages/shared/src/domain/turnover.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { turnoverDue } from './turnover';

describe('turnoverDue [HSK-02]', () => {
  it('same-day arrival is due at check-in time, high priority', () => {
    expect(turnoverDue({ checkOut: '2026-11-04', nextCheckIn: '2026-11-04', checkInTime: '14:00', timeZone: 'Africa/Lagos' }))
      .toEqual({ dueAt: new Date('2026-11-04T13:00:00Z'), priority: 'high' });
  });
  it('next-day arrival is due at that check-in time, normal priority', () => {
    expect(turnoverDue({ checkOut: '2026-11-04', nextCheckIn: '2026-11-05', checkInTime: '14:00', timeZone: 'Africa/Lagos' }))
      .toEqual({ dueAt: new Date('2026-11-05T13:00:00Z'), priority: 'normal' });
  });
  it('no near arrival → end of next day (18:00 local)', () => {
    expect(turnoverDue({ checkOut: '2026-11-04', nextCheckIn: '2026-11-20', checkInTime: '14:00', timeZone: 'Africa/Lagos' }))
      .toEqual({ dueAt: new Date('2026-11-05T17:00:00Z'), priority: 'normal' });
    expect(turnoverDue({ checkOut: '2026-11-04', nextCheckIn: null, checkInTime: '14:00', timeZone: 'Africa/Lagos' }).dueAt).toEqual(new Date('2026-11-05T17:00:00Z'));
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `turnover.ts`:
```ts
import { addDays, zonedTimeToUtc, type IsoDate } from './dates';

export function turnoverDue(p: { checkOut: IsoDate; nextCheckIn: IsoDate | null; checkInTime: string; timeZone: string }) {
  const nextDay = addDays(p.checkOut, 1);
  if (p.nextCheckIn && p.nextCheckIn <= nextDay) {
    return { dueAt: zonedTimeToUtc(p.nextCheckIn, p.checkInTime, p.timeZone), priority: p.nextCheckIn === p.checkOut ? ('high' as const) : ('normal' as const) };
  }
  return { dueAt: zonedTimeToUtc(nextDay, '18:00', p.timeZone), priority: 'normal' as const };
}
```
`contracts/tasks.ts`:
```ts
import { z } from 'zod';
import { IsoDateSchema } from './common';

export const TaskType = z.enum(['turnover', 'cleaning', 'maintenance', 'inspection']);
export const TaskStatus = z.enum(['todo', 'in_progress', 'done', 'cancelled']);
export const TaskPriority = z.enum(['low', 'normal', 'high']);
export const TASK_TYPE_LABELS: Record<z.infer<typeof TaskType>, string> = { turnover: 'Turnover clean', cleaning: 'Cleaning', maintenance: 'Maintenance', inspection: 'Inspection' };
export const TASK_STATUS_LABELS: Record<z.infer<typeof TaskStatus>, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' };

export const Task = z.object({
  id: z.string(), type: TaskType, title: z.string(), notes: z.string().nullable(), status: TaskStatus, priority: TaskPriority, dueAt: z.string(),
  unit: z.object({ id: z.string(), name: z.string(), propertyName: z.string(), address: z.string() }),
  booking: z.object({ id: z.string(), ref: z.string(), guestName: z.string() }).nullable(),
  assignee: z.object({ memberId: z.string(), name: z.string() }).nullable(),
  nextArrival: z.object({ checkIn: z.string(), time: z.string(), ref: z.string() }).nullable(),
  photos: z.array(z.object({ fileId: z.string() })), completedAt: z.string().nullable(), createdAt: z.string(),
});
export type Task = z.infer<typeof Task>;
const PhotoIds = z.array(z.string()).max(5, 'Up to 5 photos');
export const CreateTaskInput = z.object({ type: TaskType, unitId: z.string(), title: z.string().trim().min(2).max(120), notes: z.string().max(2000).nullable().optional(), dueAt: z.string().datetime(), assigneeMemberId: z.string().nullable(), priority: TaskPriority.default('normal') });
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;
export const UpdateTaskInput = z.object({ title: z.string().trim().min(2).max(120).optional(), notes: z.string().max(2000).nullable().optional(), dueAt: z.string().datetime().optional(), assigneeMemberId: z.string().nullable().optional(), priority: TaskPriority.optional(), status: z.enum(['todo', 'cancelled']).optional() }).strict();
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;
export const TaskListQuery = z.object({ status: TaskStatus.optional(), assigneeMemberId: z.string().optional(), unitId: z.string().optional(), from: IsoDateSchema.optional(), to: IsoDateSchema.optional() });
export const MyTasksQuery = z.object({ scope: z.enum(['today', 'upcoming']).default('today') });
export const CompleteTaskInput = z.object({ note: z.string().max(1000).optional(), photoFileIds: PhotoIds.default([]) });
export type CompleteTaskInput = z.infer<typeof CompleteTaskInput>;
export const ReportIssueInput = z.object({ title: z.string().trim().min(3).max(120), note: z.string().max(1000).optional(), photoFileIds: PhotoIds.default([]), priority: TaskPriority.default('normal') });
export type ReportIssueInput = z.infer<typeof ReportIssueInput>;
export const Assignee = z.object({ memberId: z.string(), name: z.string(), role: z.string() });
```
- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(shared): turnover due rule and task contracts [HSK-01 HSK-02]"`

---

### Task 2 (T-M6-02) [schema]: Tasks and photos

- [ ] **Step 1: Schema** (add `tasks Task[]` to `Unit`):
```prisma
model Task {
  id                String      @id
  orgId             String      @map("org_id")
  unitId            String      @map("unit_id")
  unit              Unit        @relation(fields: [unitId], references: [id])
  bookingId         String?     @map("booking_id")
  type              String
  title             String
  notes             String?
  dueAt             DateTime    @map("due_at")
  assigneeMemberId  String?     @map("assignee_member_id")
  priority          String      @default("normal")
  status            String      @default("todo")
  completedAt       DateTime?   @map("completed_at")
  completionNote    String?     @map("completion_note")
  createdByMemberId String?     @map("created_by_member_id")
  createdAt         DateTime    @default(now()) @map("created_at")
  updatedAt         DateTime    @updatedAt @map("updated_at")
  photos            TaskPhoto[]

  @@index([orgId, assigneeMemberId, status, dueAt])
  @@index([orgId, status, dueAt])
  @@map("task")
}

model TaskPhoto {
  id                 String   @id
  orgId              String   @map("org_id")
  taskId             String   @map("task_id")
  task               Task     @relation(fields: [taskId], references: [id])
  fileId             String   @map("file_id")
  uploadedByMemberId String?  @map("uploaded_by_member_id")
  createdAt          DateTime @default(now()) @map("created_at")

  @@map("task_photo")
}
```
- [ ] **Step 2: Migration** `0009_tasks` (append):
```sql
ALTER TABLE task       ADD CONSTRAINT task_org_fk       FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE task       ADD CONSTRAINT task_booking_fk   FOREIGN KEY (booking_id) REFERENCES booking(id);
ALTER TABLE task_photo ADD CONSTRAINT task_photo_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE task_photo ADD CONSTRAINT task_photo_file_fk FOREIGN KEY (file_id) REFERENCES file(id);
ALTER TABLE task ADD CONSTRAINT task_type_chk     CHECK (type IN ('turnover','cleaning','maintenance','inspection'));
ALTER TABLE task ADD CONSTRAINT task_status_chk   CHECK (status IN ('todo','in_progress','done','cancelled'));
ALTER TABLE task ADD CONSTRAINT task_priority_chk CHECK (priority IN ('low','normal','high'));
CREATE UNIQUE INDEX task_one_turnover_per_booking ON task (booking_id) WHERE type = 'turnover';
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['task','task_photo'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;
```
- [ ] **Step 3:** `pnpm db:reset && pnpm --filter @boogbe/api prisma:generate && pnpm test:int` → PASS. **Step 4: Commit** `git commit -m "feat(db): tasks and task photos with one-turnover-per-booking index [HSK-01]"`

---

### Task 3 (T-M6-03) [api]: Tasks API — board, own tasks, assignees

**Files:** Create `apps/api/src/modules/tasks/{tasks.module.ts,tasks.controller.ts,my-tasks.controller.ts,tasks.service.ts,task.mapper.ts}`; helper `seedTask` in `test/helpers/inventory.ts`; Test `apps/api/test/tasks.int.ts`.

**Interfaces:**
- Staff (`tasks.read`/`tasks.write`): `GET /v1/tasks` (`TaskListQuery`, ordered by `due_at`), `POST /v1/tasks` (`CreateTaskInput`), `PATCH /v1/tasks/:id` (`UpdateTaskInput`), `GET /v1/tasks/assignees` → `{ items: Assignee[] }` (members with role housekeeper/frontdesk/admin, housekeepers first).
- Own (`tasks.read_own`/`tasks.write_own`; admins/frontdesk also pass because `tasks.write` implies — implement as: allowed if `can(role,'tasks.write')` OR assignee is the caller): `GET /v1/my/tasks?scope=today|upcoming`, `GET /v1/my/tasks/:id`, `POST /v1/my/tasks/:id/start`, `POST /v1/my/tasks/:id/done` (`CompleteTaskInput`; T-M6-04 adds photo handling), `POST /v1/my/tasks/:id/issue` (T-M6-04).
- Today = due on or before end of local today and status in (todo, in_progress), plus tasks done today (so they see progress); upcoming = due after today, next 14 days.
- `TasksService.hydrate(tx, orgId, rows)` fills unit/booking/assignee/nextArrival/photos.
- Own routes are `@SignedIn()` with in-service checks via `TasksService.assertOwnAccess(ctx, task)`, because the permission depends on the row (route-permissions spec accepts `signedIn`).

- [ ] **Step 1: Failing test** `apps/api/test/tasks.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';

describe('tasks [HSK-01 HSK-04 HSK-06]', () => {
  let t: TestApp; let admin: Agent; let orgId: string; let unitId: string;
  let hk1: Awaited<ReturnType<typeof signInAs>>; let hk2: Awaited<ReturnType<typeof signInAs>>;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id;
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'T','T','T',now())`, [orgId]);
    await m.end();
    unitId = await seedUnit(orgId, await seedProperty(orgId), { name: 'Kairo' });
    admin = (await signInAs(t, 'admin', orgId)).agent;
    hk1 = await signInAs(t, 'housekeeper', orgId); hk2 = await signInAs(t, 'housekeeper', orgId);
  });
  const now = () => new Date().toISOString();

  it('admin creates and assigns; housekeeper sees it today and can start/finish', async () => {
    const task = (await admin.post('/v1/tasks').send({ type: 'cleaning', unitId, title: 'Deep clean', dueAt: now(), assigneeMemberId: hk1.memberId, priority: 'normal' }).expect(201)).body;
    const mine = (await hk1.agent.get('/v1/my/tasks?scope=today').expect(200)).body.items;
    expect(mine.map((x: { id: string }) => x.id)).toEqual([task.id]);
    expect(mine[0].unit).toMatchObject({ name: 'Kairo', address: 'Lekki Phase 1' });
    await hk1.agent.post(`/v1/my/tasks/${task.id}/start`).expect(200);
    const done = (await hk1.agent.post(`/v1/my/tasks/${task.id}/done`).send({ note: 'All good', photoFileIds: [] }).expect(200)).body;
    expect(done).toMatchObject({ status: 'done', completedAt: expect.any(String) });
  });

  it("other housekeeper's task is 404", async () => {
    const task = (await admin.post('/v1/tasks').send({ type: 'cleaning', unitId, title: 'Deep clean', dueAt: now(), assigneeMemberId: hk1.memberId, priority: 'normal' }).expect(201)).body;
    await hk2.agent.get(`/v1/my/tasks/${task.id}`).expect(404);
    await hk2.agent.post(`/v1/my/tasks/${task.id}/start`).expect(404);
    await hk2.agent.get('/v1/tasks').expect(403);
  });

  it('board filters by status, assignee and unassigned', async () => {
    await admin.post('/v1/tasks').send({ type: 'cleaning', unitId, title: 'A', dueAt: now(), assigneeMemberId: hk1.memberId, priority: 'normal' }).expect(201);
    await admin.post('/v1/tasks').send({ type: 'inspection', unitId, title: 'B', dueAt: now(), assigneeMemberId: null, priority: 'low' }).expect(201);
    expect((await admin.get('/v1/tasks?assigneeMemberId=unassigned').expect(200)).body.items.map((x: { title: string }) => x.title)).toEqual(['B']);
    expect((await admin.get(`/v1/tasks?assigneeMemberId=${hk1.memberId}`).expect(200)).body.items).toHaveLength(1);
  });

  it('assignees lists housekeepers first; cannot assign a landlord', async () => {
    const owner = await signInAs(t, 'landlord', orgId);
    const a = (await admin.get('/v1/tasks/assignees').expect(200)).body.items;
    expect(a[0].role).toBe('housekeeper');
    expect(a.some((x: { memberId: string }) => x.memberId === owner.memberId)).toBe(false);
    await admin.post('/v1/tasks').send({ type: 'cleaning', unitId, title: 'X', dueAt: now(), assigneeMemberId: owner.memberId, priority: 'normal' }).expect(400);
  });

  it('done tasks cannot be restarted; cancelled tasks disappear from the phone list', async () => {
    const task = (await admin.post('/v1/tasks').send({ type: 'cleaning', unitId, title: 'X', dueAt: now(), assigneeMemberId: hk1.memberId, priority: 'normal' }).expect(201)).body;
    await admin.patch(`/v1/tasks/${task.id}`).send({ status: 'cancelled' }).expect(200);
    expect((await hk1.agent.get('/v1/my/tasks?scope=today').expect(200)).body.items).toEqual([]);
    await hk1.agent.post(`/v1/my/tasks/${task.id}/start`).expect(422);
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement**

`task.mapper.ts`:
```ts
import type { Prisma } from '@prisma/client';
import type { Task } from '@boogbe/shared';

export const TASK_INCLUDE = { unit: { include: { property: true } }, photos: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.TaskInclude;
export type TaskRow = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

export function toTask(r: TaskRow, x: { booking: Task['booking']; assigneeName: string | null; nextArrival: Task['nextArrival'] }): Task {
  return {
    id: r.id, type: r.type as Task['type'], title: r.title, notes: r.notes, status: r.status as Task['status'], priority: r.priority as Task['priority'],
    dueAt: r.dueAt.toISOString(), unit: { id: r.unit.id, name: r.unit.name, propertyName: r.unit.property.name, address: r.unit.property.address },
    booking: x.booking, assignee: r.assigneeMemberId && x.assigneeName ? { memberId: r.assigneeMemberId, name: x.assigneeName } : null,
    nextArrival: x.nextArrival, photos: r.photos.map((p) => ({ fileId: p.fileId })), completedAt: r.completedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
  };
}
```
`tasks.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { ACTIVE_STATUSES, addDays, can, todayIn, zonedTimeToUtc, type CreateTaskInput, type Task, type UpdateTaskInput } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { MemberNames } from '../../common/db/member-names';
import { PrismaService } from '../../common/db/prisma.service';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { TASK_INCLUDE, toTask, type TaskRow } from './task.mapper';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const ASSIGNABLE = ['housekeeper', 'frontdesk', 'admin'];

@Injectable()
export class TasksService {
  constructor(private readonly orgDb: OrgDb, private readonly audit: AuditService, private readonly names: MemberNames, private readonly prisma: PrismaService) {}

  async hydrate(tx: OrgTx, orgId: string, rows: TaskRow[]): Promise<Task[]> {
    const bookings = await tx.booking.findMany({ where: { id: { in: rows.map((r) => r.bookingId).filter((x): x is string => !!x) } }, include: { guest: true } });
    const bm = new Map(bookings.map((b) => [b.id, b]));
    const names = await this.names.forMembers(orgId, rows.map((r) => r.assigneeMemberId).filter((x): x is string => !!x));
    const s = await tx.orgSettings.findFirstOrThrow();
    const out: Task[] = [];
    for (const r of rows) {
      const next = await tx.booking.findFirst({ where: { unitId: r.unitId, status: { in: [...ACTIVE_STATUSES] }, checkIn: { gte: new Date(r.dueAt.toISOString().slice(0, 10) + 'T00:00:00Z') } }, orderBy: { checkIn: 'asc' } });
      const b = r.bookingId ? bm.get(r.bookingId) : undefined;
      out.push(toTask(r, { booking: b ? { id: b.id, ref: b.ref, guestName: b.guest.fullName } : null, assigneeName: r.assigneeMemberId ? names.get(r.assigneeMemberId) ?? null : null, nextArrival: next ? { checkIn: iso(next.checkIn), time: s.checkInTime, ref: next.ref } : null }));
    }
    return out;
  }

  async getIn(tx: OrgTx, orgId: string, id: string) {
    const r = await tx.task.findFirst({ where: { id }, include: TASK_INCLUDE });
    if (!r) throw notFound('Task');
    return (await this.hydrate(tx, orgId, [r]))[0]!;
  }

  async assertAssignable(orgId: string, memberId: string | null) {
    if (!memberId) return;
    const m = await this.prisma.member.findFirst({ where: { organizationId: orgId, id: memberId } });
    if (!m || !ASSIGNABLE.includes(m.role)) throw new AppError('VALIDATION_FAILED', 400, 'Choose a team member who can do tasks');
  }

  async assignees(ctx: OrgCtx) {
    const ms = await this.prisma.member.findMany({ where: { organizationId: ctx.orgId, role: { in: ASSIGNABLE } }, include: { user: { select: { name: true } } } });
    const order = (r: string) => ASSIGNABLE.indexOf(r);
    return { items: ms.sort((a, b) => order(a.role) - order(b.role) || a.user.name.localeCompare(b.user.name)).map((m) => ({ memberId: m.id, name: m.user.name, role: m.role })) };
  }

  list(ctx: OrgCtx, q: { status?: string; assigneeMemberId?: string; unitId?: string; from?: string; to?: string }) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const rows = await tx.task.findMany({
        where: {
          ...(q.status && { status: q.status }), ...(q.unitId && { unitId: q.unitId }),
          ...(q.assigneeMemberId === 'unassigned' ? { assigneeMemberId: null } : q.assigneeMemberId ? { assigneeMemberId: q.assigneeMemberId } : {}),
          ...((q.from || q.to) && { dueAt: { ...(q.from && { gte: zonedTimeToUtc(q.from, '00:00', ctx.timezone) }), ...(q.to && { lt: zonedTimeToUtc(q.to, '00:00', ctx.timezone) }) } }),
        },
        include: TASK_INCLUDE, orderBy: [{ dueAt: 'asc' }], take: 200,
      });
      return { items: await this.hydrate(tx, ctx.orgId, rows) };
    });
  }

  async create(ctx: OrgCtx, input: CreateTaskInput) {
    await this.assertAssignable(ctx.orgId, input.assigneeMemberId);
    return this.orgDb.run(ctx.orgId, async (tx) => {
      if (!(await tx.unit.findFirst({ where: { id: input.unitId } }))) throw new AppError('VALIDATION_FAILED', 400, 'Unit not found');
      const id = newId();
      await tx.task.create({ data: { id, type: input.type, unitId: input.unitId, title: input.title, notes: input.notes ?? null, dueAt: new Date(input.dueAt), assigneeMemberId: input.assigneeMemberId, priority: input.priority, createdByMemberId: ctx.memberId } as never });
      await this.audit.record(tx, { actor: ctx, action: 'task.create', entity: 'task', entityId: id, after: input });
      return this.getIn(tx, ctx.orgId, id);
    });
  }

  async update(ctx: OrgCtx, id: string, input: UpdateTaskInput) {
    if (input.assigneeMemberId !== undefined) await this.assertAssignable(ctx.orgId, input.assigneeMemberId);
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const before = await tx.task.findFirst({ where: { id } });
      if (!before) throw notFound('Task');
      if (before.status === 'done' && input.status) throw new AppError('INVALID_TRANSITION', 422, 'This task is already done');
      await tx.task.updateMany({ where: { id }, data: { ...input, ...(input.dueAt && { dueAt: new Date(input.dueAt) }) } });
      await this.audit.record(tx, { actor: ctx, action: 'task.update', entity: 'task', entityId: id, before, after: input });
      return this.getIn(tx, ctx.orgId, id);
    });
  }

  // ── own tasks ──
  private ownWhere(ctx: OrgCtx) { return can(ctx.role, 'tasks.write') ? {} : { assigneeMemberId: ctx.memberId }; }

  mine(ctx: OrgCtx, scope: 'today' | 'upcoming') {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const today = todayIn(ctx.timezone);
      const startTomorrow = zonedTimeToUtc(addDays(today, 1), '00:00', ctx.timezone);
      const startToday = zonedTimeToUtc(today, '00:00', ctx.timezone);
      const where = scope === 'today'
        ? { assigneeMemberId: ctx.memberId, OR: [{ status: { in: ['todo', 'in_progress'] }, dueAt: { lt: startTomorrow } }, { status: 'done', completedAt: { gte: startToday } }] }
        : { assigneeMemberId: ctx.memberId, status: { in: ['todo', 'in_progress'] }, dueAt: { gte: startTomorrow, lt: zonedTimeToUtc(addDays(today, 15), '00:00', ctx.timezone) } };
      const rows = await tx.task.findMany({ where, include: TASK_INCLUDE, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }] });
      return { items: await this.hydrate(tx, ctx.orgId, rows) };
    });
  }

  async ownIn(tx: OrgTx, ctx: OrgCtx, id: string) {
    const r = await tx.task.findFirst({ where: { id, ...this.ownWhere(ctx) } });
    if (!r) throw notFound('Task');
    return r;
  }

  getOwn(ctx: OrgCtx, id: string) { return this.orgDb.run(ctx.orgId, async (tx) => { await this.ownIn(tx, ctx, id); return this.getIn(tx, ctx.orgId, id); }); }

  start(ctx: OrgCtx, id: string) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await this.ownIn(tx, ctx, id);
      if (r.status !== 'todo') throw new AppError('INVALID_TRANSITION', 422, r.status === 'in_progress' ? 'Already started' : 'This task can no longer be started');
      await tx.task.updateMany({ where: { id }, data: { status: 'in_progress' } });
      return this.getIn(tx, ctx.orgId, id);
    });
  }
}
```
(`done` and `issue` are added in T-M6-04 with photos. `TasksService` reads the global `member` table → add `'modules/tasks/tasks.service.ts'` to `PRISMA_ALLOWED`.)

For housekeepers, `requireOrg(ctx)` works because they have an active org; `SessionGuard` only checks permissions for `permission` rules. Controllers:
```ts
@Controller('tasks')
export class TasksController {
  constructor(private readonly svc: TasksService) {}
  @Get() @Permission('tasks.read') list(@Ctx() c: RequestCtx, @Query() q: ListQ) { return this.svc.list(requireOrg(c), q); }
  @Get('assignees') @Permission('tasks.write') assignees(@Ctx() c: RequestCtx) { return this.svc.assignees(requireOrg(c)); }
  @Post() @Permission('tasks.write') create(@Ctx() c: RequestCtx, @Body() b: CreateDto) { return this.svc.create(requireOrg(c), b); }
  @Patch(':id') @Permission('tasks.write') update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: UpdateDto) { return this.svc.update(requireOrg(c), id, b); }
}
@Controller('my/tasks')
export class MyTasksController {
  constructor(private readonly svc: TasksService) {}
  @Get() @Permission('tasks.read_own') mine(@Ctx() c: RequestCtx, @Query() q: MyQ) { return this.svc.mine(requireOrg(c), q.scope); }
  @Get(':id') @Permission('tasks.read_own') get(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.getOwn(requireOrg(c), id); }
  @Post(':id/start') @HttpCode(200) @Permission('tasks.write_own') start(@Ctx() c: RequestCtx, @Param('id') id: string) { return this.svc.start(requireOrg(c), id); }
}
```
Because admins and front desk must also use these routes (e.g. finishing a task for someone), add `'tasks.read_own'` and `'tasks.write_own'` to the `frontdesk` role in `packages/shared/src/permissions.ts` (admin already has all) and update `permissions.test.ts` expectations for frontdesk. (`ownWhere` lets `tasks.write` holders act on any task.)

Isolation fixture `task` (`seedTask(orgId)`), routes `/^\/v1\/tasks\//` and `/^\/v1\/my\/tasks\//` → `task`.

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(tasks): task board, assignees and housekeeper own-task endpoints [HSK-01 HSK-04 HSK-06]"`

---

### Task 4 (T-M6-04) [api]: Turnover automation, sweep, cancel, issues, photos

**Files:** Create `apps/api/src/modules/tasks/{turnover.service.ts,turnover-sweep.job.ts,tasks.crons.ts}`; modify `tasks.service.ts` (`done`, `issue`), `my-tasks.controller.ts`; Test `apps/api/test/turnover.int.ts`, `apps/api/test/task-photos.int.ts`.

**Interfaces:**
- `TurnoverService.ensureFor(tx, orgId, bookingId): Promise<void>` — computes due via `turnoverDue`, assignee = unit `default_assignee_member_id`, title `Turnover: <unit> after <ref>`; `INSERT … ON CONFLICT DO NOTHING` on the partial unique index (use `$executeRaw` with `ON CONFLICT (booking_id) WHERE type = 'turnover' DO NOTHING`); notifies the assignee (no email) kind `task_issue`? — no: use a new notification kind `task_assigned` (append to `NotificationKind` enum in shared).
- Hooks: `afterTransition` → `checked_out`: `ensureFor`; → `cancelled`/`no_show`: cancel open turnover for that booking.
- `TurnoverSweepJob.run(now?)` hourly per org: bookings with status `confirmed|checked_in` and `check_out <= today(local)` whose local time is past `check_out_time` on the checkout date → `ensureFor` (does **not** change booking status).
- `POST /v1/my/tasks/:id/done` (`tasks.write_own`) `CompleteTaskInput`; `POST /v1/my/tasks/:id/issue` (`tasks.write_own`) `ReportIssueInput` → creates `maintenance` task (unassigned, same unit), attaches photos, notifies admins kind `task_issue` (email true).
- Photo validation: each id is a confirmed `file` of kind `task_photo` uploaded in this org; total photos on the task after insert ≤ 5.

- [ ] **Step 1: Failing tests**

`apps/api/test/turnover.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { TurnoverSweepJob } from '../src/modules/tasks/turnover-sweep.job';

describe('turnovers [HSK-02 HSK-03 HSK-07]', () => {
  let t: TestApp; let fd: Agent; let orgId: string; let unitId: string; let hk: Awaited<ReturnType<typeof signInAs>>;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id;
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'T','T','T',now())`, [orgId]);
    await m.end();
    unitId = await seedUnit(orgId, await seedProperty(orgId), { name: 'Kairo' });
    fd = (await signInAs(t, 'frontdesk', orgId)).agent; hk = await signInAs(t, 'housekeeper', orgId);
    const admin = (await signInAs(t, 'admin', orgId)).agent;
    await admin.patch(`/v1/units/${unitId}`).send({ defaultAssigneeMemberId: hk.memberId }).expect(200);
  });
  const tasks = async () => { const m = await migratorClient(); const { rows } = await m.query(`select type, status, priority, assignee_member_id, booking_id, due_at from task where org_id=$1`, [orgId]); await m.end(); return rows; };

  it('checkout creates one turnover for the default assignee, due before the next arrival', async () => {
    const g = await seedGuest(orgId);
    const b = await seedBooking(orgId, unitId, g, { checkIn: '2026-11-01', checkOut: '2026-11-04', status: 'checked_in' });
    await seedBooking(orgId, unitId, g, { checkIn: '2026-11-04', checkOut: '2026-11-06', status: 'confirmed' });
    await fd.post(`/v1/bookings/${b}/transition`).send({ to: 'checked_out' }).expect(200);
    const r = await tasks();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: 'turnover', priority: 'high', assignee_member_id: hk.memberId, booking_id: b });
    expect(new Date(r[0].due_at).toISOString()).toBe('2026-11-04T13:00:00.000Z');
  });

  it('checkout after sweep keeps one turnover', async () => {
    const b = await seedBooking(orgId, unitId, await seedGuest(orgId), { checkIn: '2026-11-01', checkOut: '2026-11-04', status: 'checked_in' });
    await t.app.get(TurnoverSweepJob).run(new Date('2026-11-04T12:30:00Z')); // 13:30 Lagos, after 12:00 check-out
    await fd.post(`/v1/bookings/${b}/transition`).send({ to: 'checked_out' }).expect(200);
    expect(await tasks()).toHaveLength(1);
  });

  it('sweep waits until check-out time has passed', async () => {
    await seedBooking(orgId, unitId, await seedGuest(orgId), { checkIn: '2026-11-01', checkOut: '2026-11-04', status: 'checked_in' });
    await t.app.get(TurnoverSweepJob).run(new Date('2026-11-04T09:00:00Z')); // 10:00 Lagos
    expect(await tasks()).toHaveLength(0);
  });

  it('no default assignee leaves task unassigned', async () => {
    const admin = (await signInAs(t, 'admin', orgId)).agent;
    await admin.patch(`/v1/units/${unitId}`).send({ defaultAssigneeMemberId: null }).expect(200);
    const b = await seedBooking(orgId, unitId, await seedGuest(orgId), { checkIn: '2026-11-01', checkOut: '2026-11-04', status: 'checked_in' });
    await fd.post(`/v1/bookings/${b}/transition`).send({ to: 'checked_out' }).expect(200);
    expect((await tasks())[0].assignee_member_id).toBeNull();
  });

  it('cancelling a booking cancels its open turnover', async () => {
    const b = await seedBooking(orgId, unitId, await seedGuest(orgId), { checkIn: '2026-11-01', checkOut: '2026-11-04', status: 'confirmed' });
    await t.app.get(TurnoverSweepJob).run(new Date('2026-11-04T12:30:00Z'));
    await fd.post(`/v1/bookings/${b}/cancel`).send({ reason: 'Never arrived' }).expect(200);
    expect((await tasks())[0].status).toBe('cancelled');
  });
});
```
`apps/api/test/task-photos.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { seedProperty, seedUnit } from './helpers/inventory';
import { newId } from '../src/common/db/ids';

describe('task completion, photos and issues [HSK-04 HSK-05]', () => {
  let t: TestApp; let orgId: string; let unitId: string; let hk: Awaited<ReturnType<typeof signInAs>>; let taskId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg()).id;
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'T','T','T',now())`, [orgId]);
    await m.end();
    unitId = await seedUnit(orgId, await seedProperty(orgId));
    hk = await signInAs(t, 'housekeeper', orgId);
    const admin = (await signInAs(t, 'admin', orgId)).agent;
    taskId = (await admin.post('/v1/tasks').send({ type: 'cleaning', unitId, title: 'Clean', dueAt: new Date().toISOString(), assigneeMemberId: hk.memberId, priority: 'normal' }).expect(201)).body.id;
  });
  const photo = async (kind = 'task_photo', confirmed = true) => { const m = await migratorClient(); const id = newId(); await m.query(`insert into file(id, org_id, key, kind, content_type, size_bytes, confirmed) values ($1,$2,$3,$4,'image/jpeg',100,$5)`, [id, orgId, `k/${id}`, kind, confirmed]); await m.end(); return id; };

  it('photo limits', async () => {
    const six = await Promise.all(Array.from({ length: 6 }, () => photo()));
    await hk.agent.post(`/v1/my/tasks/${taskId}/done`).send({ photoFileIds: six }).expect(400);
    await hk.agent.post(`/v1/my/tasks/${taskId}/done`).send({ photoFileIds: [await photo('logo')] }).expect(400);
    await hk.agent.post(`/v1/my/tasks/${taskId}/done`).send({ photoFileIds: [await photo('task_photo', false)] }).expect(400);
    const ok = (await hk.agent.post(`/v1/my/tasks/${taskId}/done`).send({ note: 'Done', photoFileIds: [await photo(), await photo()] }).expect(200)).body;
    expect(ok.photos).toHaveLength(2);
  });

  it('report issue creates an unassigned maintenance task and alerts admins', async () => {
    const admin = await signInAs(t, 'admin', orgId);
    const r = (await hk.agent.post(`/v1/my/tasks/${taskId}/issue`).send({ title: 'AC leaking', note: 'Bedroom 2', photoFileIds: [await photo()], priority: 'high' }).expect(201)).body;
    expect(r).toMatchObject({ type: 'maintenance', title: 'AC leaking', assignee: null, priority: 'high', unit: { id: unitId } });
    expect((await admin.agent.get('/v1/notifications').expect(200)).body.items[0]).toMatchObject({ kind: 'task_issue', link: '/tasks?highlight=' + r.id });
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement**

Append `'task_assigned'` to `NotificationKind` in `packages/shared/src/contracts/notifications.ts`.

`turnover.service.ts`:
```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ACTIVE_STATUSES, turnoverDue } from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { OrgInfo } from '../../common/db/org-info';
import { newId } from '../../common/db/ids';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingHooks } from '../bookings/booking-hooks';

const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class TurnoverService implements OnModuleInit {
  constructor(private readonly orgDb: OrgDb, private readonly orgInfo: OrgInfo, private readonly hooks: BookingHooks, private readonly notifications: NotificationsService) {}

  onModuleInit() {
    this.hooks.register({
      afterTransition: async (tx, ctx, b) => {
        const orgId = ctx?.orgId ?? (await tx.$queryRaw<{ o: string }[]>`SELECT app_current_org() AS o`)[0]!.o;
        if (b.status === 'checked_out') await this.ensureFor(tx, orgId, b.id);
        if (b.status === 'cancelled' || b.status === 'no_show') await tx.task.updateMany({ where: { bookingId: b.id, type: 'turnover', status: { in: ['todo', 'in_progress'] } }, data: { status: 'cancelled' } });
      },
    });
  }

  async ensureFor(tx: OrgTx, orgId: string, bookingId: string) {
    const b = await tx.booking.findFirstOrThrow({ where: { id: bookingId }, include: { unit: true } });
    const next = await tx.booking.findFirst({ where: { unitId: b.unitId, id: { not: b.id }, status: { in: [...ACTIVE_STATUSES] }, checkIn: { gte: b.checkOut } }, orderBy: { checkIn: 'asc' } });
    const s = await tx.orgSettings.findFirstOrThrow();
    const { timezone } = await this.orgInfo.get(orgId);
    const { dueAt, priority } = turnoverDue({ checkOut: iso(b.checkOut), nextCheckIn: next ? iso(next.checkIn) : null, checkInTime: s.checkInTime, timeZone: timezone });
    const id = newId();
    const inserted = await tx.$executeRaw`
      INSERT INTO task (id, org_id, unit_id, booking_id, type, title, due_at, assignee_member_id, priority, status, created_at, updated_at)
      VALUES (${id}, app_current_org(), ${b.unitId}, ${b.id}, 'turnover', ${`Turnover: ${b.unit.name} after ${b.ref}`}, ${dueAt}, ${b.unit.defaultAssigneeMemberId}, ${priority}, 'todo', now(), now())
      ON CONFLICT (booking_id) WHERE type = 'turnover' DO NOTHING`;
    if (inserted && b.unit.defaultAssigneeMemberId) {
      await this.notifications.notifyMember(tx, orgId, b.unit.defaultAssigneeMemberId, { kind: 'task_assigned', title: `New turnover: ${b.unit.name}`, body: `Due ${dueAt.toLocaleString('en-NG', { timeZone: timezone })}`, link: `/hk/tasks/${id}` });
    }
  }
}
```
`turnover-sweep.job.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { todayIn, zonedTimeToUtc } from '@boogbe/shared';
import { OrgDb } from '../../common/db/org-db.service';
import { JobRunner } from '../../common/jobs/job-runner';
import { TurnoverService } from './turnover.service';

@Injectable()
export class TurnoverSweepJob {
  constructor(private readonly runner: JobRunner, private readonly orgDb: OrgDb, private readonly turnovers: TurnoverService) {}
  async run(now = new Date()) {
    return this.runner.forEachActiveOrg('tasks.turnoverSweep', (org) => this.orgDb.run(org.id, async (tx) => {
      const s = await tx.orgSettings.findFirstOrThrow();
      const today = todayIn(org.timezone, now);
      const candidates = await tx.booking.findMany({ where: { status: { in: ['confirmed', 'checked_in'] }, checkOut: { lte: new Date(`${today}T00:00:00Z`) } }, select: { id: true, checkOut: true } });
      for (const b of candidates) {
        const due = zonedTimeToUtc(b.checkOut.toISOString().slice(0, 10), s.checkOutTime, org.timezone);
        if (now >= due) await this.turnovers.ensureFor(tx, org.id, b.id);
      }
    }));
  }
}
```
`tasks.crons.ts` (worker only): `@Cron('15 * * * *') sweep() { return this.job.run(); }`.

`TasksService` additions:
```ts
  private async attachPhotos(tx: OrgTx, ctx: OrgCtx, taskId: string, fileIds: string[]) {
    if (!fileIds.length) return;
    const files = await tx.file.findMany({ where: { id: { in: fileIds }, kind: 'task_photo', confirmed: true } });
    if (files.length !== new Set(fileIds).size) throw new AppError('VALIDATION_FAILED', 400, 'Photo not uploaded');
    const existing = await tx.taskPhoto.count({ where: { taskId } });
    if (existing + files.length > 5) throw new AppError('VALIDATION_FAILED', 400, 'Up to 5 photos per task');
    await tx.taskPhoto.createMany({ data: files.map((f) => ({ id: newId(), taskId, fileId: f.id, uploadedByMemberId: ctx.memberId })) as never });
  }

  done(ctx: OrgCtx, id: string, input: CompleteTaskInput) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await this.ownIn(tx, ctx, id);
      if (r.status === 'done' || r.status === 'cancelled') throw new AppError('INVALID_TRANSITION', 422, 'This task is already closed');
      await this.attachPhotos(tx, ctx, id, input.photoFileIds);
      await tx.task.updateMany({ where: { id }, data: { status: 'done', completedAt: new Date(), completionNote: input.note ?? null } });
      await this.audit.record(tx, { actor: ctx, action: 'task.done', entity: 'task', entityId: id, after: { note: input.note, photos: input.photoFileIds.length } });
      return this.getIn(tx, ctx.orgId, id);
    });
  }

  issue(ctx: OrgCtx, id: string, input: ReportIssueInput) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const r = await this.ownIn(tx, ctx, id);
      const newTask = newId();
      await tx.task.create({ data: { id: newTask, type: 'maintenance', unitId: r.unitId, title: input.title, notes: input.note ?? null, dueAt: new Date(), assigneeMemberId: null, priority: input.priority, createdByMemberId: ctx.memberId } as never });
      await this.attachPhotos(tx, ctx, newTask, input.photoFileIds);
      const unit = await tx.unit.findFirstOrThrow({ where: { id: r.unitId } });
      await this.notifications.notifyRoles(tx, ctx.orgId, ['admin'], { kind: 'task_issue', title: `Issue at ${unit.name}: ${input.title}`, body: input.note, link: `/tasks?highlight=${newTask}` }, { email: input.priority === 'high' });
      return this.getIn(tx, ctx.orgId, newTask);
    });
  }
```
(Inject `NotificationsService`; update the test expectation: the email is only sent for high priority — the notification is always created.) Routes: `@Post(':id/done') @HttpCode(200) @Permission('tasks.write_own')`, `@Post(':id/issue') @Permission('tasks.write_own')` with DTOs. Register `TurnoverService` in `TasksModule` (exported), `TurnoverSweepJob` in `TasksModule`, `TasksCrons` in `WorkerModule`.

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(tasks): automatic turnovers, checkout sweep, cancel with booking, completion photos and issue reports [HSK-02 HSK-03 HSK-05 HSK-07]"`

---

### Task 5 (T-M6-05) [ui]: Task board and unit default assignee

**Files:** Create `apps/app/src/features/tasks/{TasksPage.tsx,TaskForm.tsx,TaskCard.tsx,hooks.ts}`; modify `apps/app/src/features/inventory/UnitForm.tsx` (default assignee select using `/v1/tasks/assignees`), `router.tsx` (`/tasks`, nav "Tasks" `tasks.read`, icon `ClipboardCheck`); Test `apps/app/src/features/tasks/TasksPage.test.tsx`.

**Interfaces:** `TasksPage`: columns To do / In progress / Done today (desktop) or status tabs (mobile); filters: assignee (incl. "Unassigned"), unit, date; card shows type, unit, due (red when overdue), assignee, booking ref link, photo thumbnails (via `/v1/files/:id/url`), priority badge; card actions: assign (select), change due, cancel; "New task" dialog (`TaskForm`). `?highlight=<id>` scrolls to and outlines that card.

- [ ] **Step 1: Failing test**
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { TasksPage } from './TasksPage';

const task = (id: string, status: string, overrides = {}) => ({ id, type: 'turnover', title: `Turnover ${id}`, notes: null, status, priority: 'normal', dueAt: '2026-01-01T13:00:00Z', unit: { id: 'u', name: 'Kairo', propertyName: 'Rock', address: 'Lekki' }, booking: { id: 'b', ref: 'TAN-2610-0001', guestName: 'Ada' }, assignee: null, nextArrival: null, photos: [], completedAt: null, createdAt: '', ...overrides });
vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: vi.fn(async (p: string) => p.startsWith('/v1/tasks/assignees') ? { items: [{ memberId: 'm1', name: 'Bisi', role: 'housekeeper' }] } : { items: [task('t1', 'todo'), task('t2', 'in_progress', { assignee: { memberId: 'm1', name: 'Bisi' } })] }) }));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'admin', timezone: 'Africa/Lagos' } } }) }));

describe('TasksPage', () => {
  it('groups by status, marks overdue and unassigned', async () => {
    render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter><TasksPage /></MemoryRouter></SWRConfig>);
    expect(await screen.findByRole('region', { name: 'To do' })).toHaveTextContent('Turnover t1');
    expect(screen.getByRole('region', { name: 'In progress' })).toHaveTextContent('Bisi');
    expect(screen.getAllByText('Overdue')).toHaveLength(2);
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement**

`hooks.ts`:
```ts
import { z } from 'zod';
import { Assignee, Task } from '@boogbe/shared';
import { useApi } from '../../lib/api';
export const useTasks = (qs: string) => useApi(`/v1/tasks?${qs}`, z.object({ items: z.array(Task) }));
export const useAssignees = (enabled = true) => useApi(enabled ? '/v1/tasks/assignees' : null, z.object({ items: z.array(Assignee) }));
export const useMyTasks = (scope: 'today' | 'upcoming') => useApi(`/v1/my/tasks?scope=${scope}`, z.object({ items: z.array(Task) }));
```
`TaskCard.tsx`:
```tsx
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { TASK_TYPE_LABELS, type Task } from '@boogbe/shared';
import { Badge, Card, Select } from '@boogbe/ui';
import { api } from '../../lib/api';
import { useAssignees } from './hooks';

export function TaskCard({ task, highlight, onChanged, canWrite }: { task: Task; highlight?: boolean; onChanged: () => void; canWrite: boolean }) {
  const { data: people } = useAssignees(canWrite);
  const overdue = task.status !== 'done' && task.status !== 'cancelled' && new Date(task.dueAt) < new Date();
  return (
    <Card id={`task-${task.id}`} className={clsx('flex flex-col gap-1 text-sm', highlight && 'ring-2 ring-brand')}>
      <div className="flex items-center gap-2"><span className="font-medium">{task.title}</span>{task.priority === 'high' && <Badge tone="danger">Urgent</Badge>}</div>
      <p className="text-ink-muted">{TASK_TYPE_LABELS[task.type]} · {task.unit.name} · due {new Date(task.dueAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })} {overdue && <Badge tone="warning">Overdue</Badge>}</p>
      {task.booking && <Link to={`/bookings/${task.booking.id}`} className="text-brand">{task.booking.ref} · {task.booking.guestName}</Link>}
      {canWrite ? (
        <Select aria-label={`Assignee for ${task.title}`} value={task.assignee?.memberId ?? ''} onChange={async (e) => { await api(`/v1/tasks/${task.id}`, { method: 'PATCH', body: { assigneeMemberId: e.target.value || null } }); onChanged(); }}>
          <option value="">Unassigned</option>{people?.items.map((p) => <option key={p.memberId} value={p.memberId}>{p.name}</option>)}
        </Select>
      ) : <span>{task.assignee?.name ?? 'Unassigned'}</span>}
      {task.photos.length > 0 && <p className="text-ink-muted">{task.photos.length} photo{task.photos.length > 1 ? 's' : ''}</p>}
    </Card>
  );
}
```
(The test expects the text "Unassigned" — provided by the select option; and "Bisi" in the In progress region — provided by the selected option.)

`TaskForm.tsx`:
```tsx
import { useState } from 'react';
import { z } from 'zod';
import { TASK_TYPE_LABELS, TaskType, Unit } from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api, ApiError, useApi } from '../../lib/api';
import { useAssignees } from './hooks';

export function TaskForm({ onSaved }: { onSaved: () => void }) {
  const { data: units } = useApi('/v1/units', z.object({ items: z.array(Unit.pick({ id: true, name: true })) }));
  const { data: people } = useAssignees();
  const [v, setV] = useState({ type: 'cleaning' as z.infer<typeof TaskType>, unitId: '', title: '', notes: '', due: new Date(Date.now() + 3_600_000).toISOString().slice(0, 16), assigneeMemberId: '', priority: 'normal' });
  const [err, setErr] = useState<string>();
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      try { await api('/v1/tasks', { method: 'POST', body: { type: v.type, unitId: v.unitId, title: v.title, notes: v.notes || null, dueAt: new Date(v.due).toISOString(), assigneeMemberId: v.assigneeMemberId || null, priority: v.priority } }); onSaved(); }
      catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); }
    }}>
      <Field label="Type"><Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as typeof v.type })}>{TaskType.options.map((t) => <option key={t} value={t}>{TASK_TYPE_LABELS[t]}</option>)}</Select></Field>
      <Field label="Unit"><Select required value={v.unitId} onChange={(e) => setV({ ...v, unitId: e.target.value })}><option value="">Choose…</option>{units?.items.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
      <Field label="What needs doing"><Input required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      <Field label="Due"><Input type="datetime-local" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} /></Field>
      <Field label="Assign to"><Select value={v.assigneeMemberId} onChange={(e) => setV({ ...v, assigneeMemberId: e.target.value })}><option value="">Unassigned</option>{people?.items.map((p) => <option key={p.memberId} value={p.memberId}>{p.name}</option>)}</Select></Field>
      <Field label="Priority"><Select value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">Urgent</option></Select></Field>
      <Field label="Notes"><Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button type="submit">Create task</Button>
    </form>
  );
}
```
`TasksPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { can, TASK_STATUS_LABELS } from '@boogbe/shared';
import { Button, Dialog, Select, Spinner } from '@boogbe/ui';
import { useMe } from '../../lib/use-me';
import { useAssignees, useTasks } from './hooks';
import { TaskCard } from './TaskCard';
import { TaskForm } from './TaskForm';

const COLUMNS = ['todo', 'in_progress', 'done'] as const;

export function TasksPage() {
  const { me } = useMe(); const canWrite = !!me?.activeOrg && can(me.activeOrg.role, 'tasks.write');
  const [params] = useSearchParams(); const highlight = params.get('highlight');
  const [assignee, setAssignee] = useState(''); const [open, setOpen] = useState(false);
  const { data, mutate } = useTasks(new URLSearchParams(assignee ? { assigneeMemberId: assignee } : {}).toString());
  const { data: people } = useAssignees(canWrite);
  useEffect(() => { if (highlight && data) document.getElementById(`task-${highlight}`)?.scrollIntoView({ block: 'center' }); }, [highlight, data]);
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Tasks</h1>
        <Select aria-label="Filter by person" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-48"><option value="">Everyone</option><option value="unassigned">Unassigned</option>{people?.items.map((p) => <option key={p.memberId} value={p.memberId}>{p.name}</option>)}</Select>
        {canWrite && <Button onClick={() => setOpen(true)}>New task</Button>}</div>
      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((c) => (
          <section key={c} aria-label={TASK_STATUS_LABELS[c]} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-ink-muted">{TASK_STATUS_LABELS[c]}</h2>
            {data.items.filter((t) => t.status === c).map((t) => <TaskCard key={t.id} task={t} highlight={t.id === highlight} canWrite={canWrite} onChanged={() => mutate()} />)}
          </section>
        ))}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="New task"><TaskForm onSaved={async () => { setOpen(false); await mutate(); }} /></Dialog>
    </div>
  );
}
```
`UnitForm.tsx`: add `<Field label="Default housekeeper">` select bound to `defaultAssigneeMemberId` (options from `useAssignees()`; empty → `null`).

- [ ] **Step 4:** PASS + build. **Step 5: Commit** `git commit -m "feat(app): task board and default housekeeper per unit [HSK-03 HSK-06]"`

---

### Task 6 (T-M6-06) [ui][e2e]: Housekeeper app, photo compression, E2E-05

**Files:** Create `apps/app/src/features/housekeeper/{HkApp.tsx,HkTaskList.tsx,HkTaskDetail.tsx,DoneSheet.tsx,IssueSheet.tsx}`, `apps/app/src/lib/compress-image.ts`, `apps/app/scripts/size-check.mjs`; modify `router.tsx` (`/hk`, `/hk/tasks/:id` lazy-loaded), `apps/app/package.json` (`size` script); Create `e2e/e05-housekeeper.spec.ts`; Test `apps/app/src/lib/compress-image.test.ts`, `apps/app/src/features/housekeeper/HkTaskList.test.tsx`.

**Interfaces:**
- `compressImage(file: File, opts?: { maxEdge?: number; maxBytes?: number }): Promise<File>` — draws to canvas at ≤ 1600 px longest edge, encodes `image/webp` (fallback `image/jpeg`) starting at quality 0.8 and stepping down 0.1 until ≤ `maxBytes` (default 500 KB) or quality 0.4; returns a new `File` named `photo-<timestamp>.webp|jpg`.
- `HkApp`: own minimal shell (no sidebar): header with operator name + bell, tabs Today / Upcoming, list of `HkTaskList` cards (unit, address, due time, next arrival "Next guest arrives 2:00 pm today", status, big Start / Done buttons ≥ 48 px); `HkTaskDetail` with notes, booking ref, photos, "Report an issue".
- `DoneSheet`: optional note, up to 5 photos (`<input type="file" accept="image/*" capture="environment" multiple>`), each compressed then `uploadFile('task_photo', f)`; shows per-photo progress; submit → `POST /v1/my/tasks/:id/done`.
- `IssueSheet`: title, note, urgent toggle, photos → `POST /v1/my/tasks/:id/issue`.
- Bundle: `HkApp` imported with `React.lazy(() => import('./features/housekeeper/HkApp'))`; `size-check.mjs` finds the chunk(s) for `HkApp` in `dist/assets` via the Vite manifest (`build.manifest: true`) and fails if gzipped JS (entry + hk chunk) > 250 KB.

- [ ] **Step 1: Failing tests**

`compress-image.test.ts` (jsdom has no canvas; test the pure step-down logic by injecting an encoder):
```ts
import { describe, expect, it } from 'vitest';
import { chooseQuality } from './compress-image';

describe('chooseQuality', () => {
  it('steps quality down until under the size limit', async () => {
    const sizes: Record<string, number> = { '0.8': 900_000, '0.7': 700_000, '0.6': 480_000 };
    const q = await chooseQuality(async (quality) => new Blob([new Uint8Array(sizes[quality.toFixed(1)] ?? 100)]), 500_000);
    expect(q.quality).toBeCloseTo(0.6);
    expect(q.blob.size).toBe(480_000);
  });
  it('stops at 0.4 even if still large', async () => {
    const q = await chooseQuality(async () => new Blob([new Uint8Array(800_000)]), 500_000);
    expect(q.quality).toBeCloseTo(0.4);
  });
});
```
`HkTaskList.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { HkTaskList } from './HkTaskList';

vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: vi.fn(async (p: string) => p.includes('/start') ? {} : { items: [{
  id: 't1', type: 'turnover', title: 'Turnover: Kairo after TAN-2610-0001', notes: null, status: 'todo', priority: 'high', dueAt: '2026-11-04T13:00:00Z',
  unit: { id: 'u', name: 'Kairo', propertyName: 'The Rock', address: '3 Olu-Babajide Close' }, booking: null, assignee: null,
  nextArrival: { checkIn: '2026-11-04', time: '14:00', ref: 'TAN-2610-0002' }, photos: [], completedAt: null, createdAt: '' }] }) }));

describe('HkTaskList', () => {
  it('shows address, urgency and next arrival; starts a task', async () => {
    render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter><HkTaskList scope="today" /></MemoryRouter></SWRConfig>);
    expect(await screen.findByText('3 Olu-Babajide Close')).toBeInTheDocument();
    expect(screen.getByText(/Next guest: 4 Nov 2026, 2:00 pm/)).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(api).toHaveBeenCalledWith('/v1/my/tasks/t1/start', { method: 'POST' });
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement**

`compress-image.ts`:
```ts
export async function chooseQuality(encode: (quality: number) => Promise<Blob>, maxBytes: number) {
  let quality = 0.8; let blob = await encode(quality);
  while (blob.size > maxBytes && quality > 0.45) { quality = Math.round((quality - 0.1) * 10) / 10; blob = await encode(quality); }
  return { quality, blob };
}

export async function compressImage(file: File, opts: { maxEdge?: number; maxBytes?: number } = {}): Promise<File> {
  const maxEdge = opts.maxEdge ?? 1600; const maxBytes = opts.maxBytes ?? 500_000;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const webp = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  const type = webp ? 'image/webp' : 'image/jpeg';
  const { blob } = await chooseQuality((q) => new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('Could not process photo'))), type, q)), maxBytes);
  return new File([blob], `photo-${Date.now()}.${webp ? 'webp' : 'jpg'}`, { type });
}
```
`HkTaskList.tsx`:
```tsx
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Spinner } from '@boogbe/ui';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useMyTasks } from '../tasks/hooks';

const time = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h! < 12 ? 'am' : 'pm'}`; };

export function HkTaskList({ scope }: { scope: 'today' | 'upcoming' }) {
  const { data, mutate } = useMyTasks(scope);
  if (!data) return <Spinner />;
  if (!data.items.length) return <EmptyState title={scope === 'today' ? 'Nothing to do today' : 'Nothing coming up'} />;
  return (
    <ul className="flex flex-col gap-3">
      {data.items.map((t) => (
        <li key={t.id}>
          <Card className={`flex flex-col gap-1 ${t.status === 'done' ? 'opacity-60' : ''}`}>
            <div className="flex items-center gap-2"><Link to={`/hk/tasks/${t.id}`} className="text-lg font-semibold">{t.unit.name}</Link>{t.priority === 'high' && <Badge tone="danger">Urgent</Badge>}{t.status === 'done' && <Badge tone="success">Done</Badge>}</div>
            <p>{t.unit.address}</p>
            <p className="text-sm text-ink-muted">Due {new Date(t.dueAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</p>
            {t.nextArrival && <p className="text-sm font-medium text-warning">Next guest: {formatDate(t.nextArrival.checkIn)}, {time(t.nextArrival.time)}</p>}
            <div className="mt-2 flex gap-2">
              {t.status === 'todo' && <Button className="min-h-12 flex-1" onClick={async () => { await api(`/v1/my/tasks/${t.id}/start`, { method: 'POST' }); await mutate(); }}>Start</Button>}
              {(t.status === 'todo' || t.status === 'in_progress') && <Link to={`/hk/tasks/${t.id}?done=1`} className="flex-1"><Button variant={t.status === 'in_progress' ? 'primary' : 'secondary'} className="min-h-12 w-full">Done</Button></Link>}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
```
`DoneSheet.tsx`:
```tsx
import { useState } from 'react';
import { Button, Field, Input } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { compressImage } from '../../lib/compress-image';
import { uploadFile } from '../../lib/upload';

export function PhotoPicker({ ids, setIds, max = 5 }: { ids: string[]; setIds: (ids: string[]) => void; max?: number }) {
  const [busy, setBusy] = useState(0); const [err, setErr] = useState<string>();
  return (
    <div className="flex flex-col gap-2">
      <label className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-lg border border-line px-4 text-sm font-medium">
        Add photos ({ids.length}/{max})
        <input type="file" accept="image/*" capture="environment" multiple className="hidden" disabled={ids.length >= max} onChange={async (e) => {
          const files = [...(e.target.files ?? [])].slice(0, max - ids.length); setErr(undefined); setBusy(files.length);
          const next = [...ids];
          for (const f of files) { try { next.push(await uploadFile('task_photo', await compressImage(f, { maxBytes: 500_000 }))); } catch (x) { setErr((x as Error).message); } setBusy((b) => b - 1); }
          setIds(next); e.target.value = '';
        }} />
      </label>
      {busy > 0 && <p role="status" className="text-sm">Uploading {busy} photo{busy > 1 ? 's' : ''}…</p>}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

export function DoneSheet({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const [note, setNote] = useState(''); const [ids, setIds] = useState<string[]>([]); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      try { await api(`/v1/my/tasks/${taskId}/done`, { method: 'POST', body: { note: note || undefined, photoFileIds: ids } }); onDone(); }
      catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); } finally { setBusy(false); }
    }}>
      <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <PhotoPicker ids={ids} setIds={setIds} />
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button type="submit" className="min-h-12" loading={busy}>Mark as done</Button>
    </form>
  );
}
```
`IssueSheet.tsx`:
```tsx
import { useState } from 'react';
import { Button, Field, Input } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { PhotoPicker } from './DoneSheet';

export function IssueSheet({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const [v, setV] = useState({ title: '', note: '', urgent: false }); const [ids, setIds] = useState<string[]>([]); const [err, setErr] = useState<string>();
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      try { await api(`/v1/my/tasks/${taskId}/issue`, { method: 'POST', body: { title: v.title, note: v.note || undefined, photoFileIds: ids, priority: v.urgent ? 'high' : 'normal' } }); onDone(); }
      catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); }
    }}>
      <Field label="What's wrong?"><Input required minLength={3} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="e.g. AC not cooling" /></Field>
      <Field label="Details"><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      <label className="flex min-h-12 items-center gap-2"><input type="checkbox" checked={v.urgent} onChange={(e) => setV({ ...v, urgent: e.target.checked })} />Urgent — guests arriving soon</label>
      <PhotoPicker ids={ids} setIds={setIds} />
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button type="submit" className="min-h-12">Report issue</Button>
    </form>
  );
}
```
`HkTaskDetail.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Task, TASK_TYPE_LABELS } from '@boogbe/shared';
import { Button, Card, Dialog, Spinner } from '@boogbe/ui';
import { useApi } from '../../lib/api';
import { DoneSheet } from './DoneSheet';
import { IssueSheet } from './IssueSheet';

export function HkTaskDetail() {
  const { id = '' } = useParams(); const [p] = useSearchParams(); const nav = useNavigate();
  const { data: t } = useApi(`/v1/my/tasks/${id}`, Task);
  const [sheet, setSheet] = useState<'done' | 'issue' | null>(p.get('done') ? 'done' : null);
  if (!t) return <Spinner />;
  const back = () => nav('/hk', { replace: true });
  return (
    <div className="flex flex-col gap-3">
      <Card><h1 className="text-xl font-semibold">{t.unit.name}</h1><p>{t.unit.address}</p><p className="text-sm text-ink-muted">{TASK_TYPE_LABELS[t.type]}{t.booking && ` · after ${t.booking.ref}`}</p>{t.notes && <p className="mt-2">{t.notes}</p>}</Card>
      {(t.status === 'todo' || t.status === 'in_progress') && <Button className="min-h-12" onClick={() => setSheet('done')}>Mark as done</Button>}
      <Button variant="secondary" className="min-h-12" onClick={() => setSheet('issue')}>Report an issue</Button>
      <Dialog open={sheet === 'done'} onClose={() => setSheet(null)} title="Finish task"><DoneSheet taskId={t.id} onDone={back} /></Dialog>
      <Dialog open={sheet === 'issue'} onClose={() => setSheet(null)} title="Report an issue"><IssueSheet taskId={t.id} onDone={() => setSheet(null)} /></Dialog>
    </div>
  );
}
```
`HkApp.tsx`:
```tsx
import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { NotificationBell } from '../../components/shell/NotificationBell';
import { useMe } from '../../lib/use-me';
import { HkTaskDetail } from './HkTaskDetail';
import { HkTaskList } from './HkTaskList';

function Lists() {
  const [scope, setScope] = useState<'today' | 'upcoming'>('today');
  return (
    <>
      <div role="tablist" className="mb-3 grid grid-cols-2 rounded-lg bg-surface-2 p-1">
        {(['today', 'upcoming'] as const).map((s) => <button key={s} role="tab" aria-selected={scope === s} onClick={() => setScope(s)} className={`min-h-11 rounded-md text-sm font-medium ${scope === s ? 'bg-surface shadow' : ''}`}>{s === 'today' ? 'Today' : 'Upcoming'}</button>)}
      </div>
      <HkTaskList scope={scope} />
    </>
  );
}

export default function HkApp() {
  const { me } = useMe();
  return (
    <div className="mx-auto min-h-dvh max-w-md p-4">
      <header className="mb-4 flex items-center justify-between"><span className="font-semibold">{me?.activeOrg?.name}</span><NotificationBell /></header>
      <Routes><Route index element={<Lists />} /><Route path="tasks/:id" element={<HkTaskDetail />} /></Routes>
    </div>
  );
}
```
Router: replace the M0 placeholder `/hk` with `{ path: '/hk/*', element: <Suspense fallback={<Spinner />}><HkApp /></Suspense> }` where `const HkApp = lazy(() => import('./features/housekeeper/HkApp'))`.

`apps/app/vite.config.ts`: `build: { sourcemap: true, manifest: true }`. `apps/app/scripts/size-check.mjs`:
```js
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const dist = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', dist), 'utf8'));
const seen = new Set();
function collect(key) {
  const e = manifest[key]; if (!e || seen.has(key)) return; seen.add(key);
  for (const i of e.imports ?? []) collect(i);
}
collect('index.html');
const hk = Object.keys(manifest).find((k) => k.includes('features/housekeeper/HkApp'));
if (!hk) { console.error('HkApp chunk not found — is it lazy-loaded?'); process.exit(1); }
collect(hk);
const bytes = [...seen].map((k) => manifest[k].file).filter((f) => f.endsWith('.js')).reduce((n, f) => n + gzipSync(readFileSync(new URL(f, dist))).length, 0);
console.log(`housekeeper route JS (gzip): ${(bytes / 1024).toFixed(1)} KB`);
if (bytes > 250 * 1024) { console.error('Over the 250 KB budget (NFR-07)'); process.exit(1); }
```
`apps/app/package.json`: `"size": "node scripts/size-check.mjs"`; add `pnpm --filter @boogbe/app run size` after `pnpm build` in `ci.yml`.

`e2e/e05-housekeeper.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { lastEmailTo, resetDb } from './fixtures';
import { createUnit, onboardOperator } from './helpers';

test.beforeAll(() => resetDb());
test.use({ viewport: { width: 360, height: 740 } });

test('E2E-05 checkout creates a turnover the housekeeper finishes with a photo', async ({ page, browser }) => {
  const admin = await onboardOperator(page, browser, 'tanu-hk');
  await createUnit(admin, { property: 'The Rock', unit: 'Kairo', rateNaira: '200000' });
  // invite housekeeper
  await admin.goto('/settings/team');
  await admin.getByLabel('Email').fill('hk@tanu-hk.test');
  await admin.getByLabel('Role').selectOption('housekeeper');
  await admin.getByRole('button', { name: 'Invite' }).click();
  const url = /(http\S+\/auth\/accept-invite\/\S+)/.exec((await lastEmailTo('hk@tanu-hk.test'))!.text)![1]!;
  const hkCtx = await browser.newContext({ viewport: { width: 360, height: 740 } }); const hk = await hkCtx.newPage();
  await hk.goto(url); await hk.getByLabel('Your name').fill('Bisi'); await hk.getByLabel('Password').fill('correct-horse-battery');
  await hk.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(hk).toHaveURL(/\/hk$/);
  // set default housekeeper on the unit
  const units = await (await admin.request.get('/v1/units')).json(); const unitId = units.items[0].id;
  const people = await (await admin.request.get('/v1/tasks/assignees')).json();
  await admin.request.patch(`/v1/units/${unitId}`, { data: { defaultAssigneeMemberId: people.items.find((p: { role: string }) => p.role === 'housekeeper').memberId } });
  // booking: create, confirm, check in, check out
  const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const guest = await (await admin.request.post('/v1/guests', { data: { fullName: 'Ada Guest', phoneE164: '+2348030000001' } })).json();
  const b = await (await admin.request.post('/v1/bookings', { data: { unitId, guestId: guest.id, checkIn: d(0), checkOut: d(1), guestCount: 1, source: 'phone', status: 'confirmed' } })).json();
  await admin.request.post(`/v1/bookings/${b.id}/transition`, { data: { to: 'checked_in' } });
  await admin.request.post(`/v1/bookings/${b.id}/transition`, { data: { to: 'checked_out' } });
  // housekeeper finishes it
  await hk.reload();
  await expect(hk.getByText('Kairo')).toBeVisible();
  await hk.getByRole('button', { name: 'Start' }).click();
  await hk.getByRole('button', { name: 'Done' }).click();
  await hk.locator('input[type=file]').setInputFiles({ name: 'room.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64') });
  await expect(hk.getByText('Add photos (1/5)')).toBeVisible();
  await hk.getByRole('button', { name: 'Mark as done' }).click();
  await expect(hk.getByText('Done')).toBeVisible();
});
```
(Uploads go to `MemoryStorage` in E2E; the presigned URL is `memory://…`, which `fetch` can't PUT to. For E2E only, `MemoryStorage.presignPut` returns `${API_PUBLIC_ORIGIN}/v1/__test/upload/<key>` and `TestSupportController` gains `PUT /v1/__test/upload/*` storing the body into `MemoryStorage` — add both in this task, guarded by `E2E=1` like the mail endpoint.)

- [ ] **Step 4:** unit → PASS; `pnpm --filter @boogbe/app build && pnpm --filter @boogbe/app run size` → under budget; `pnpm test:e2e --project=mobile` → E2E-05 passes.
- [ ] **Step 5: Commit** `git commit -m "feat(app): housekeeper phone app with compressed photo uploads and issue reports; E2E-05 [HSK-04 HSK-05 NFR-07]"`

---

## Self-review notes (completed)
- Coverage: HSK-01 (T1, T2, T3), HSK-02 (T1 rule, T4 hook + sweep), HSK-03 (T4 default assignee, T5 setting), HSK-04 (T3 own lists, T6 UI + photos), HSK-05 (T4 issue, T6), HSK-06 (T3 board, T5), HSK-07 (T4), NFR-07 (T6 size check, 360 px E2E).
- Permission change: frontdesk gains `tasks.read_own`/`tasks.write_own` (T-M6-03) — update `permissions.test.ts` and FRD AUTH-09 matrix note "frontdesk can act on any task".
- New notification kind `task_assigned`; E2E upload shim in `TestSupportController`.
