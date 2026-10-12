import { z } from 'zod';
import { IsoDateSchema } from './common';

export const TaskType = z.enum(['turnover', 'cleaning', 'maintenance', 'inspection']);
export type TaskType = z.infer<typeof TaskType>;
export const TaskStatus = z.enum(['todo', 'in_progress', 'done', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatus>;
export const TaskPriority = z.enum(['low', 'normal', 'high']);
export type TaskPriority = z.infer<typeof TaskPriority>;
export const TASK_TYPE_LABELS: Record<TaskType, string> = { turnover: 'Turnover clean', cleaning: 'Cleaning', maintenance: 'Maintenance', inspection: 'Inspection' };
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' };

export const Task = z.object({
  id: z.string(), type: TaskType, title: z.string(), notes: z.string().nullable(), status: TaskStatus, priority: TaskPriority, dueAt: z.string(),
  unit: z.object({ id: z.string(), name: z.string(), propertyName: z.string(), address: z.string() }),
  booking: z.object({ id: z.string(), ref: z.string(), guestName: z.string() }).nullable(),
  assignee: z.object({ memberId: z.string(), name: z.string() }).nullable(),
  nextArrival: z.object({ checkIn: z.string(), time: z.string(), ref: z.string() }).nullable(),
  photos: z.array(z.object({ fileId: z.string() })), completedAt: z.string().nullable(), createdAt: z.string(),
});
export type Task = z.infer<typeof Task>;
const PhotoIds = z.array(z.string()).max(5, 'Up to 5 photos').refine((ids) => new Set(ids).size === ids.length, 'The same photo is attached twice');
export const CreateTaskInput = z.object({ type: TaskType, unitId: z.string(), title: z.string().trim().min(2).max(120), notes: z.string().max(2000).nullable().optional(), dueAt: z.string().datetime(), assigneeMemberId: z.string().nullable(), priority: TaskPriority.default('normal') });
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;
export const UpdateTaskInput = z.object({ title: z.string().trim().min(2).max(120).optional(), notes: z.string().max(2000).nullable().optional(), dueAt: z.string().datetime().optional(), assigneeMemberId: z.string().nullable().optional(), priority: TaskPriority.optional(), status: z.enum(['todo', 'cancelled']).optional() }).strict();
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;
export const TaskListQuery = z.object({ status: TaskStatus.optional(), assigneeMemberId: z.string().optional(), unitId: z.string().optional(), from: IsoDateSchema.optional(), to: IsoDateSchema.optional() });
export type TaskListQuery = z.infer<typeof TaskListQuery>;
export const MyTasksQuery = z.object({ scope: z.enum(['today', 'upcoming']).default('today') });
export type MyTasksQuery = z.infer<typeof MyTasksQuery>;
export const CompleteTaskInput = z.object({ note: z.string().max(1000).optional(), photoFileIds: PhotoIds.default([]) });
export type CompleteTaskInput = z.infer<typeof CompleteTaskInput>;
export const ReportIssueInput = z.object({ title: z.string().trim().min(3).max(120), note: z.string().max(1000).optional(), photoFileIds: PhotoIds.default([]), priority: TaskPriority.default('normal') });
export type ReportIssueInput = z.infer<typeof ReportIssueInput>;
export const Assignee = z.object({ memberId: z.string(), name: z.string(), role: z.string() });
export type Assignee = z.infer<typeof Assignee>;
