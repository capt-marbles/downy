import { z } from "zod";
import { CampaignArtifactNameSchema } from "../campaign-room/schemas";

import { BuildroomArtifactNameSchema, BuildroomRoleSchema } from "./schemas";

export const WorkflowGateTypeSchema = z.enum([
  "none",
  "agent_review",
  "operator_confirmation",
]);
export type WorkflowGateType = z.infer<typeof WorkflowGateTypeSchema>;

export const WorkflowGateDecisionSchema = z.enum([
  "approved",
  "rejected",
  "needs_changes",
]);
export type WorkflowGateDecision = z.infer<typeof WorkflowGateDecisionSchema>;

export const WorkflowRunStatusSchema = z.enum([
  "active",
  "waiting_for_gate",
  "blocked",
  "completed",
  "failed",
]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

export const WorkflowStageRunStatusSchema = z.enum([
  "active",
  "waiting_for_gate",
  "completed",
  "blocked",
]);
export type WorkflowStageRunStatus = z.infer<
  typeof WorkflowStageRunStatusSchema
>;

export const WorkflowStageSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().min(1).max(120),
  role: BuildroomRoleSchema,
  instructions: z.string().min(1).max(4000),
  requiredArtifact: BuildroomArtifactNameSchema.nullable().default(null),
  campaignArtifact: CampaignArtifactNameSchema.optional(),
  gate: WorkflowGateTypeSchema.default("none"),
  completionCriteria: z.array(z.string().min(1)).default([]),
});
export type WorkflowStage = z.infer<typeof WorkflowStageSchema>;

export const WorkflowTemplateSchema = z.object({
  id: z.string(),
  agentSlug: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.number().int().min(1),
  stages: z.array(WorkflowStageSchema).min(1),
  isArchived: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;

export const CreateWorkflowTemplateInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  stages: z.array(WorkflowStageSchema).min(1).max(32),
});
export type CreateWorkflowTemplateInput = z.infer<
  typeof CreateWorkflowTemplateInputSchema
>;

export const WorkflowRunSchema = z.object({
  jobId: z.string(),
  templateId: z.string(),
  agentSlug: z.string(),
  currentStageId: z.string(),
  status: WorkflowRunStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().nullable(),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export const WorkflowStageRunSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  agentSlug: z.string(),
  stageId: z.string(),
  status: WorkflowStageRunStatusSchema,
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  outputArtifactName: BuildroomArtifactNameSchema.nullable(),
  notes: z.string().nullable(),
});
export type WorkflowStageRun = z.infer<typeof WorkflowStageRunSchema>;

export const WorkflowGateRecordSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  agentSlug: z.string(),
  stageId: z.string(),
  gateType: WorkflowGateTypeSchema,
  decision: WorkflowGateDecisionSchema,
  decidedBy: z.string(),
  reason: z.string(),
  createdAt: z.number(),
});
export type WorkflowGateRecord = z.infer<typeof WorkflowGateRecordSchema>;

export const StartWorkflowInputSchema = z.object({
  templateId: z.string().min(1),
  title: z.string().min(1).max(160),
  actorRole: BuildroomRoleSchema.default("main"),
});
export type StartWorkflowInput = z.infer<typeof StartWorkflowInputSchema>;

export const AdvanceWorkflowInputSchema = z.object({
  jobId: z.string().min(1),
  completedStageId: z.string().min(1),
  outputArtifactName: BuildroomArtifactNameSchema.nullable().default(null),
  notes: z.string().max(4000).default(""),
});
export type AdvanceWorkflowInput = z.infer<typeof AdvanceWorkflowInputSchema>;

export const RecordGateDecisionInputSchema = z.object({
  jobId: z.string().min(1),
  stageId: z.string().min(1),
  decision: WorkflowGateDecisionSchema,
  decidedBy: z.string().min(1).max(120),
  reason: z.string().max(4000).default(""),
});
export type RecordGateDecisionInput = z.infer<
  typeof RecordGateDecisionInputSchema
>;

export const BuildroomWorkflowDetailSchema = z.object({
  template: WorkflowTemplateSchema,
  run: WorkflowRunSchema,
  stageRuns: z.array(WorkflowStageRunSchema),
  gateDecisions: z.array(WorkflowGateRecordSchema),
  currentStage: WorkflowStageSchema,
});
export type BuildroomWorkflowDetail = z.infer<
  typeof BuildroomWorkflowDetailSchema
>;
