import { z } from "zod";

import type { CreateScheduledTaskInput } from "../scheduled-tasks/types";

export const CampaignSchedulePresetSchema = z.enum([
  "weekly-content-angles",
  "daily-lead-sourcing",
  "weekly-campaign-digest",
  "daily-draft-review",
]);
export type CampaignSchedulePreset = z.infer<
  typeof CampaignSchedulePresetSchema
>;

export type CampaignSchedulePresetDefinition = {
  id: CampaignSchedulePreset;
  title: string;
  kind: string;
  defaultSchedule: Pick<
    CreateScheduledTaskInput,
    "scheduleType" | "intervalMinutes" | "timeOfDay" | "dayOfWeek"
  >;
  brief: string;
};

export const CAMPAIGN_SCHEDULE_PRESETS: CampaignSchedulePresetDefinition[] = [
  {
    id: "weekly-content-angles",
    title: "Campaign Room weekly content angles",
    kind: "campaign_room_content_angles",
    defaultSchedule: {
      scheduleType: "weekly",
      dayOfWeek: 1,
      timeOfDay: "14:00",
    },
    brief:
      "Run the Campaign Room content workflow. Scan recent GTM-relevant sources, identify content angles, create or update a campaign-content-v1 workflow, and produce source notes plus a campaign brief. Do not publish. Prepare an operator summary with recommended content angles.",
  },
  {
    id: "daily-lead-sourcing",
    title: "Campaign Room daily lead sourcing",
    kind: "campaign_room_lead_sourcing",
    defaultSchedule: { scheduleType: "daily", timeOfDay: "15:00" },
    brief:
      "Run the Campaign Room lead sourcing workflow. Use the current ICP memory/context to find a small batch of source-backed candidate accounts or leads, write campaign lead list/enrichment artifacts, and prepare them for operator review. Do not contact leads automatically.",
  },
  {
    id: "weekly-campaign-digest",
    title: "Campaign Room weekly GTM digest",
    kind: "campaign_room_digest",
    defaultSchedule: {
      scheduleType: "weekly",
      dayOfWeek: 5,
      timeOfDay: "16:00",
    },
    brief:
      "Run the campaign-digest-v1 workflow. Summarize the week's GTM signals, content opportunities, lead/account opportunities, blocked items, and recommended next actions. Produce a campaign digest artifact for operator review.",
  },
  {
    id: "daily-draft-review",
    title: "Campaign Room daily draft review",
    kind: "campaign_room_draft_review",
    defaultSchedule: { scheduleType: "daily", timeOfDay: "17:00" },
    brief:
      "Review open Campaign Room workflows for drafts, email sequences, lead batches, or publish/send packages waiting on review. Produce an operator summary of what is ready, what needs revision, and what should be deferred. Do not post, send email, or modify CRM records.",
  },
];

export const CreateCampaignScheduleInputSchema = z.object({
  preset: CampaignSchedulePresetSchema,
  title: z.string().min(1).max(120).optional(),
  briefAddendum: z.string().max(2000).optional(),
  scheduleType: z.enum(["interval", "daily", "weekly"]).optional(),
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
  enabled: z.boolean().optional(),
});
export type CreateCampaignScheduleInput = z.infer<
  typeof CreateCampaignScheduleInputSchema
>;

export function campaignScheduleInputToScheduledTask(args: {
  agentSlug: string;
  input: CreateCampaignScheduleInput;
}): CreateScheduledTaskInput {
  const preset = CAMPAIGN_SCHEDULE_PRESETS.find(
    (candidate) => candidate.id === args.input.preset,
  );
  if (!preset)
    throw new Error(`Unknown campaign schedule preset: ${args.input.preset}`);
  const scheduleType =
    args.input.scheduleType ?? preset.defaultSchedule.scheduleType;
  const brief = args.input.briefAddendum
    ? `${preset.brief}\n\nAdditional operator instructions:\n${args.input.briefAddendum}`
    : preset.brief;
  return {
    agentSlug: args.agentSlug,
    title: args.input.title ?? preset.title,
    kind: preset.kind,
    brief,
    scheduleType,
    intervalMinutes:
      scheduleType === "interval"
        ? (args.input.intervalMinutes ??
          preset.defaultSchedule.intervalMinutes ??
          60)
        : undefined,
    timeOfDay:
      scheduleType === "daily" || scheduleType === "weekly"
        ? (args.input.timeOfDay ?? preset.defaultSchedule.timeOfDay ?? "09:00")
        : undefined,
    dayOfWeek:
      scheduleType === "weekly"
        ? (args.input.dayOfWeek ?? preset.defaultSchedule.dayOfWeek ?? 1)
        : undefined,
    enabled: args.input.enabled,
  };
}
