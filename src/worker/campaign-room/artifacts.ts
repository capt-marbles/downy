import type { Workspace } from "@cloudflare/shell";

import { buildroomJobPath } from "../buildroom/paths";
import {
  CampaignArtifactNameSchema,
  CampaignArtifactSchema,
  type CampaignArtifact,
  type CampaignArtifactName,
} from "./schemas";

export type CampaignWriteResult = {
  artifact: CampaignArtifact;
  artifactPath: string;
  eventPath: string;
};

export function campaignArtifactPath(
  jobId: string,
  artifactName: CampaignArtifactName,
): string {
  return `${buildroomJobPath(jobId)}/campaign/${artifactName}.json`;
}

function campaignEventsPath(jobId: string): string {
  return `${buildroomJobPath(jobId)}/campaign/events.jsonl`;
}

export async function writeCampaignArtifact(args: {
  workspace: Workspace;
  agentSlug: string;
  jobId: string;
  artifact: unknown;
}): Promise<CampaignWriteResult> {
  const artifact = CampaignArtifactSchema.parse(args.artifact);
  if (artifact.job_id !== args.jobId) {
    throw new Error("Campaign artifact job_id must match target job id");
  }
  if (artifact.agent_slug !== args.agentSlug) {
    throw new Error(
      "Campaign artifact agent_slug must match active agent slug",
    );
  }
  const artifactPath = campaignArtifactPath(args.jobId, artifact.artifact_type);
  await args.workspace.writeFile(
    artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  const eventPath = campaignEventsPath(args.jobId);
  const prior = (await args.workspace.readFile(eventPath)) ?? "";
  await args.workspace.writeFile(
    eventPath,
    `${prior}${JSON.stringify({
      at: new Date().toISOString(),
      actor: args.agentSlug,
      artifact: artifact.artifact_type,
      path: artifactPath,
    })}\n`,
  );
  return { artifact, artifactPath, eventPath };
}

export async function readCampaignArtifact(args: {
  workspace: Workspace;
  jobId: string;
  artifactName: CampaignArtifactName;
}): Promise<CampaignArtifact | null> {
  const artifactName = CampaignArtifactNameSchema.parse(args.artifactName);
  const raw = await args.workspace.readFile(
    campaignArtifactPath(args.jobId, artifactName),
  );
  if (raw == null) return null;
  return CampaignArtifactSchema.parse(JSON.parse(raw));
}
