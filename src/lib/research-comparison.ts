import { z } from "zod";
const CitationSchema = z
  .object({
    sourceId: z.enum(["s1", "s2", "s3"]),
    quote: z.string().min(20).max(1500),
  })
  .strict();
export const ComparisonDraftSchema = z
  .object({
    findings: z
      .array(
        z
          .object({
            claim: z.string().min(10).max(1200),
            citations: z.array(CitationSchema).min(1).max(3),
          })
          .strict(),
      )
      .min(3)
      .max(6),
  })
  .strict()
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).length <= 32000,
    "Draft exceeds comparison size budget",
  );
export type ComparisonDraft = z.infer<typeof ComparisonDraftSchema>;
export const ComparisonSourceSchema = z.object({
  id: z.enum(["s1", "s2", "s3"]),
  url: z.string().url(),
  capturedUrl: z.string().url(),
  observedAt: z.string(),
  text: z.string().max(12000),
  truncated: z.boolean(),
  actionId: z.string(),
});
export type ComparisonSource = z.infer<typeof ComparisonSourceSchema>;
const FindingCheckSchema = z.object({
  index: z.number().int(),
  status: z.enum([
    "supported",
    "unsupported",
    "contradicted",
    "review",
    "unavailable",
  ]),
  reason: z.string(),
  quoteMatches: z.boolean(),
  supportProbability: z.number().nullable(),
  supportConfidence: z.number().nullable(),
  contradictionProbability: z.number().nullable(),
  relevanceScore: z.number().nullable(),
  relevanceConfidence: z.number().nullable(),
});
export const ComparisonFeedbackSchema = z.object({
  id: z.uuid(),
  findingIndex: z.number().int().min(0).max(5),
  verdict: z.enum(["supported", "unsupported", "unclear"]),
  note: z.string().max(1000),
  createdAt: z.number(),
});
export const ComparisonRunSchema = z.object({
  id: z.uuid(),
  ticketId: z.uuid(),
  sourceRevision: z.uuid(),
  createdAt: z.number(),
  updatedAt: z.number(),
  urls: z.array(z.string().url()).length(3),
  actionIds: z.array(z.string()).length(3),
  phase: z.enum(["capturing", "drafting", "checking", "complete", "failed"]),
  error: z.string().nullable(),
  sources: z.array(ComparisonSourceSchema),
  draft: ComparisonDraftSchema.nullable(),
  checks: z.array(FindingCheckSchema),
  model: z.string().nullable(),
  generator: z.string().nullable(),
  reportPath: z.string().nullable(),
  auditPath: z.string().nullable(),
  sample: z.array(z.number().int()),
  feedback: z.array(ComparisonFeedbackSchema).max(20),
});
export type ComparisonRun = z.infer<typeof ComparisonRunSchema>;

export const COMPARISON_POLICY = {
  version: "evidence-v1",
  supportProbability: 0.8,
  supportConfidence: 0.7,
  contradictionLow: 0.2,
  contradictionHigh: 0.8,
} as const;
export function withComparisonFeedback(
  run: ComparisonRun,
  value: unknown,
  now: number,
): ComparisonRun {
  const feedback = ComparisonFeedbackSchema.parse(value);
  if (
    run.phase !== "complete" ||
    feedback.findingIndex >= (run.draft?.findings.length ?? 0)
  )
    throw new Error("No completed finding to review");
  if (run.feedback.some((item) => item.id === feedback.id)) return run;
  if (run.feedback.length >= 20) throw new Error("Feedback limit reached");
  return {
    ...run,
    feedback: [...run.feedback, { ...feedback, createdAt: now }],
  };
}

export function comparisonActionIds(
  previous: ComparisonRun | null,
  sourceRevision: string,
  id: string,
  now: number,
): string[] {
  if (
    previous?.phase === "failed" &&
    previous.sourceRevision === sourceRevision &&
    previous.sources.length === 3
  )
    return [...previous.actionIds];
  return [0, 1, 2].map((i) => `hands-${now}-${id.slice(0, 8)}${i}`);
}
