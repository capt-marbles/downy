import { z } from "zod";
import { StandingGrantsSchema } from "../../lib/standing-grants";

export const ScheduleTypeSchema = z.enum(["interval", "daily", "weekly"]);
export type ScheduleType = z.infer<typeof ScheduleTypeSchema>;

const TimezoneSchema = z.string().refine((zone) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}, "Invalid IANA timezone");

export const ScheduledTaskSchema = z.object({
  id: z.string(),
  agentSlug: z.string(),
  title: z.string(),
  kind: z.string(),
  brief: z.string(),
  scheduleType: ScheduleTypeSchema,
  timezone: TimezoneSchema,
  intervalMinutes: z.number().nullable(),
  timeOfDay: z.string().nullable(),
  dayOfWeek: z.number().nullable(),
  nextDueAt: z.number(),
  lastRunAt: z.number().nullable(),
  lastTaskId: z.string().nullable(),
  runCount: z.number(),
  enabled: z.boolean(),
  lastError: z.string().nullable(),
  // Standing approvals granted when the operator confirmed the schedule card.
  grants: StandingGrantsSchema.default([]),
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
  timezone: TimezoneSchema.default("America/Chicago"),
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
  grants: StandingGrantsSchema.optional(),
});
export type CreateScheduledTaskInput = z.input<
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
    | "scheduleType"
    | "intervalMinutes"
    | "timeOfDay"
    | "dayOfWeek"
    | "nextDueAt"
    | "timezone"
  >,
  now = Date.now(),
): number {
  if (input.nextDueAt && input.nextDueAt > now) return input.nextDueAt;
  switch (input.scheduleType) {
    case "interval":
      return now + (input.intervalMinutes ?? 60) * 60_000;
    case "daily":
      return nextUtcTime(
        input.timeOfDay ?? "09:00",
        now,
        input.timezone ?? "America/Chicago",
      );
    case "weekly":
      return nextUtcTime(
        input.timeOfDay ?? "09:00",
        now,
        input.timezone ?? "America/Chicago",
        input.dayOfWeek ?? 1,
      );
  }
  return input.scheduleType satisfies never;
}

export function nextDueAfterRun(task: ScheduledTask, now = Date.now()): number {
  switch (task.scheduleType) {
    case "interval":
      return now + (task.intervalMinutes ?? 60) * 60_000;
    case "daily":
      return nextUtcTime(task.timeOfDay ?? "09:00", now, task.timezone);
    case "weekly":
      return nextUtcTime(
        task.timeOfDay ?? "09:00",
        now,
        task.timezone,
        task.dayOfWeek ?? 1,
      );
  }
  return task.scheduleType satisfies never;
}

// Resolve calendar dates in the task's zone. Gap: shift forward by the gap
// (02:30 -> 03:30). Repeat: run only the earlier occurrence, once per date.
function nextUtcTime(
  timeOfDay: string,
  now: number,
  timezone: string,
  dayOfWeek?: number,
): number {
  const [hours, minutes] = timeOfDay.split(":").map(Number);
  if (
    !Number.isInteger(hours) ||
    hours < 0 ||
    hours > 23 ||
    !Number.isInteger(minutes) ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new Error(`Invalid time_of_day: ${timeOfDay}`);
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const localEpoch = (epoch: number): number => {
    const parts = Object.fromEntries(
      formatter.formatToParts(epoch).map((p) => [p.type, p.value]),
    );
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
  };
  const date = new Date(localEpoch(now));
  date.setUTCHours(hours, minutes, 0, 0);
  for (let day = 0; day < 9; day += 1) {
    if (dayOfWeek == null || date.getUTCDay() === dayOfWeek) {
      const wall = date.getTime();
      const offsets = new Set<number>();
      for (let delta = -48; delta <= 48; delta += 6) {
        const probe = wall + delta * 3_600_000;
        offsets.add(localEpoch(probe) - probe);
      }
      const candidates = [...offsets].map((offset) => wall - offset);
      const exact = candidates.filter((epoch) => localEpoch(epoch) === wall);
      const shifted = candidates.filter((epoch) => localEpoch(epoch) > wall);
      const candidate = exact.length
        ? Math.min(...exact)
        : shifted.reduce<number | undefined>(
            (best, epoch) =>
              best === undefined || localEpoch(epoch) < localEpoch(best)
                ? epoch
                : best,
            undefined,
          );
      if (candidate != null && candidate > now) return candidate;
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  throw new Error("Cannot resolve next local schedule occurrence");
}
