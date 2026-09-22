import { tool } from "ai";
import {
  PrioritizeLeadsInputSchema,
  prioritizeLeads,
  type PrioritizeDeps,
} from "../../runbooks/prioritize-leads";

/**
 * The code-owned answer to "which of our leads should we work next". The
 * model names the base, the table, how many and an optional preference; the
 * runbook pages, filters, ranks and returns the top few with reasons.
 */
export function createPrioritizeLeadsTool(deps: PrioritizeDeps) {
  return tool({
    description:
      "Rank the leads already in an Airtable table and return the top few with reasons. Pages the whole table in code (sorted by the Fit Score field with a short field list), drops closed or lost statuses, ranks by score plus Tier, ICP fit and Priority, and can judge finalists against a free-text preference. Use this for any 'strongest', 'best', 'top N' or 'which leads should we work' question instead of paging airtable_records yourself. Read-only.",
    inputSchema: PrioritizeLeadsInputSchema,
    execute: (input) => prioritizeLeads(input, deps),
  });
}
