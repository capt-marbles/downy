import { z } from "zod";

import { BackgroundTaskRecordSchema } from "../worker/agent/background-task-types";

/**
 * Zod schemas for the `/api/files` transport layer.
 *
 * Both the client (`api-client.ts`) and the worker handler (`handlers/files.ts`)
 * validate against these schemas, so the wire contract is honest on both sides
 * and we no longer need `as T` casts to smuggle in trust.
 */

/**
 * Mirrors `FileInfo` from `@cloudflare/shell`. We redeclare the shape so we can
 * validate incoming JSON — the library's type is a pure compile-time declaration.
 * Not exported: only composed into list/read schemas below.
 */
const FileInfoSchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.enum(["file", "directory", "symlink"]),
  mimeType: z.string(),
  size: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  target: z.string().optional(),
});

export const CoreFileRecordSchema = z.object({
  path: z.string(),
  label: z.string(),
  description: z.string(),
  content: z.string(),
  /** `null` means the record is still serving the code default. */
  updatedAt: z.number().nullable(),
  /** `true` when `content` came from the bundled default rather than R2. */
  isDefault: z.boolean(),
});
export type CoreFileRecord = z.infer<typeof CoreFileRecordSchema>;

export const WorkspaceFileSchema = z.object({
  content: z.string(),
  stat: FileInfoSchema.nullable(),
});
export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;

// ── Response envelopes ──────────────────────────────────────────────────────

export const ListCoreFilesResponseSchema = z.object({
  files: z.array(CoreFileRecordSchema),
});

export const ReadCoreFileResponseSchema = z.object({
  file: CoreFileRecordSchema,
});

export const ListWorkspaceFilesResponseSchema = z.object({
  files: z.array(FileInfoSchema),
});

export const ReadWorkspaceFileResponseSchema = z.object({
  file: WorkspaceFileSchema,
});

export const OkResponseSchema = z.object({ ok: z.literal(true) });

export const BootstrapStartResponseSchema = z.object({
  started: z.boolean(),
});

export type { BackgroundTaskRecord } from "../worker/agent/background-task-types";

export const ListBackgroundTasksResponseSchema = z.object({
  backgroundTasks: z.array(BackgroundTaskRecordSchema),
});

export const McpServerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  state: z.string(),
  error: z.string().nullable(),
  toolNames: z.array(z.string()),
});
export type McpServerSummary = z.infer<typeof McpServerSummarySchema>;

export const ListMcpServersResponseSchema = z.object({
  servers: z.array(McpServerSummarySchema),
});

// ── Skills ──────────────────────────────────────────────────────────────────

export const SkillSummarySchema = z.object({
  name: z.string(),
  description: z.string(),
  hidden: z.boolean(),
  path: z.string(),
  bytes: z.number(),
  updatedAt: z.number(),
});
export type SkillSummary = z.infer<typeof SkillSummarySchema>;

export const ListSkillsResponseSchema = z.object({
  skills: z.array(SkillSummarySchema),
});

// ── Agent registry ──────────────────────────────────────────────────────────

export const AgentRecordSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  isPrivate: z.boolean(),
  archivedAt: z.number().nullable(),
  createdAt: z.number(),
});
export type AgentRecord = z.infer<typeof AgentRecordSchema>;

export const ListAgentsResponseSchema = z.object({
  agents: z.array(AgentRecordSchema),
});

export const CreateAgentRequestBodySchema = z.object({
  slug: z.string(),
  displayName: z.string(),
});

export const CreateAgentResponseSchema = z.object({
  agent: AgentRecordSchema,
});

export const UpdateAgentRequestBodySchema = z.object({
  displayName: z.string().optional(),
  isPrivate: z.boolean().optional(),
});

export const UpdateAgentResponseSchema = z.object({
  agent: AgentRecordSchema,
});

// ── Profile (USER.md) ───────────────────────────────────────────────────────

