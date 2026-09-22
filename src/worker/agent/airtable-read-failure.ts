import { z } from "zod";
import type { z as zod } from "zod";
import type { AirtableActionSchema } from "../../lib/airtable-connect";
type AirtableAction = zod.infer<typeof AirtableActionSchema>;
import {
  airtableDiagnostic,
  airtableErrorCode,
  airtableRejectedField,
} from "../composio/airtable-diagnostics";

/**
 * The failed-read result handed back to the model. Airtable rejects a whole
 * read for one wrong field name and says which one; that name is looked up
 * in the table's schema so the retry can use real names instead of guessing.
 */
const SchemaShape = z.object({
  data: z.object({
    tables: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        fields: z.array(z.object({ name: z.string() })),
      }),
    ),
  }),
});
const FIELD_LIST_MAX = 60;

export async function airtableReadFailure(
  error: unknown,
  input: AirtableAction,
  readSchema: (baseId: string) => Promise<unknown>,
): Promise<{
  state: "failed";
  code: string;
  phase: string | undefined;
  error: string;
}> {
  const code = airtableErrorCode(error);
  const phase = airtableDiagnostic(error)?.phase;
  const failed = { state: "failed" as const, code, phase };
  if (["timeout", "temporarily_unavailable"].includes(code))
    return {
      ...failed,
      error:
        "Airtable is temporarily unavailable. The read did not complete after bounded recovery. This does not establish an authorization problem; do not ask the user to reconnect solely because of this error.",
    };
  const field = airtableRejectedField(error);
  if (field && input.action === "list_records") {
    const names = await tableFieldNames(
      readSchema,
      input.baseId,
      input.tableId,
    );
    return {
      ...failed,
      error: names
        ? `Airtable rejected the whole read because the field "${field}" does not exist in table ${names.table}. Its fields are: ${names.fields.join(", ")}. Use these exact names in fields, filterByFormula and sort, then retry once.`
        : `Airtable rejected the whole read because the field "${field}" does not exist. Call get_schema, use the exact field names it returns, then retry once.`,
    };
  }
  return {
    ...failed,
    error: `Airtable did not return a verified result. Check its connection card, base/table access, and schema; no records were changed.${input.action === "list_records" && (input.fields?.length || input.filterByFormula || input.sort) ? " Field names in fields, filterByFormula and sort must match the schema exactly; a large page can also fail to return, so keep limit at 25 or fewer with a fields list." : ""}`,
  };
}

async function tableFieldNames(
  readSchema: (baseId: string) => Promise<unknown>,
  baseId: string,
  tableId: string,
): Promise<{ table: string; fields: string[] } | null> {
  try {
    const raw = await readSchema(baseId);
    const parsed = SchemaShape.safeParse(
      typeof raw === "string" ? JSON.parse(raw) : raw,
    );
    const table = parsed.success
      ? parsed.data.data.tables.find((candidate) => candidate.id === tableId)
      : undefined;
    if (!table) return null;
    return {
      table: `${table.name} (${table.id})`,
      fields: table.fields.slice(0, FIELD_LIST_MAX).map((f) => f.name),
    };
  } catch {
    return null;
  }
}
