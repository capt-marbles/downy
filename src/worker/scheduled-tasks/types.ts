import { z } from "zod";

export const ScheduleTypeSchema = z.enum(["interval", "daily", "weekly"]);
export type ScheduleType = z.infer<typeof ScheduleTypeSchema>;

export const ScheduledTaskSchema = z.object({
  id: z.string(),
  agentSlug: z.string(),
  title: z.string(),
  kind: z.string(),
  brief: z.string(),
  scheduleType: ScheduleTypeSchema,
  intervalMinutes: z.number().nullable(),
  timeOfDay: z.string().nullable(),
  dayOfWeek: z.number().nullable(),
  nextDueAt: z.number(),
  lastRunAt: z.number().nullable(),
  lastTaskId: z.string().nullable(),
  runCount: z.number(),
  enabled: z.boolean(),
  lastError: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ScheduledTask = z.infer<typeof ScheduledTaskSchema>;

export const CreateScheduledTaskInputSchema = z.object({
  agentSlug: z.string().optional(),
  title: z.string().min(1).max(120),
  kind: z.string().min(1).max(60),
  brief: z.string().min(10),
  scheduleType: ScheduleTypeSchema,
  intervalMinutes: z
    .number()
    .int()
    .min(5)
    .max(60 * 24 * 365)
    .optional(),
  timeOfDay: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  nextDueAt: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});
export type CreateScheduledTaskInput = z.infer<
  typeof CreateScheduledTaskInputSchema
>;

export const UpdateScheduledTaskInputSchema = z.object({
  enabled: z.boolean().optional(),
  title: z.string().min(1).max(120).optional(),
});
export type UpdateScheduledTaskInput = z.infer<
  typeof UpdateScheduledTaskInputSchema
>;

export function nextDueFromSchedule(
  input: Pick<
    CreateScheduledTaskInput,
    "scheduleType" | "intervalMinutes" | "timeOfDay" | "dayOfWeek" | "nextDueAt"
  >,
  now = Date.now(),
): number {
  if (input.nextDueAt && input.nextDueAt > now) return input.nextDueAt;
  switch (input.scheduleType) {
    case "interval":
      return now + (input.intervalMinutes ?? 60) * 60_000;
    case "daily":
      return nextUtcTime(input.timeOfDay ?? "09:00", now);
    case "weekly":
      return nextUtcTime(input.timeOfDay ?? "09:00", now, input.dayOfWeek ?? 1);
  }
  return input.scheduleType satisfies never;
}

export function nextDueAfterRun(task: ScheduledTask, now = Date.now()): number {
  switch (task.scheduleType) {
    case "interval":
      return now + (task.intervalMinutes ?? 60) * 60_000;
    case "daily":
      return nextUtcTime(task.timeOfDay ?? "09:00", now + 60_000);
    case "weekly":
      return nextUtcTime(
        task.timeOfDay ?? "09:00",
        now + 60_000,
        task.dayOfWeek ?? 1,
      );
  }
  return task.scheduleType satisfies never;
}

function nextUtcTime(
  timeOfDay: string,
  now: number,
  dayOfWeek?: number,
): number {
  const [hhRaw, mmRaw] = timeOfDay.split(":");
  const hours = Number(hhRaw);
  const minutes = Number(mmRaw);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) {
    throw new Error(`Invalid time_of_day: ${timeOfDay}`);
  }
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time_of_day: ${timeOfDay}`);
  }
  const base = new Date(now);
  const candidate = new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate(),
      hours,
      minutes,
      0,
      0,
    ),
  );
  if (dayOfWeek != null) {
    const delta = (dayOfWeek - candidate.getUTCDay() + 7) % 7;
    candidate.setUTCDate(candidate.getUTCDate() + delta);
  }
  if (candidate.getTime() <= now) {
    candidate.setUTCDate(candidate.getUTCDate() + (dayOfWeek == null ? 1 : 7));
  }
  return candidate.getTime();
}
