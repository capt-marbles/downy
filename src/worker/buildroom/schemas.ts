import { z } from "zod";

export const BuildroomStageSchema = z.enum([
  "created",
  "research_collected",
  "idea_proposed",
  "intent_reviewed",
  "approved_for_planning",
  "blocked",
  "product_planned",
  "approved_for_coder",
  "build_planned",
  "implemented",
  "coder_verified",
  "qa_verified",
  "verification_delta_recorded",
  "trust_reported",
  "retention_reviewed",
  "closed",
]);
export type BuildroomStage = z.infer<typeof BuildroomStageSchema>;

export const BuildroomStatusSchema = z.enum([
  "active",
  "blocked",
  "needs_operator",
  "failed",
  "closed",
]);
export type BuildroomStatus = z.infer<typeof BuildroomStatusSchema>;

export const BuildroomRoleSchema = z.enum([
  "research",
  "dreamer",
  "main",
  "reviewer",
  "coder",
  "qa",
  "trust",
  "retention",
  "operator",
]);
export type BuildroomRole = z.infer<typeof BuildroomRoleSchema>;

export const BuildroomArtifactNameSchema = z.enum([
  "research-input",
  "idea-contract",
  "intent-review",
  "main-review",
  "product-plan",
  "build-plan",
  "verification",
  "qa-verification",
  "verification-delta",
  "trust-report",
  "retention-review",
  "operator-summary",
]);
export type BuildroomArtifactName = z.infer<typeof BuildroomArtifactNameSchema>;

export const BuildroomJobSchema = z.object({
  id: z.string(),
  agentSlug: z.string(),
  title: z.string(),
  stage: BuildroomStageSchema,
  status: BuildroomStatusSchema,
  riskBand: z.string().nullable(),
  trustState: z.string().nullable(),
  retentionRecommendation: z.string().nullable(),
  ownerRole: BuildroomRoleSchema.nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  closedAt: z.number().nullable(),
  workspacePath: z.string(),
});
export type BuildroomJob = z.infer<typeof BuildroomJobSchema>;

export const BuildroomEventSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  agentSlug: z.string(),
  actorSlug: z.string(),
  actorRole: BuildroomRoleSchema,
  eventType: z.string(),
  fromStage: BuildroomStageSchema.nullable(),
  toStage: BuildroomStageSchema.nullable(),
  artifactName: BuildroomArtifactNameSchema.nullable(),
  message: z.string().nullable(),
  createdAt: z.number(),
});
export type BuildroomEvent = z.infer<typeof BuildroomEventSchema>;

export const CreateBuildroomJobInputSchema = z.object({
  title: z.string().min(1).max(160),
  actorRole: BuildroomRoleSchema.default("main"),
});
export type CreateBuildroomJobInput = z.infer<
  typeof CreateBuildroomJobInputSchema
>;

const ArtifactBaseSchema = z.object({
  schema_version: z.number().int().min(1).default(1),
  job_id: z.string().min(1),
  agent_slug: z.string().min(1),
  created_at: z.string().datetime(),
  created_by: z.string().min(1),
  artifact_type: BuildroomArtifactNameSchema,
});

const SourceSchema = z.object({
  url: z.string().url().optional(),
  title: z.string().optional(),
  source_type: z.string().min(1),
  captured_at: z.string().datetime().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});

const CommandReceiptSchema = z.object({
  command: z.string().min(1),
  exit_code: z.number().int(),
  output_excerpt: z.string().optional(),
});

export const ResearchInputSchema = ArtifactBaseSchema.extend({
  artifact_type: z.literal("research-input"),
  summary: z.string().min(1),
  sources: z.array(SourceSchema).default([]),
  claims: z.array(z.string()).default([]),
  watch_items: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
  research_limits: z.string().default(""),
});

export const IdeaContractSchema = ArtifactBaseSchema.extend({
  artifact_type: z.literal("idea-contract"),
  title: z.string().min(1),
  problem: z.string().min(1),
  beneficiary: z.string().min(1),
  why_now: z.string().min(1),
  supporting_evidence: z.array(z.string()).default([]),
  out_of_scope: z.array(z.string()).default([]),
  proposed_location: z.string().optional(),
  verification_idea: z.string().min(1),
  risk_notes: z.array(z.string()).default([]),
  source_research_artifacts: z.array(z.string()).default([]),
});

export const IntentReviewSchema = ArtifactBaseSchema.extend({
  artifact_type: z.literal("intent-review"),
  decision: z.enum(["ready_for_main_review", "needs_more_research", "reject"]),
  reason: z.string().min(1),
  missing_evidence: z.array(z.string()).default([]),
  safety_notes: z.array(z.string()).default([]),
});

