import { tool } from "ai";
import { z } from "zod";

import {
  confirmLocalHandsAction,
  listLocalHandsActions,
  listLocalHandsConnectors,
  requestLocalHandsAction,
} from "../../local-hands/db";
import {
  ConfirmLocalHandsActionInputSchema,
  RequestLocalHandsActionInputSchema,
} from "../../local-hands/types";

const GrokResearchInputSchema = z.object({
  query: z.string().min(1).max(4000),
  mode: z
    .enum([
      "research_summary",
      "source_scan",
      "lead_signal_scan",
      "content_angles",
    ])
    .default("research_summary"),
  maxResults: z.number().int().min(1).max(20).default(10),
  outputArtifact: z
    .enum(["campaign-source-notes", "campaign-digest"])
    .default("campaign-source-notes"),
  context: z.string().max(4000).optional(),
  targetConnectorId: z.string().min(1).max(120).default("mac-studio"),
});

export function createRequestLocalHandsActionTool(args: {
  scheduled?: boolean;
  db: D1Database;
  agentSlug: string;
}) {
  return tool({
    description:
      "Queue local work. For Studio browser reads use kind browser with input {url}; for X search use kind x.research with input {query,maxResults:1..20}. Both are read_only, default to mac-studio, expire after 24h and return observed sources to chat/workspace asynchronously. Set requiresConfirmation:false for these reads. No scripts, arbitrary clicks or browser writes. Inspect connector capabilities for other kinds; non-read-only work requires operator confirmation.",
    inputSchema: RequestLocalHandsActionInputSchema,
    execute: async (input) => ({
      action: await requestLocalHandsAction(args.db, {
        agentSlug: args.agentSlug,
        input,
        scheduled: args.scheduled,
      }),
    }),
  });
}

export function createListLocalHandsActionsTool(args: {
  db: D1Database;
  agentSlug: string;
}) {
  return tool({
    description:
      "List pending, claimed, and optionally completed local hands actions plus connector status.",
    inputSchema: z.object({ includeCompleted: z.boolean().optional() }),
    execute: async ({ includeCompleted }) => ({
      actions: await listLocalHandsActions(args.db, {
        agentSlug: args.agentSlug,
        includeCompleted,
      }),
      connectors: await listLocalHandsConnectors(args.db, args.agentSlug),
    }),
  });
}

export function createConfirmLocalHandsActionTool(args: { db: D1Database }) {
  return tool({
    description:
      "Approve or reject a pending local hands action after explicit operator confirmation. Never approve destructive or external-side-effect actions without the user's direct confirmation.",
    inputSchema: ConfirmLocalHandsActionInputSchema,
    execute: async (input) => ({
      action: await confirmLocalHandsAction(args.db, input),
    }),
  });
}

export function createRequestGrokResearchTool(args: {
  db: D1Database;
  agentSlug: string;
}) {
  return tool({
    description:
      "Queue an X search in the Mac Studio's authenticated Aside browser. Returns a job id immediately; observed posts and links arrive in chat and workspace when complete. This is a bounded Latest search, not exhaustive coverage or verified claims. Never posts, likes, replies, DMs or follows. Use browser reads for approved public source URLs.",
    inputSchema: GrokResearchInputSchema,
    execute: async ({ targetConnectorId, ...input }) => ({
      action: await requestLocalHandsAction(args.db, {
        agentSlug: args.agentSlug,
        input: {
          kind: "x.research",
          targetConnectorId,
          riskLevel: "read_only",
          requiresConfirmation: false,
          requestedBy: "campaign-room",
          input,
        },
      }),
    }),
  });
}
