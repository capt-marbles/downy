import { tool } from "ai";
import { z } from "zod";

import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
  updateScheduledTask,
} from "../../scheduled-tasks/db";
import { CreateScheduledTaskInputSchema } from "../../scheduled-tasks/types";

const createInputSchema = CreateScheduledTaskInputSchema.omit({
  agentSlug: true,
  grants: true,
}).describe(
  "Create a recurring scheduled background task for this agent. Times use the IANA timezone (default America/Chicago), including daylight saving time. scheduleType='interval' uses intervalMinutes; 'daily' uses timeOfDay HH:MM; 'weekly' uses dayOfWeek 0=Sun..6=Sat plus timeOfDay.",
);

export function createScheduleTaskTool(args: {
  db: D1Database;
  agentSlug: string;
}) {
  return tool({
    description:
      "Schedule this agent to run a recurring background task that only reads and writes the workspace. Use this when the user wants an automated check/report/research task to run later or repeatedly. If the task must write to a connected service unattended (create Airtable records, post to Slack), do NOT use this tool: propose the schedule with stage_action kind schedule_task including grants, so the card the operator confirms carries the standing approval. Be specific in the brief because scheduled workers do not have current chat context.",
    inputSchema: createInputSchema,
    execute: async (input) => {
      const task = await createScheduledTask(args.db, {
        ...input,
        agentSlug: args.agentSlug,
      });
      return { scheduledTask: task };
    },
  });
}

export function createListScheduledTasksTool(args: {
  db: D1Database;
  agentSlug: string;
}) {
  return tool({
    description:
      "List this agent's scheduled recurring tasks, including their timezone and next UTC due time.",
    inputSchema: z.object({ includeDisabled: z.boolean().optional() }),
    execute: async ({ includeDisabled }) => ({
      scheduledTasks: await listScheduledTasks(args.db, {
        agentSlug: args.agentSlug,
        includeDisabled: includeDisabled ?? true,
      }),
    }),
  });
}

export function createUpdateScheduledTaskTool(args: { db: D1Database }) {
  return tool({
    description:
      "Enable/disable or rename a scheduled task by id. Disable instead of delete when the user may want to resume it later.",
    inputSchema: z.object({
      id: z.string().min(1),
      enabled: z.boolean().optional(),
      title: z.string().min(1).max(120).optional(),
    }),
    execute: async ({ id, enabled, title }) => ({
      scheduledTask: await updateScheduledTask(args.db, id, {
        enabled,
        title,
      }),
    }),
  });
}

export function createDeleteScheduledTaskTool(args: { db: D1Database }) {
  return tool({
    description:
      "Permanently delete a scheduled task by id. Confirm with the user before deleting; disabling is usually safer.",
    inputSchema: z.object({ id: z.string().min(1) }),
    execute: async ({ id }) => {
      await deleteScheduledTask(args.db, id);
      return { deleted: true, id };
    },
  });
}
