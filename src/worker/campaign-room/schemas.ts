import { z } from "zod";

export const CampaignArtifactNameSchema = z.enum([
  "campaign-brief",
  "campaign-source-notes",
  "campaign-content-draft",
  "campaign-editorial-review",
  "campaign-publish-package",
  "campaign-icp",
  "campaign-lead-list",
  "campaign-enrichment-notes",
  "campaign-qualification-report",
  "campaign-lead-context",
  "campaign-personalization-notes",
  "campaign-email-sequence",
  "campaign-risk-review",
  "campaign-send-package",
  "campaign-digest",
]);
export type CampaignArtifactName = z.infer<typeof CampaignArtifactNameSchema>;

const CampaignBaseSchema = z.object({
  schema_version: z.number().int().min(1).default(1),
  job_id: z.string().min(1),
  agent_slug: z.string().min(1),
  created_at: z.string().datetime(),
  created_by: z.string().min(1),
  artifact_type: CampaignArtifactNameSchema,
});

const SourceSchema = z.object({
  url: z.string().url().optional(),
  title: z.string().optional(),
  source_type: z.string().min(1),
  captured_at: z.string().datetime().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  notes: z.string().optional(),
});

const AccountSchema = z.object({
  name: z.string().min(1),
  website: z.string().url().optional(),
  category: z.string().optional(),
  why_fit: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
});

const LeadSchema = z.object({
  account: z.string().min(1),
  person_name: z.string().optional(),
  role: z.string().optional(),
  profile_url: z.string().url().optional(),
  email: z.string().email().optional(),
  source_url: z.string().url().optional(),
  fit_notes: z.string().min(1),
  personalization_hooks: z.array(z.string()).default([]),
  do_not_contact_reason: z.string().optional(),
});

export const CampaignBriefSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-brief"),
  campaign_name: z.string().min(1),
  objective: z.string().min(1),
  audience: z.string().min(1),
  thesis: z.string().min(1),
  proof_points: z.array(z.string()).default([]),
  offer_or_cta: z.string().default(""),
  non_goals: z.array(z.string()).default([]),
  success_criteria: z.array(z.string()).default([]),
});

export const CampaignSourceNotesSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-source-notes"),
  summary: z.string().min(1),
  sources: z.array(SourceSchema).default([]),
  claims: z.array(z.string()).default([]),
  opportunities: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
  research_limits: z.string().default(""),
});

export const CampaignContentDraftSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-content-draft"),
  format: z.enum(["linkedin", "blog", "newsletter", "x-thread", "other"]),
  title: z.string().optional(),
  hook: z.string().min(1),
  body: z.string().min(1),
  cta: z.string().default(""),
  variants: z.array(z.string()).default([]),
  source_artifacts: z.array(z.string()).default([]),
});

export const CampaignEditorialReviewSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-editorial-review"),
  decision: z.enum(["publish_ready", "needs_revision", "reject"]),
  summary: z.string().min(1),
  suggested_edits: z.array(z.string()).default([]),
  factual_risks: z.array(z.string()).default([]),
  tone_notes: z.array(z.string()).default([]),
});

export const CampaignPublishPackageSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-publish-package"),
  final_copy: z.string().min(1),
  channel: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  source_links: z.array(z.string()).default([]),
  publish_recommendation: z.enum(["publish", "defer", "do_not_publish"]),
  human_approval_required: z.literal(true).default(true),
});

export const CampaignIcpSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-icp"),
  segment_name: z.string().min(1),
  fit_criteria: z.array(z.string()).min(1),
  exclusions: z.array(z.string()).default([]),
  buying_triggers: z.array(z.string()).default([]),
  required_evidence: z.array(z.string()).default([]),
});

export const CampaignLeadListSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-lead-list"),
  list_name: z.string().min(1),
  accounts: z.array(AccountSchema).default([]),
  leads: z.array(LeadSchema).default([]),
  sourcing_notes: z.string().default(""),
});

export const CampaignEnrichmentNotesSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-enrichment-notes"),
  target: z.string().min(1),
  public_context: z.array(z.string()).default([]),
  likely_pain_points: z.array(z.string()).default([]),
  personalization_hooks: z.array(z.string()).default([]),
  missing_data: z.array(z.string()).default([]),
  sources: z.array(SourceSchema).default([]),
});

export const CampaignQualificationReportSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-qualification-report"),
  summary: z.string().min(1),
  qualified: z.array(z.string()).default([]),
  disqualified: z.array(z.string()).default([]),
  uncertain: z.array(z.string()).default([]),
  scoring_notes: z.array(z.string()).default([]),
  recommended_next_actions: z.array(z.string()).default([]),
});

export const CampaignLeadContextSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-lead-context"),
  account: z.string().min(1),
  person_or_role: z.string().default(""),
  relevance_hypothesis: z.string().min(1),
  context_notes: z.array(z.string()).default([]),
  sources: z.array(SourceSchema).default([]),
});

export const CampaignPersonalizationNotesSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-personalization-notes"),
  target: z.string().min(1),
  safe_hooks: z.array(z.string()).default([]),
  excluded_hooks: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

export const CampaignEmailSequenceSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-email-sequence"),
  sequence_name: z.string().min(1),
  subject_lines: z.array(z.string()).default([]),
  first_touch: z.string().min(1),
  follow_ups: z.array(z.string()).default([]),
  personalization_slots: z.array(z.string()).default([]),
  opt_out_copy: z.string().default(""),
});

export const CampaignRiskReviewSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-risk-review"),
  decision: z.enum(["ready_for_operator", "needs_revision", "do_not_send"]),
  spam_risks: z.array(z.string()).default([]),
  claim_risks: z.array(z.string()).default([]),
  tone_risks: z.array(z.string()).default([]),
  compliance_notes: z.array(z.string()).default([]),
  recommended_changes: z.array(z.string()).default([]),
});

export const CampaignSendPackageSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-send-package"),
  target: z.string().min(1),
  final_sequence: z.array(z.string()).min(1),
  send_recommendation: z.enum(["send", "defer", "do_not_send"]),
  operator_notes: z.string().default(""),
  human_approval_required: z.literal(true).default(true),
});

export const CampaignDigestSchema = CampaignBaseSchema.extend({
  artifact_type: z.literal("campaign-digest"),
  period: z.string().min(1),
  summary: z.string().min(1),
  insights: z.array(z.string()).default([]),
  opportunities: z.array(z.string()).default([]),
  recommended_actions: z.array(z.string()).default([]),
  sources: z.array(SourceSchema).default([]),
});

export const CampaignArtifactSchema = z.discriminatedUnion("artifact_type", [
  CampaignBriefSchema,
  CampaignSourceNotesSchema,
  CampaignContentDraftSchema,
  CampaignEditorialReviewSchema,
  CampaignPublishPackageSchema,
  CampaignIcpSchema,
  CampaignLeadListSchema,
  CampaignEnrichmentNotesSchema,
  CampaignQualificationReportSchema,
  CampaignLeadContextSchema,
  CampaignPersonalizationNotesSchema,
  CampaignEmailSequenceSchema,
  CampaignRiskReviewSchema,
  CampaignSendPackageSchema,
  CampaignDigestSchema,
]);
export type CampaignArtifact = z.infer<typeof CampaignArtifactSchema>;
