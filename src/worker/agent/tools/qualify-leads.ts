import { tool } from "ai";
import { z } from "zod";

import type { JevRunner } from "../../jev/client";
import { LeadCandidateSchema, qualifyLeads } from "../../runbooks/lead-qualify";

/**
 * Typed ICP qualification for lead sourcing. Reads only: the model passes
 * candidates it found, Jev answers a fixed rubric per candidate, code
 * composes tier, priority and Fit Score. Nothing is written anywhere.
 */
export function createQualifyLeadsTool(args: { run: JevRunner }) {
  return tool({
    description:
      "Qualify game-studio lead candidates against Gameye's ICP rubric with typed, reproducible judgments (multiplayer architecture, launch proximity, server pain, funding, exclusions, named hosting vendor). Pass up to 40 candidates with the studio name and the source snippet; each returns decision keep/drop/needs_review, Tier A/B, Priority, ICP Fit, Fit Score 0-100, Current Infra and reasons. Use this instead of judging tiers in prose. Read-only: it writes nothing.",
    inputSchema: z.object({
      candidates: z.array(LeadCandidateSchema).min(1).max(40),
    }),
    execute: async ({ candidates }) => {
      const result = await qualifyLeads({ candidates, run: args.run });
      const evaluated = result.outcomes.filter((o) => o.state === "evaluated");
      return {
        ...result,
        summary: {
          candidates: candidates.length,
          keep: evaluated.filter((o) => o.verdict.decision === "keep").length,
          needsReview: evaluated.filter(
            (o) => o.verdict.decision === "needs_review",
          ).length,
          drop: evaluated.filter((o) => o.verdict.decision === "drop").length,
          unavailable: result.outcomes.length - evaluated.length,
        },
        note: "Verdicts are typed model judgments on the supplied text only. Dedupe against Airtable in code before proposing any records; needs_review leads want a human look, not a record.",
      };
    },
  });
}
