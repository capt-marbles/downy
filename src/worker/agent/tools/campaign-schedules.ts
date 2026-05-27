import { tool } from "ai";
import { z } from "zod";

import { createScheduledTask } from "../../scheduled-tasks/db";
import {
  CAMPAIGN_SCHEDULE_PRESETS,
  CreateCampaignScheduleInputSchema,
  campaignScheduleInputToScheduledTask,
} from "../../campaign-room/schedules";

export function createListCampaignSchedulePresetsTool() {
  return tool({
    description:
      "List Campaign Room scheduled task presets for recurring GTM content, lead sourcing, digest, and draft review workflows.",
    inputSchema: z.object({}),
    execute: async () => ({ presets: CAMPAIGN_SCHEDULE_PRESETS }),
  });
}

export function createScheduleCampaignRoomPresetTool(args: {
  db: D1Database;
  agentSlug: string;
}) {
  return tool({
    description:
      "Create a recurring Campaign Room scheduled task from a GTM preset. Use for recurring content angles, lead sourcing, weekly GTM digest, or draft review. Schedules are UTC. Sending/posting remains operator-gated.",
    inputSchema: CreateCampaignScheduleInputSchema,
    execute: async (input) => ({
      scheduledTask: await createScheduledTask(
        args.db,
        campaignScheduleInputToScheduledTask({
          agentSlug: args.agentSlug,
          input,
        }),
      ),
    }),
  });
}
