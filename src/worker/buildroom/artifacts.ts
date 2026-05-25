import type { Workspace } from "@cloudflare/shell";

import { nextStageForArtifact } from "./lifecycle";
import { buildroomArtifactPath } from "./paths";
import { getBuildroomJob, updateBuildroomJobStage } from "./db";
import {
  BuildroomArtifactSchema,
  type BuildroomArtifact,
  type BuildroomArtifactName,
  type BuildroomJob,
  type BuildroomRole,
} from "./schemas";

export type BuildroomWriteResult = {
  job: BuildroomJob;
  artifactPath: string;
  nextActions: string[];
  warnings: string[];
};

export async function writeBuildroomArtifact(args: {
  db: D1Database;
  workspace: Workspace;
  agentSlug: string;
  actorRole: BuildroomRole;
  jobId: string;
  artifact: unknown;
}): Promise<BuildroomWriteResult> {
  const artifact = BuildroomArtifactSchema.parse(args.artifact);
  if (artifact.job_id !== args.jobId) {
    throw new Error("Artifact job_id must match target job id");
  }
  if (artifact.agent_slug !== args.agentSlug) {
    throw new Error("Artifact agent_slug must match active agent slug");
  }
  const job = await getBuildroomJob(args.db, args.jobId);
  if (!job) throw new Error(`Unknown buildroom job: ${args.jobId}`);
  if (job.agentSlug !== args.agentSlug) {
    throw new Error("Buildroom job belongs to a different agent");
  }
  const artifactName = artifact.artifact_type;
  const nextStage = nextStageForArtifact({
    artifactName,
    currentStage: job.stage,
    actorRole: args.actorRole,
    artifact,
  });
  const artifactPath = buildroomArtifactPath(job.id, artifactName);
  await args.workspace.writeFile(
    artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  await appendWorkspaceEvent(args.workspace, job.id, {
    at: new Date().toISOString(),
    actor: args.agentSlug,
    role: args.actorRole,
    artifact: artifactName,
    from: job.stage,
    to: nextStage,
  });
  const updated = await updateBuildroomJobStage(args.db, {
    job,
    stage: nextStage,
    artifactName,
    actorSlug: args.agentSlug,
    actorRole: args.actorRole,
    message: artifactSummary(artifact),
  });
  return {
    job: updated,
    artifactPath,
    nextActions: nextActionsForStage(updated.stage),
    warnings: [],
  };
}

export async function readBuildroomArtifact(args: {
  workspace: Workspace;
  jobId: string;
  artifactName: BuildroomArtifactName;
}): Promise<BuildroomArtifact | null> {
  const raw = await args.workspace.readFile(
    buildroomArtifactPath(args.jobId, args.artifactName),
  );
  if (raw == null) return null;
  return BuildroomArtifactSchema.parse(JSON.parse(raw));
}

async function appendWorkspaceEvent(
  workspace: Workspace,
  jobId: string,
  event: Record<string, unknown>,
): Promise<void> {
  const path = buildroomArtifactPath(jobId, "events");
  const prior = (await workspace.readFile(path)) ?? "";
  await workspace.writeFile(path, `${prior}${JSON.stringify(event)}\n`);
}

function artifactSummary(artifact: BuildroomArtifact): string {
  switch (artifact.artifact_type) {
    case "research-input":
      return artifact.summary;
    case "idea-contract":
      return artifact.title;
    case "intent-review":
      return artifact.decision;
    case "main-review":
      return artifact.decision;
    case "product-plan":
      return artifact.objective;
    case "build-plan":
      return artifact.scope_check;
    case "verification":
      return artifact.tests_passed
        ? "tests passed"
        : "tests failed or incomplete";
    case "qa-verification":
      return artifact.qa_decision;
    case "verification-delta":
      return artifact.state;
    case "trust-report":
      return artifact.trust_state;
    case "retention-review":
      return artifact.recommendation;
    case "operator-summary":
      return artifact.headline;
  }
  return artifact satisfies never;
}

function nextActionsForStage(stage: BuildroomJob["stage"]): string[] {
  switch (stage) {
    case "created":
      return ["Write research-input.json"];
    case "research_collected":
      return ["Dreamer writes idea-contract.json"];
    case "idea_proposed":
      return ["Main/reviewer writes intent-review.json"];
    case "intent_reviewed":
      return ["Main writes main-review.json"];
    case "approved_for_planning":
      return ["Main writes product-plan.json"];
    case "product_planned":
      return [
        "Main approves for coder with main-review decision approved_for_coder",
      ];
    case "approved_for_coder":
      return ["Coder writes build-plan.json"];
    case "build_planned":
      return ["Coder implements and records verification.json"];
    case "implemented":
      return ["Coder records verification.json"];
    case "coder_verified":
      return ["QA writes qa-verification.json"];
    case "qa_verified":
      return ["Write verification-delta.json"];
    case "verification_delta_recorded":
      return ["Trust agent writes trust-report.json"];
    case "trust_reported":
      return ["Retention agent writes retention-review.json"];
    case "retention_reviewed":
      return ["Main/operator writes operator-summary.json"];
    case "blocked":
      return ["Resolve block or close job"];
    case "closed":
      return [];
  }
  return stage satisfies never;
}
