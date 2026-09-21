import { tool } from "ai";
import type { JevRunner } from "../../jev/client";
import {
  checkOutreachDraft,
  OutreachDraftCheckInputSchema,
} from "../../runbooks/outreach-qa";

/**
 * Read-only QA over drafted outreach. The returned `body` is the only body
 * gmail_email create_draft will accept for a template draft: the wrapper
 * checks its digest, so a draft cannot skip the check.
 */
export function createCheckOutreachDraftTool(args: {
  run: JevRunner;
  remember: (digest: string) => Promise<void>;
}) {
  return tool({
    description:
      "Check drafted outreach email variants against Gameye's voice and positioning rules and against the lead's evidence before creating the Gmail draft. Pass the lead, its tier, the evidence the opener rests on (Notes, Outreach Angles, source excerpt) and up to two variants. Returns a verdict (pass, revise, block), the failed rules per variant, and on pass or revise the exact `body` to use with gmail_email create_draft; a template draft with any other body is refused. On block, fix the named rules and check again, at most twice.",
    inputSchema: OutreachDraftCheckInputSchema,
    execute: async (input) => {
      const result = await checkOutreachDraft(args.run, input);
      if (result.digest) await args.remember(result.digest);
      return result;
    },
  });
}
