import { tool } from "ai";
import { z } from "zod";

import { createBuildroomJob, listBuildroomJobs } from "../../buildroom/db";
import { writeBuildroomArtifact } from "../../buildroom/artifacts";
import {
  BuildroomArtifactSchema,
  BuildroomRoleSchema,
  CreateBuildroomJobInputSchema,
} from "../../buildroom/schemas";
import type { Workspace } from "@cloudflare/shell";

export function createBuildroomJobTool(args: {
  db: D1Database;
  agentSlug: string;
}) {
  return tool({
    description:
      "Create a Buildroom workflow job. Use this before writing research, idea, review, plan, verification, trust, retention, or operator-summary artifacts.",
    inputSchema: CreateBuildroomJobInputSchema,
    execute: async (input) => ({
      job: await createBuildroomJob(args.db, {
        agentSlug: args.agentSlug,
        input,
      }),
    }),
  });
}

export function createListBuildroomJobsTool(args: {
  db: D1Database;
  agentSlug: string;
}) {
  return tool({
    description: "List this agent's Buildroom workflow jobs.",
    inputSchema: z.object({}),
    execute: async () => ({
      jobs: await listBuildroomJobs(args.db, args.agentSlug),
    }),
  });
}

export function createWriteBuildroomArtifactTool(args: {
  db: D1Database;
  agentSlug: string;
  getWorkspace: () => Workspace;
}) {
  return tool({
    description:
      "Validate and write a Buildroom artifact, enforcing role permissions and lifecycle order. The artifact.job_id and artifact.agent_slug must match the target job and current agent.",
    inputSchema: z.object({
      jobId: z.string().min(1),
      actorRole: BuildroomRoleSchema,
      artifact: BuildroomArtifactSchema,
    }),
    execute: async ({ jobId, actorRole, artifact }) =>
      writeBuildroomArtifact({
        db: args.db,
        workspace: args.getWorkspace(),
        agentSlug: args.agentSlug,
        actorRole,
        jobId,
        artifact,
      }),
  });
}