// Response shape mirrors `ReadCoreFileResponseSchema` so the Identity UI can
// render USER.md alongside SOUL/IDENTITY/MEMORY without special-casing.
export const ReadUserFileResponseSchema = z.object({
  file: CoreFileRecordSchema,
});

// ── Request bodies ──────────────────────────────────────────────────────────

export const WriteRequestBodySchema = z.object({ content: z.string() });

// ── Message mutation ────────────────────────────────────────────────────────

export const RevertLastTurnResponseSchema = z.object({
  deletedCount: z.number(),
});

export const EditLastMessageResponseSchema = z.object({
  replaced: z.boolean(),
});

// ── System status ───────────────────────────────────────────────────────────

export const SystemStatusResponseSchema = z.object({
  exaConfigured: z.boolean(),
});
export type SystemStatus = z.infer<typeof SystemStatusResponseSchema>;

export const ModelStatusSchema = z.object({
  provider: z.enum(["kimi", "pi-local", "pi-prod", "openrouter"]),
  providerLabel: z.string(),
  model: z.string(),
  contextWindowTokens: z.number().nullable(),
  compactionThresholdTokens: z.number(),
  lastTurn: z
    .object({
      requestId: z.string(),
      status: z.enum(["completed", "error", "aborted"]),
      completedAt: z.number(),
      durationMs: z.number().nullable(),
      chunks: z.number(),
      assistantTextLength: z.number(),
      assistantReasoningLength: z.number(),
      finishReason: z.string().nullable(),
      toolCalls: z.number(),
      toolResults: z.number(),
      warning: z.string().nullable(),
      error: z.string().nullable(),
    })
    .nullable(),
  session: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    totalTokens: z.number(),
    turnCount: z.number(),
    estimatedCostUsd: z.number().nullable(),
    costNote: z.string(),
  }),
});
export type ModelStatus = z.infer<typeof ModelStatusSchema>;

export const ModelStatusResponseSchema = z.object({
  modelStatus: ModelStatusSchema,
});

export const ScheduledTaskSchema = z.object({
  id: z.string(),
  agentSlug: z.string(),
  title: z.string(),
  kind: z.string(),
  brief: z.string(),
  scheduleType: z.enum(["interval", "daily", "weekly"]),
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

export const ListScheduledTasksResponseSchema = z.object({
  scheduledTasks: z.array(ScheduledTaskSchema),
});

// ── Campaign Room ───────────────────────────────────────────────────────────

export const CampaignRoomTemplateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  stages: z.array(z.unknown()),
});
export type CampaignRoomTemplateSummary = z.infer<
  typeof CampaignRoomTemplateSummarySchema
>;

export const CampaignSchedulePresetSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  defaultSchedule: z.record(z.string(), z.unknown()),
  brief: z.string(),
});
export type CampaignSchedulePresetSummary = z.infer<
  typeof CampaignSchedulePresetSummarySchema
>;

export const CampaignRoomJobSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  stage: z.string(),
  status: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type CampaignRoomJobSummary = z.infer<
  typeof CampaignRoomJobSummarySchema
>;

export const CampaignRoomOverviewResponseSchema = z.object({
  templates: z.array(CampaignRoomTemplateSummarySchema),
  schedulePresets: z.array(CampaignSchedulePresetSummarySchema),
  recentJobs: z.array(CampaignRoomJobSummarySchema),
});
export type CampaignRoomOverview = z.infer<
  typeof CampaignRoomOverviewResponseSchema
>;

export const CampaignRoomSmokeResponseSchema = z.object({
  job: z.object({ id: z.string(), title: z.string() }).passthrough(),
  workflow: z.unknown(),
  brief: z.unknown(),
  researchAction: z
    .object({ id: z.string(), status: z.string() })
    .passthrough(),
  sourceNotes: z.unknown(),
});
export type CampaignRoomSmokeResponse = z.infer<
  typeof CampaignRoomSmokeResponseSchema
>;