export const MainReviewSchema = ArtifactBaseSchema.extend({
  artifact_type: z.literal("main-review"),
  decision: z.enum([
    "approved_for_planning",
    "approved_for_coder",
    "blocked",
    "needs_revision",
  ]),
  risk_band: z.enum(["low", "medium", "high"]),
  risk_score: z.number().int().min(1).max(10),
  approved_by: z.string().min(1),
  auto_approved: z.boolean().default(false),
  force_approved: z.boolean().default(false),
  block_reason: z.string().nullable().default(null),
  approval_scope: z.string().min(1),
});

export const ProductPlanSchema = ArtifactBaseSchema.extend({
  artifact_type: z.literal("product-plan"),
  objective: z.string().min(1),
  allowed_paths: z.array(z.string().min(1)).min(1),
  planned_files: z.array(z.string()).default([]),
  non_goals: z.array(z.string()).default([]),
  acceptance_checks: z.array(z.string()).default([]),
  verification_commands: z.array(z.string()).default([]),
  risk_assessment: z.string().default(""),
  protected_surface_notes: z.array(z.string()).default([]),
  rollback_notes: z.string().default(""),
});

export const BuildPlanSchema = ArtifactBaseSchema.extend({
  artifact_type: z.literal("build-plan"),
  implementation_steps: z.array(z.string()).min(1),
  files_to_change: z.array(z.string()).default([]),
  commands_to_run: z.array(z.string()).default([]),
  expected_outputs: z.array(z.string()).default([]),
  scope_check: z.string().min(1),
});

export const VerificationSchema = ArtifactBaseSchema.extend({
  artifact_type: z.literal("verification"),
  changed_files: z.array(z.string()).default([]),
  commands_run: z.array(CommandReceiptSchema).default([]),
  tests_passed: z.boolean(),
  known_gaps: z.array(z.string()).default([]),
  diff_summary: z.string().default(""),
  commit_sha: z.string().optional(),
});

export const QaVerificationSchema = ArtifactBaseSchema.extend({
  artifact_type: z.literal("qa-verification"),
  reviewed_files: z.array(z.string()).default([]),
  commands_run: z.array(CommandReceiptSchema).default([]),
  claims_checked: z.array(z.string()).default([]),
  tests_passed: z.boolean(),
  findings: z.array(z.string()).default([]),
  qa_decision: z.enum(["pass", "fail", "needs_changes"]),
});

export const VerificationDeltaSchema = ArtifactBaseSchema.extend({
  artifact_type: z.literal("verification-delta"),
  state: z.enum(["confirmed", "drift", "regression", "missing_evidence"]),
  matching_claims: z.array(z.string()).default([]),
  mismatched_claims: z.array(z.string()).default([]),
  missing_evidence: z.array(z.string()).default([]),
  recommended_action: z.string().min(1),
});

export const TrustReportSchema = ArtifactBaseSchema.extend({
  artifact_type: z.literal("trust-report"),
  trust_state: z.enum(["clean", "watch", "investigate"]),
  reasons: z.array(z.string()).default([]),
  jobs_reviewed: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  operator_attention: z.array(z.string()).default([]),
});

export const RetentionReviewSchema = ArtifactBaseSchema.extend({
  artifact_type: z.literal("retention-review"),
  recommendation: z.enum(["keep", "improve", "park", "prune"]),
  reason: z.string().min(1),
  artifacts: z.array(z.string()).default([]),
  follow_up_actions: z.array(z.string()).default([]),
  delete_allowed: z.literal(false).default(false),
});

export const OperatorSummarySchema = ArtifactBaseSchema.extend({
  artifact_type: z.literal("operator-summary"),
  headline: z.string().min(1),
  active_jobs: z.array(z.string()).default([]),
  blocked_jobs: z.array(z.string()).default([]),
  recently_completed: z.array(z.string()).default([]),
  trust_state: z.enum(["clean", "watch", "investigate"]),
  needs_attention: z.array(z.string()).default([]),
  next_actions: z.array(z.string()).default([]),
});

export const BuildroomArtifactSchema = z.discriminatedUnion("artifact_type", [
  ResearchInputSchema,
  IdeaContractSchema,
  IntentReviewSchema,
  MainReviewSchema,
  ProductPlanSchema,
  BuildPlanSchema,
  VerificationSchema,
  QaVerificationSchema,
  VerificationDeltaSchema,
  TrustReportSchema,
  RetentionReviewSchema,
  OperatorSummarySchema,
]);
export type BuildroomArtifact = z.infer<typeof BuildroomArtifactSchema>;

export const WriteBuildroomArtifactInputSchema = z.object({
  jobId: z.string().min(1),
  actorRole: BuildroomRoleSchema,
  artifact: BuildroomArtifactSchema,
});
export type WriteBuildroomArtifactInput = z.infer<
  typeof WriteBuildroomArtifactInputSchema
>;
