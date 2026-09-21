import { z } from "zod";
import type { AirtableReadAction } from "../../lib/airtable-connect";
import type { SlackReadAction } from "../../lib/slack-connect";

/**
 * Fresh verification immediately before a confirmed staged action touches a
 * connector. The tap bound the operator to an exact payload; this checks
 * that the world the payload assumed still holds, using authenticated reads
 * through the same grant, never the card's own text. A failure here means
 * nothing ran, so it is reported as failed, not unknown.
 */
type Verification = { ok: true } | { ok: false; reason: string };

type AirtableRead = (
  action: AirtableReadAction,
) => Promise<{ account: string; data: unknown }>;
type SlackList = (action: SlackReadAction) => Promise<{
  channels: { id: string; name: string; member: boolean }[];
  nextCursor: string | null;
}>;

const RecordsSchema = z.object({
  records: z.array(z.object({ id: z.string() })),
});
const SchemaSchema = z.object({
  tables: z.array(z.object({ id: z.string() })),
});

/** Every record an update targets must still exist in that base and table. */
export async function verifyAirtableRecords(
  read: AirtableRead,
  args: { baseId: string; tableId: string; recordIds: string[] },
): Promise<Verification> {
  const ids = [...new Set(args.recordIds)];
  const formula = `OR(${ids.map((id) => `RECORD_ID()='${id.replace(/'/g, "")}'`).join(",")})`;
  let found: Set<string>;
  try {
    const result = await read({
      action: "list_records",
      baseId: args.baseId,
      tableId: args.tableId,
      filterByFormula: formula,
      limit: Math.min(100, Math.max(1, ids.length)),
    });
    found = new Set(RecordsSchema.parse(result.data).records.map((r) => r.id));
  } catch {
    return {
      ok: false,
      reason: "the records could not be re-read from Airtable just now",
    };
  }
  const missing = ids.filter((id) => !found.has(id));
  return missing.length
    ? {
        ok: false,
        reason: `${missing.length} of ${ids.length} target record${ids.length === 1 ? "" : "s"} no longer exist${missing.length === 1 ? "s" : ""} in that table (${missing.join(", ")})`,
      }
    : { ok: true };
}

/** The target table must still exist in the base before creating records. */
export async function verifyAirtableTable(
  read: AirtableRead,
  args: { baseId: string; tableId: string },
): Promise<Verification> {
  try {
    const result = await read({ action: "get_schema", baseId: args.baseId });
    const tables = SchemaSchema.parse(result.data).tables;
    return tables.some((table) => table.id === args.tableId)
      ? { ok: true }
      : {
          ok: false,
          reason: `table ${args.tableId} is not in base ${args.baseId} any more`,
        };
  } catch {
    return {
      ok: false,
      reason: "the base schema could not be re-read from Airtable just now",
    };
  }
}

const normalizeChannel = (value: string) =>
  value.trim().replace(/^#/, "").toLowerCase();

/** The channel must still resolve and the app must be a member of it. */
export async function verifySlackChannel(
  list: SlackList,
  channel: string,
): Promise<Verification> {
  const wanted = normalizeChannel(channel);
  let cursor: string | undefined;
  try {
    for (let page = 0; page < 5; page++) {
      const result = await list({
        action: "list_channels",
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      const match = result.channels.find(
        (entry) =>
          entry.id === channel || normalizeChannel(entry.name) === wanted,
      );
      if (match)
        return match.member
          ? { ok: true }
          : {
              ok: false,
              reason: `the Downy app is not a member of ${match.name} (${match.id}); invite it, then propose again`,
            };
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
  } catch {
    return {
      ok: false,
      reason: "the channel list could not be re-read from Slack just now",
    };
  }
  return {
    ok: false,
    reason: `channel ${channel} was not found in the connected workspace`,
  };
}
