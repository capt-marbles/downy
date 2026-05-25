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

export function createRequestLocalHandsActionTool(args: {
  db: D1Database;
  agentSlug: string;
}) {
  return tool({
    description:
      "Request work from the user's local hands connector. Use for local shell/filesystem/browser/Xurl/Jcode/git tasks that cannot safely run in Cloudflare. Non-read-only actions enter pending_confirmation and must be approved before a local daemon can claim them.",
    inputSchema: RequestLocalHandsActionInputSchema,
    execute: async (input) => ({
      action: await requestLocalHandsAction(args.db, {
        agentSlug: args.agentSlug,
        input,
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
