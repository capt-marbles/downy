import { tool } from "ai";
import { z } from "zod";

import {
  describeStagedAction,
  StagedActionPayloadSchema,
  type StagedAction,
} from "../../../lib/staged-actions";

/**
 * Propose an external action as a card in chat. The tool never executes
 * anything: the operator confirms by tapping the card, and no model tool can
 * confirm on their behalf. Available in chat and voice.
 */
export function createStageActionTool(args: {
  stage: (
    payload: z.infer<typeof StagedActionPayloadSchema>,
  ) => Promise<StagedAction>;
}) {
  return tool({
    description:
      "Propose an external action for the user to confirm with a tap in chat: a Gmail draft (kind gmail_draft) or a recurring scheduled task (kind schedule_task). This ONLY stages the proposal as a card; nothing is drafted or scheduled until the user taps Confirm there. A spoken or typed yes is not confirmation. Put the exact final content in the payload; a changed proposal is a new card. Returns the proposal id and revision. Use list_staged_actions to check whether a proposal was confirmed and what happened.",
    inputSchema: StagedActionPayloadSchema,
    execute: async (payload) => {
      const action = await args.stage(payload);
      return {
        stagedActionId: action.id,
        revision: action.revision,
        state: action.state,
        title: describeStagedAction(action.payload).title,
        note: "Proposed only. Nothing has run. The user confirms or cancels on the card in chat.",
      };
    },
  });
}

export function createListStagedActionsTool(args: {
  list: () => Promise<StagedAction[]>;
}) {
  return tool({
    description:
      "List recent proposed actions and their states: proposed (awaiting the user's tap), executing, succeeded, failed, unknown (submitted but unverified), or cancelled. Read this before saying whether a draft or schedule exists.",
    inputSchema: z.object({}),
    execute: async () => ({
      stagedActions: (await args.list()).map((action) => ({
        id: action.id,
        kind: action.payload.kind,
        title: describeStagedAction(action.payload).title,
        state: action.state,
        createdAt: action.createdAt,
        expiresAt: action.expiresAt,
        result: action.result,
        error: action.error,
      })),
    }),
  });
}
