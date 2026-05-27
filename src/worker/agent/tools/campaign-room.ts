import { tool } from "ai";
import { z } from "zod";
import type { Workspace } from "@cloudflare/shell";

import {
  readCampaignArtifact,
  writeCampaignArtifact,
} from "../../campaign-room/artifacts";
import {
  CampaignArtifactNameSchema,
  CampaignArtifactSchema,
} from "../../campaign-room/schemas";

export function createWriteCampaignArtifactTool(args: {
  agentSlug: string;
  getWorkspace: () => Workspace;
}) {
  return tool({
    description:
      "Validate and write a typed Campaign Room GTM artifact for a Buildroom/Campaign workflow job. Use for content, lead sourcing, cold email, and digest workflow outputs. Does not advance the engineering Buildroom lifecycle.",
    inputSchema: z.object({
      jobId: z.string().min(1),
      artifact: CampaignArtifactSchema,
    }),
    execute: async ({ jobId, artifact }) =>
      writeCampaignArtifact({
        workspace: args.getWorkspace(),
        agentSlug: args.agentSlug,
        jobId,
        artifact,
      }),
  });
}

export function createReadCampaignArtifactTool(args: {
  getWorkspace: () => Workspace;
}) {
  return tool({
    description:
      "Read a typed Campaign Room GTM artifact from a Buildroom/Campaign workflow job by artifact name.",
    inputSchema: z.object({
      jobId: z.string().min(1),
      artifactName: CampaignArtifactNameSchema,
    }),
    execute: async ({ jobId, artifactName }) => ({
      artifact: await readCampaignArtifact({
        workspace: args.getWorkspace(),
        jobId,
        artifactName,
      }),
    }),
  });
}
