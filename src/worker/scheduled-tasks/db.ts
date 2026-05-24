import { isValidSlug } from "../lib/get-agent";
import {
  CreateScheduledTaskInputSchema,
  ScheduledTaskSchema,
  UpdateScheduledTaskInputSchema,
  nextDueFromSchedule,
  type CreateScheduledTaskInput,
  type ScheduledTask,
  type UpdateScheduledTaskInput,
} from "./types";

type ScheduledTaskRow = {
  id: string;
  agent_slug: string;
  title: string;
  kind: string;
  brief: string;
  schedule_type: "interval" | "daily" | "weekly";
  interval_minutes: number | null;
  time_of_day: string | null;
  day_of_week: number | null;
  next_due_at: number;
  last_run_at: number | null;
  last_task_id: string | null;
  run_count: number;
  enabled: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

function rowToTask(row: ScheduledTaskRow): ScheduledTask {
  return ScheduledTaskSchema.parse({
    id: row.id,
    agentSlug: row.agent_slug,
    title: row.title,
    kind: row.kind,
    brief: row.brief,
    scheduleType: row.schedule_type,
    intervalMinutes: row.interval_minutes,
    timeOfDay: row.time_of_day,
    dayOfWeek: row.day_of_week,
    nextDueAt: row.next_due_at,
    lastRunAt: row.last_run_at,
    lastTaskId: row.last_task_id,
    runCount: row.run_count,
    enabled: row.enabled !== 0,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function createScheduledTask(
  db: D1Database,
  input: CreateScheduledTaskInput,
): Promise<ScheduledTask> {
  const parsed = CreateScheduledTaskInputSchema.parse(input);
  const agentSlug = parsed.agentSlug ?? "default";
  if (!isValidSlug(agentSlug) && agentSlug !== "default") {
    throw new Error(`Invalid agent slug: ${agentSlug}`);
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  const nextDueAt = nextDueFromSchedule(parsed, now);
  await db
    .prepare(
      `INSERT INTO scheduled_tasks (
        id, agent_slug, title, kind, brief, schedule_type, interval_minutes,
        time_of_day, day_of_week, next_due_at, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      agentSlug,
      parsed.title,
      parsed.kind,
      parsed.brief,
      parsed.scheduleType,
      parsed.intervalMinutes ?? null,
      parsed.timeOfDay ?? null,
      parsed.dayOfWeek ?? null,
      nextDueAt,
      parsed.enabled === false ? 0 : 1,
      now,
      now,
    )
    .run();
  const task = await getScheduledTask(db, id);
  if (!task) throw new Error("Failed to read back scheduled task");
  return task;
}

export async function listScheduledTasks(
  db: D1Database,
  opts?: { agentSlug?: string; includeDisabled?: boolean },
): Promise<ScheduledTask[]> {
  const clauses: string[] = [];
  const binds: Array<string | number> = [];
  if (opts?.agentSlug) {
    clauses.push("agent_slug = ?");
    binds.push(opts.agentSlug);
  }
  if (!opts?.includeDisabled) clauses.push("enabled = 1");
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await db
    .prepare(
      `SELECT * FROM scheduled_tasks ${where} ORDER BY enabled DESC, next_due_at ASC`,
    )
    .bind(...binds)
    .all<ScheduledTaskRow>();
  return (result.results ?? []).map(rowToTask);
}

export async function listDueScheduledTasks(
  db: D1Database,
  now = Date.now(),
  limit = 20,
): Promise<ScheduledTask[]> {
  const result = await db
    .prepare(
      `SELECT * FROM scheduled_tasks
       WHERE enabled = 1 AND next_due_at <= ?
       ORDER BY next_due_at ASC
       LIMIT ?`,
    )
    .bind(now, limit)
    .all<ScheduledTaskRow>();
  return (result.results ?? []).map(rowToTask);
}

export async function getScheduledTask(
  db: D1Database,
  id: string,
): Promise<ScheduledTask | null> {
  const row = await db
    .prepare("SELECT * FROM scheduled_tasks WHERE id = ?")
    .bind(id)
    .first<ScheduledTaskRow>();
  return row ? rowToTask(row) : null;
}

export async function updateScheduledTask(
  db: D1Database,
  id: string,
  input: UpdateScheduledTaskInput,
): Promise<ScheduledTask> {
  const parsed = UpdateScheduledTaskInputSchema.parse(input);
  const current = await getScheduledTask(db, id);
  if (!current) throw new Error(`Unknown scheduled task: ${id}`);
  const now = Date.now();
  await db
    .prepare(
      `UPDATE scheduled_tasks
       SET title = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      parsed.title ?? current.title,
      (parsed.enabled ?? current.enabled) ? 1 : 0,
      now,
      id,
    )
    .run();
  const updated = await getScheduledTask(db, id);
  if (!updated) throw new Error(`Unknown scheduled task: ${id}`);
  return updated;
}

export async function deleteScheduledTask(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").bind(id).run();
}

export async function markScheduledTaskDispatched(
  db: D1Database,
  task: ScheduledTask,
  taskId: string,
  now = Date.now(),
): Promise<void> {
  const nextDueAt = nextDueFromRun(task, now);
  await db
    .prepare(
      `UPDATE scheduled_tasks
       SET next_due_at = ?, last_run_at = ?, last_task_id = ?,
           run_count = run_count + 1, last_error = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(nextDueAt, now, taskId, now, task.id)
    .run();
}

export async function markScheduledTaskFailed(
  db: D1Database,
  task: ScheduledTask,
  error: string,
  now = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE scheduled_tasks
       SET next_due_at = ?, last_error = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(now + 5 * 60_000, error.slice(0, 1000), now, task.id)
    .run();
}

function nextDueFromRun(task: ScheduledTask, now: number): number {
  switch (task.scheduleType) {
    case "interval":
      return now + (task.intervalMinutes ?? 60) * 60_000;
    case "daily":
    case "weekly": {
      const input: CreateScheduledTaskInput = {
        title: task.title,
        kind: task.kind,
        brief: task.brief,
        scheduleType: task.scheduleType,
        timeOfDay: task.timeOfDay ?? undefined,
        dayOfWeek: task.dayOfWeek ?? undefined,
      };
      return nextDueFromSchedule(input, now + 60_000);
    }
  }
  return task.scheduleType satisfies never;
}
