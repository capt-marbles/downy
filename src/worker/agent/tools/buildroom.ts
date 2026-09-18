import { tool } from "ai";
import { z } from "zod";

import { createBuildroomJob, listBuildroomJobs } from "../../buildroom/db";
import { CreateBuildroomJobInputSchema } from "../../buildroom/schemas";

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
