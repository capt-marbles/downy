import { z } from "zod";
import {
  JevResponseSchema,
  withDeadline,
  type JevQuestion,
  type JevRunner,
} from "../jev/client";
import type { WorkflowStage } from "../buildroom/workflows";
const ConfigSchema = z.object({
  enabled: z.boolean(),
  passThreshold: z.number().min(0).max(1),
  confidenceFloor: z.number().min(0.5).max(1),
  disabledTemplates: z.array(z.string()),
});
export function criteriaConfig(
  env: Pick<
    Cloudflare.Env,
    | "JEV_GATING_ENABLED"
    | "CRITERIA_PASS_THRESHOLD"
    | "CRITERIA_CONFIDENCE_FLOOR"
    | "JEV_DISABLED_TEMPLATES"
  >,
) {
  return ConfigSchema.parse({
    enabled: env.JEV_GATING_ENABLED !== "false",
    passThreshold: Number(env.CRITERIA_PASS_THRESHOLD),
    confidenceFloor: Number(env.CRITERIA_CONFIDENCE_FLOOR),
    disabledTemplates: JSON.parse(env.JEV_DISABLED_TEMPLATES) as unknown,
  });
}
type Evaluation = {
  criterion: string;
  questionType: "noul" | "score";
  probability: number;
  confidence: number;
  passed: boolean;
};
type CriteriaResult = {
  state: "skipped" | "passed" | "blocked" | "uncertain" | "unavailable";
  evaluations: Evaluation[];
  failingCriteria: Evaluation[];
  model: string | null;
  truncated: boolean;
  warning?: string;
};
export async function evaluateCriteria(args: {
  stage: WorkflowStage;
  artifact: string | null;
  config: z.infer<typeof ConfigSchema>;
  run: JevRunner;
}): Promise<CriteriaResult> {
  const empty = {
    evaluations: [],
    failingCriteria: [],
    model: null,
    truncated: false,
  };
  if (
    !args.config.enabled ||
    !args.stage.campaignArtifact ||
    !args.stage.completionCriteria.length
  )
    return { ...empty, state: "skipped" };
  const full = JSON.stringify({
    instructions: args.stage.instructions,
    artifact: args.artifact ?? "Artifact is missing",
  });
  const state = full.slice(0, 48_000);
  const truncated = full.length > state.length;
  const questions: Record<string, JevQuestion> = Object.fromEntries(
    args.stage.completionCriteria.map((criterion, index) => [
      `criterion_${index}`,
      {
        type: "noul" as const,
        instructions: criterion,
        criteria: {
          true: "The artifact satisfies this criterion",
          false: "The artifact is missing or does not satisfy this criterion",
        },
      },
    ]),
  );
  questions.quality = {
    type: "score",
    instructions: "Overall draft quality against the stage instructions",
    criteria: [
      "Incomplete or unsupported",
      "Needs revision",
      "Clear and well supported",
    ],
  };
  try {
    const result = JevResponseSchema.parse(
      await withDeadline(args.run({ state, questions }), 8_000),
    );
    const evaluations = args.stage.completionCriteria.map(
      (criterion, index): Evaluation => {
        const answer = result.answers[`criterion_${index}`];
        if (answer?.type !== "noul")
          throw new Error("Missing criterion response");
        const p = answer.noul;
        // Noul has no model confidence field. Policy certainty is the probability
        // of its most likely Boolean answer, explicitly derived rather than invented.
        return {
          criterion,
          questionType: "noul",
          probability: p,
          confidence: Math.max(p, 1 - p),
          passed: p >= args.config.passThreshold,
        };
      },
    );
    const quality = result.answers.quality;
    if (quality?.type !== "score") throw new Error("Missing quality response");
    const failingCriteria = evaluations.filter(
      (e) => !e.passed && e.confidence >= args.config.confidenceFloor,
    );
    const uncertain = evaluations.some(
      (e) => e.confidence < args.config.confidenceFloor,
    );
    evaluations.push({
      criterion: "Overall draft quality",
      questionType: "score",
      probability: quality.score / 2,
      confidence: quality.confidence,
      passed: quality.score >= 1,
    });
    return {
      state: failingCriteria.length
        ? "blocked"
        : uncertain
          ? "uncertain"
          : "passed",
      evaluations,
      failingCriteria,
      model: result.model,
      truncated,
      ...(uncertain
        ? {
            warning:
              "Low criterion certainty: review at the existing gate; ungated stages may continue",
          }
        : {}),
    };
  } catch {
    // Fail OPEN: these are draft checks, not send/publish/CRM authorization.
    // Separate operator gates remain mandatory; an evaluator outage must not
    // freeze all GTM work. Never change this to automatic gate approval.
    return {
      ...empty,
      state: "unavailable",
      truncated,
      warning:
        "Jev evaluation failed or timed out; draft check skipped. Existing gates still apply.",
    };
  }
}
