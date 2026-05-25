import { z } from "zod";

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

export const DEFAULT_BUILDROOM_WORKFLOW_STAGES: WorkflowStage[] = [
  {
    id: "research",
    name: "Research brief",
    role: "research",
    instructions:
      "Collect source-grounded context, claims, open questions, and research limits before ideation.",
    requiredArtifact: "research-input",
    gate: "none",
    completionCriteria: [
      "Research input artifact exists",
      "Sources or limits are explicit",
    ],
  },
  {
    id: "idea",
    name: "Idea contract",
    role: "dreamer",
    instructions:
      "Turn research into a concrete idea contract with problem, beneficiary, evidence, scope, and verification idea.",
    requiredArtifact: "idea-contract",
    gate: "none",
    completionCriteria: [
      "Idea contract captures problem and verification idea",
    ],
  },
  {
    id: "intent-review",
    name: "Intent review",
    role: "reviewer",
    instructions:
      "Review the idea for missing evidence, safety concerns, and readiness for main approval.",
    requiredArtifact: "intent-review",
    gate: "agent_review",
    completionCriteria: [
      "Intent review decision is ready_for_main_review or explicit rejection",
    ],
  },
  {
    id: "main-approval",
    name: "Main approval gate",
    role: "main",
    instructions:
      "Decide whether this work should proceed, block, or bypass planning for coder-ready work.",
    requiredArtifact: "main-review",
    gate: "operator_confirmation",
    completionCriteria: ["Main review includes risk band and approval scope"],
  },
  {
    id: "product-plan",
    name: "Product plan",
    role: "main",
    instructions:
      "Define objective, allowed paths, non-goals, acceptance checks, verification commands, and rollback notes.",
    requiredArtifact: "product-plan",
    gate: "none",
    completionCriteria: ["Acceptance checks and allowed paths are explicit"],
  },
  {
    id: "build-plan",
    name: "Build plan",
    role: "coder",
    instructions:
      "Convert the product plan into implementation steps, expected outputs, and scope checks.",
    requiredArtifact: "build-plan",
    gate: "agent_review",
    completionCriteria: [
      "Build plan includes implementation steps and scope check",
    ],
  },
  {
    id: "implementation-verification",
    name: "Implementation verification",
    role: "coder",
    instructions:
      "Implement, run commands, summarize diff, and record known gaps or commit SHA.",
    requiredArtifact: "verification",
    gate: "none",
    completionCriteria: [
      "Verification artifact records commands and test result",
    ],
  },
  {
    id: "qa",
    name: "QA verification",
    role: "qa",
    instructions:
      "Independently verify changed work, commands, claims checked, findings, and pass/fail decision.",
    requiredArtifact: "qa-verification",
    gate: "agent_review",
    completionCriteria: ["QA decision is recorded"],
  },
  {
    id: "trust-retention",
    name: "Trust and retention review",
    role: "trust",
    instructions:
      "Record verification deltas, trust report, and retention recommendation before closeout.",
    requiredArtifact: "trust-report",
    gate: "none",
    completionCriteria: ["Trust impact and recommended action are explicit"],
  },
  {
    id: "closeout",
    name: "Operator closeout",
    role: "operator",
    instructions:
      "Summarize outcome, link artifacts, capture memory updates, and close the workflow.",
    requiredArtifact: "operator-summary",
    gate: "operator_confirmation",
    completionCriteria: ["Operator summary captures outcome and follow-up"],
  },
];
