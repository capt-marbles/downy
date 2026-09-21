import { z } from "zod";

/**
 * A standing grant is the operator's one-time approval for a scheduled task
 * to take a specific external action on every run without a per-run tap.
 * Grants ride on the schedule_task card: confirming that card approves them.
 * A scheduled worker's proposal that a grant covers executes immediately and
 * leaves a receipt naming the approval; anything a grant does not cover
 * becomes an ordinary card for the operator.
 */
const channel = z.string().min(1).max(100);

const airtableScope = {
  baseId: z
    .string()
    .regex(/^app[a-zA-Z0-9]+$/)
    .max(100),
  tableId: z
    .string()
    .regex(/^tbl[a-zA-Z0-9]+$/)
    .max(100),
  tableLabel: z.string().min(1).max(120),
};

export const StandingGrantSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("airtable_update_records"), ...airtableScope })
    .strict(),
  z
    .object({
      kind: z.literal("airtable_create_records"),
      baseId: z
        .string()
        .regex(/^app[a-zA-Z0-9]+$/)
        .max(100),
      tableId: z
        .string()
        .regex(/^tbl[a-zA-Z0-9]+$/)
        .max(100),
      tableLabel: z.string().min(1).max(120),
    })
    .strict(),
  z
    .object({
      kind: z.literal("slack_post_message"),
      channel,
      channelLabel: z.string().min(1).max(120),
    })
    .strict(),
]);
export type StandingGrant = z.infer<typeof StandingGrantSchema>;

export const StandingGrantsSchema = z.array(StandingGrantSchema).max(5);

const normalizeChannel = (value: string) =>
  value.trim().replace(/^#/, "").toLowerCase();

/** Exact scope match only: same kind, same base and table, or same channel. */
export function grantCovers(
  grant: StandingGrant,
  payload: { kind: string } & Record<string, unknown>,
): boolean {
  if (grant.kind !== payload.kind) return false;
  if (
    grant.kind === "airtable_create_records" ||
    grant.kind === "airtable_update_records"
  ) {
    const write =
      grant.kind === "airtable_create_records"
        ? payload.airtableCreateRecords
        : payload.airtableUpdateRecords;
    return (
      !!write &&
      typeof write === "object" &&
      "baseId" in write &&
      "tableId" in write &&
      write.baseId === grant.baseId &&
      write.tableId === grant.tableId
    );
  }
  const post = payload.slackPostMessage;
  return (
    !!post &&
    typeof post === "object" &&
    "channel" in post &&
    typeof post.channel === "string" &&
    normalizeChannel(post.channel) === normalizeChannel(grant.channel)
  );
}

export function describeGrant(grant: StandingGrant): string {
  switch (grant.kind) {
    case "airtable_create_records":
      return `create records in Airtable table ${grant.tableLabel} (${grant.tableId})`;
    case "airtable_update_records":
      return `update records in Airtable table ${grant.tableLabel} (${grant.tableId})`;
    case "slack_post_message":
      return `post to Slack ${grant.channelLabel} (${grant.channel}) as the Downy app`;
  }
  return grant satisfies never;
}
