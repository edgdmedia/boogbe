import { describe, expect, it } from 'vitest';
import { CompleteTaskInput, CreateTaskInput, ReportIssueInput, TaskListQuery, UpdateTaskInput } from '../contracts/tasks';
import { turnoverDue } from './turnover';

const lagos = { checkInTime: '14:00', timeZone: 'Africa/Lagos' };

describe('turnoverDue [HSK-02]', () => {
  it('same-day arrival is due at check-in time, high priority', () => {
    expect(turnoverDue({ checkOut: '2026-11-04', nextCheckIn: '2026-11-04', ...lagos }))
      .toEqual({ dueAt: new Date('2026-11-04T13:00:00Z'), priority: 'high' });
  });
  it('next-day arrival is due at that check-in time, normal priority', () => {
    expect(turnoverDue({ checkOut: '2026-11-04', nextCheckIn: '2026-11-05', ...lagos }))
      .toEqual({ dueAt: new Date('2026-11-05T13:00:00Z'), priority: 'normal' });
  });
  it('no near arrival → end of next day (18:00 local)', () => {
    expect(turnoverDue({ checkOut: '2026-11-04', nextCheckIn: '2026-11-20', ...lagos }))
      .toEqual({ dueAt: new Date('2026-11-05T17:00:00Z'), priority: 'normal' });
    expect(turnoverDue({ checkOut: '2026-11-04', nextCheckIn: null, ...lagos }).dueAt).toEqual(new Date('2026-11-05T17:00:00Z'));
  });
  it('an arrival two days later is not near', () => {
    expect(turnoverDue({ checkOut: '2026-11-04', nextCheckIn: '2026-11-06', ...lagos }).dueAt).toEqual(new Date('2026-11-05T17:00:00Z'));
  });
  it('rolls over month and year ends', () => {
    expect(turnoverDue({ checkOut: '2026-12-31', nextCheckIn: null, ...lagos }).dueAt).toEqual(new Date('2027-01-01T17:00:00Z'));
    expect(turnoverDue({ checkOut: '2026-12-31', nextCheckIn: '2027-01-01', ...lagos }).dueAt).toEqual(new Date('2027-01-01T13:00:00Z'));
  });
  it('uses the operator check-in time and time zone', () => {
    expect(turnoverDue({ checkOut: '2026-11-04', nextCheckIn: '2026-11-04', checkInTime: '15:30', timeZone: 'Africa/Lagos' }).dueAt).toEqual(new Date('2026-11-04T14:30:00Z'));
    expect(turnoverDue({ checkOut: '2026-07-04', nextCheckIn: null, checkInTime: '14:00', timeZone: 'Europe/London' }).dueAt).toEqual(new Date('2026-07-05T17:00:00Z'));
  });
  it('refuses a next arrival before the check-out', () => {
    expect(() => turnoverDue({ checkOut: '2026-11-04', nextCheckIn: '2026-11-03', ...lagos })).toThrow('Next arrival is before check-out');
  });
});

describe('task contracts [HSK-01]', () => {
  it('allows up to 5 photos when completing', () => {
    expect(CompleteTaskInput.parse({}).photoFileIds).toEqual([]);
    expect(CompleteTaskInput.safeParse({ photoFileIds: ['1', '2', '3', '4', '5'] }).success).toBe(true);
    expect(CompleteTaskInput.safeParse({ photoFileIds: ['1', '2', '3', '4', '5', '6'] }).success).toBe(false);
  });
  it('refuses the same photo twice', () => {
    expect(CompleteTaskInput.safeParse({ photoFileIds: ['1', '1'] }).success).toBe(false);
    expect(ReportIssueInput.safeParse({ title: 'Leaking tap', photoFileIds: ['1', '1'] }).success).toBe(false);
  });
  it('issues default to normal priority', () => {
    expect(ReportIssueInput.parse({ title: 'Leaking tap' })).toMatchObject({ priority: 'normal', photoFileIds: [] });
  });
  it('a new task needs a real date-time and defaults to normal priority', () => {
    const t = { type: 'cleaning', unitId: 'u', title: 'Deep clean', dueAt: '2026-11-04T13:00:00Z', assigneeMemberId: null };
    expect(CreateTaskInput.parse(t).priority).toBe('normal');
    expect(CreateTaskInput.safeParse({ ...t, dueAt: '2026-11-04' }).success).toBe(false);
  });
  it('refuses empty unit and assignee ids', () => {
    const t = { type: 'cleaning', unitId: 'u', title: 'Deep clean', dueAt: '2026-11-04T13:00:00Z', assigneeMemberId: null };
    expect(CreateTaskInput.safeParse({ ...t, unitId: '' }).success).toBe(false);
    expect(CreateTaskInput.safeParse({ ...t, assigneeMemberId: '' }).success).toBe(false);
    expect(UpdateTaskInput.safeParse({ assigneeMemberId: '' }).success).toBe(false);
    expect(UpdateTaskInput.safeParse({ assigneeMemberId: null }).success).toBe(true);
  });
  it('accepts a due time with a UTC offset', () => {
    const t = { type: 'cleaning', unitId: 'u', title: 'Deep clean', dueAt: '2026-11-04T14:00:00+01:00', assigneeMemberId: null };
    expect(CreateTaskInput.safeParse(t).success).toBe(true);
    expect(UpdateTaskInput.safeParse({ dueAt: '2026-11-04T14:00:00+01:00' }).success).toBe(true);
  });
  it('task list refuses a range that ends before it starts', () => {
    expect(TaskListQuery.safeParse({ from: '2026-11-01', to: '2026-11-30' }).success).toBe(true);
    expect(TaskListQuery.safeParse({ from: '2026-11-01' }).success).toBe(true);
    const r = TaskListQuery.safeParse({ from: '2026-11-30', to: '2026-11-01' });
    expect(r.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([['to', 'End date is before the start date']]);
  });
  it('staff can only reopen or cancel through an update', () => {
    expect(UpdateTaskInput.safeParse({ status: 'cancelled' }).success).toBe(true);
    expect(UpdateTaskInput.safeParse({ status: 'done' }).success).toBe(false);
    expect(UpdateTaskInput.safeParse({ completedAt: 'x' }).success).toBe(false);
  });
});
