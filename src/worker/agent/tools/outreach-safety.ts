import { tool } from "ai";
import { z } from "zod";
import { OutreachSafety, SUPPRESSION_REASONS } from "../outreach-safety";

/**
 * The do-not-contact list and unresolved draft attempts. The model may read
 * both and add suppressions, which only narrow what can be drafted; lifting a
 * suppression or abandoning an attempt is a staged card the operator confirms.
 */
export function createOutreachSafetyTool(db: D1Database) {
  return tool({
    description:
      "The do-not-contact list and unresolved draft attempts that gate every Gmail draft. list shows both. suppress adds an address or @domain when someone opts out, asks not to be contacted, bounces, or the operator says so; it takes effect for every future draft. Lifting a suppression or abandoning an unresolved attempt is operator-only: propose stage_action kind outreach_unsuppress or outreach_abandon for the operator to confirm.",
    inputSchema: z.discriminatedUnion("action", [
      z.object({ action: z.literal("list") }).strict(),
      z
        .object({
          action: z.literal("suppress"),
          address: z.string().min(3).max(320),
          reason: z.enum(SUPPRESSION_REASONS),
          note: z.string().max(500).optional(),
        })
        .strict(),
    ]),
    execute: async (input) => {
      const safety = new OutreachSafety(db);
      if (input.action === "list")
        return {
          suppressions: await safety.listSuppressions(),
          unresolvedAttempts: await safety.unresolvedAttempts(),
        };
      try {
        return {
          suppressed: await safety.suppress(
            input.address,
            input.reason,
            input.note,
          ),
        };
      } catch (error) {
        return {
          error:
            error instanceof z.ZodError
              ? "Use an email address or an @domain."
              : "Could not save the suppression.",
        };
      }
    },
  });
}
