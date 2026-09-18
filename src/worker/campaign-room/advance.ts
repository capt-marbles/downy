import {
  advanceBuildroomWorkflow,
  getWorkflowDetailOrThrow,
} from "../buildroom/workflow-db";
import type { AdvanceWorkflowInput } from "../buildroom/workflows";
import { campaignArtifactPath } from "./artifacts";
import { criteriaConfig, evaluateCriteria } from "./criteria";
import { runJev, type JevRunner } from "../jev/client";

export async function advanceCampaignWorkflow(args: {
  env: Cloudflare.Env;
  agentSlug: string;
  input: AdvanceWorkflowInput;
  readFile: (path: string) => Promise<string | null>;
  run?: JevRunner;
}) {
  const { env, input } = args;
  const detail = await getWorkflowDetailOrThrow(env.DB, input.jobId);
  if (
    detail.run.agentSlug !== args.agentSlug ||
    detail.currentStage.id !== input.completedStageId
  )
    throw new Error("Workflow stage does not match this agent and run");
  const config = criteriaConfig(env);
  if (config.disabledTemplates.includes(detail.template.id))
    config.enabled = false;
  const stage = detail.currentStage;
  let artifact: string | null = null;
  let readFailed = false;
  if (
    config.enabled &&
    stage.campaignArtifact &&
    stage.completionCriteria.length
  ) {
    try {
      artifact = await args.readFile(
        campaignArtifactPath(input.jobId, stage.campaignArtifact),
      );
    } catch {
      readFailed = true;
    }
  }
  const priorEvaluation = await env.DB.prepare(
    "SELECT MAX(evaluated_at) AS at FROM workflow_criteria_evaluations WHERE stage_run_id IN (SELECT id FROM buildroom_workflow_stage_runs WHERE job_id = ? AND stage_id = ? AND completed_at IS NULL)",
  )
    .bind(input.jobId, stage.id)
    .first<{ at: number | null }>();
  const approval = detail.gateDecisions
    .filter((decision) => decision.stageId === stage.id)
    .at(-1);
  const reviewedEvidence =
    approval?.decision === "approved" &&
    priorEvaluation?.at != null &&
    approval.createdAt >= priorEvaluation.at;
  const criteria = await evaluateCriteria({
    stage,
    artifact,
    config,
    run: readFailed
      ? async () => {
          throw new Error("Artifact read failed");
        }
      : (args.run ?? ((request) => runJev(env.AI, request))),
  });
  const stageRun = detail.stageRuns.find(
    (run) => run.stageId === stage.id && run.completedAt == null,
  );
  if (!stageRun) throw new Error("Missing current stage run");
  for (const evaluation of criteria.evaluations) {
    await env.DB.prepare(
      `INSERT INTO workflow_criteria_evaluations (id, stage_run_id, criterion_text, question_type, probability, confidence, passed, jev_model_version, truncated, evaluated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        stageRun.id,
        evaluation.criterion,
        evaluation.questionType,
        evaluation.probability,
        evaluation.confidence,
        evaluation.passed ? 1 : 0,
        criteria.model,
        criteria.truncated ? 1 : 0,
        Date.now(),
      )
      .run();
  }
  const notes = [input.notes, criteria.warning].filter(Boolean).join("\n");
  if (criteria.warning)
    await env.DB.prepare(
      "UPDATE buildroom_workflow_stage_runs SET notes = ? WHERE id = ?",
    )
      .bind(notes, stageRun.id)
      .run();
  if (criteria.state === "blocked")
    return { advanced: false, workflow: detail, criteria };
  // Machine evidence never records a gate decision. A passing result cannot
  // substitute for an existing agent review or operator confirmation.
  const gatePending = stage.gate !== "none" && detail.run.status !== "active";
  if (
    gatePending ||
    (criteria.state === "uncertain" &&
      stage.gate !== "none" &&
      !reviewedEvidence)
  ) {
    await env.DB.prepare(
      "UPDATE buildroom_workflow_runs SET status = 'waiting_for_gate' WHERE job_id = ?",
    )
      .bind(input.jobId)
      .run();
    await env.DB.prepare(
      "UPDATE buildroom_workflow_stage_runs SET status = 'waiting_for_gate' WHERE id = ?",
    )
      .bind(stageRun.id)
      .run();
    return {
      advanced: false,
      workflow: await getWorkflowDetailOrThrow(env.DB, input.jobId),
      criteria,
      gateRequired: stage.gate,
    };
  }
  return {
    advanced: true,
    workflow: await advanceBuildroomWorkflow(env.DB, { ...input, notes }),
    criteria,
  };
}
