import { z } from "zod";
const codes = [
  "unknown_field",
  "permission_denied",
  "invalid_arguments",
  "tool_unavailable",
  "not_found",
  "rate_limited",
  "response_invalid",
  "provider_failure",
  "timeout",
  "temporarily_unavailable",
] as const;
const phases = [
  "provider",
  "discovery",
  "identity_read",
  "schema_read",
  "records_read",
  "records_write",
  "bases_read",
  "execution_envelope",
  "tool_response",
  "remote_file_metadata",
  "schema_projection",
  "schema_size",
  "schema_summary",
] as const;
type Phase = (typeof phases)[number];
class AirtableReadError extends Error {
  constructor(
    readonly code: (typeof codes)[number],
    readonly diagnostic?: ReturnType<typeof responseShape>,
    /** The rejected field name, for unknown_field only; never provider text. */
    readonly field?: string,
  ) {
    super(
      `Airtable action failed: ${code} [${diagnostic?.phase ?? "provider"}]${field ? ` field=${field}` : ""}`,
    );
  }
}
// Airtable names the one field it rejected. That name is the caller's own
// input echoed back, not provider text, so it may travel with the code once
// reduced to plain characters and a bounded length.
const FIELD_NAME_MAX = 80;
function rejectedFieldName(value: unknown): string | undefined {
  const text =
    value instanceof Error ? value.message : (JSON.stringify(value) ?? "");
  // The name may sit behind one or more JSON escapes when the provider text
  // is nested inside an MCP envelope.
  const match = /unknown field names?:?\s*\\*"([^"\\]{1,200})\\*"/i.exec(
    text.slice(0, 50_000),
  );
  const name = match?.[1]?.replace(/[^\w .&/()'-]/g, "").trim();
  if (!name && /unknown field/i.test(text))
    console.warn("[airtable] unknown-field text without a recoverable name");
  return name ? name.slice(0, FIELD_NAME_MAX) : undefined;
}
const MESSAGE_PATTERN =
  /Airtable action failed: (\w+)(?: \[(\w+)\])?(?: field=(.{1,80}))?$/;
// Provider errors may echo authorization values. Inspect internally, emit only
// a fixed code: never forward their text, payload, request, URL or credentials.
export function airtableFailure(
  value: unknown,
  fallback: (typeof codes)[number] = "provider_failure",
  phase: Phase = "provider",
) {
  if (value instanceof AirtableReadError)
    return value.diagnostic?.phase !== "provider"
      ? value
      : new AirtableReadError(
          value.code,
          responseShape(value, phase),
          value.field,
        );
  const field = rejectedFieldName(value);
  if (field)
    return new AirtableReadError(
      "unknown_field",
      responseShape(value, phase),
      field,
    );
  const text = (
    value instanceof Error ? value.message : (JSON.stringify(value) ?? "")
  )
    .slice(0, 50_000)
    .toLowerCase();
  const code =
    (value instanceof Error && value.name === "TimeoutError") ||
    /timed?\s*out|timeout/.test(text)
      ? "timeout"
      : /\b50[234]\b|temporarily unavailable|fetch failed|network error/.test(
            text,
          )
        ? "temporarily_unavailable"
        : value instanceof z.ZodError
          ? "response_invalid"
          : /permission|forbidden|unauthoriz|insufficient.*scope|invalid_permissions|\b403\b|\b401\b/.test(
                text,
              )
            ? "permission_denied"
            : /validation|invalid.*argument|required.*field|missing.*parameter|field required/.test(
                  text,
                )
              ? "invalid_arguments"
              : /tool.*(?:not found|not available|not enabled|not discovered|unknown)|unknown.*tool/.test(
                    text,
                  )
                ? "tool_unavailable"
                : /not.found|\b404\b/.test(text)
                  ? "not_found"
                  : /rate.limit|\b429\b/.test(text)
                    ? "rate_limited"
                    : fallback;
  return new AirtableReadError(code, responseShape(value, phase));
}
export function airtableErrorCode(error: unknown) {
  if (error instanceof AirtableReadError) return error.code;
  // DO RPC preserves the message, not the Error subclass.
  const message = error instanceof Error ? error.message : "";
  const code = MESSAGE_PATTERN.exec(message)?.[1];
  return codes.find((candidate) => candidate === code) ?? "provider_failure";
}
/** The field Airtable rejected, when the failure was an unknown field name. */
export function airtableRejectedField(error: unknown): string | null {
  if (error instanceof AirtableReadError) return error.field ?? null;
  const message = error instanceof Error ? error.message : "";
  return MESSAGE_PATTERN.exec(message)?.[3] ?? null;
}
function responseShape(value: unknown, phase: Phase) {
  const item = z
    .object({
      successful: z.boolean().optional(),
      data: z.unknown().optional(),
      tables: z.array(z.unknown()).optional(),
    })
    .safeParse(value);
  const nested = item.success
    ? z
        .object({
          tables: z.array(z.unknown()).optional(),
          data: z.unknown().optional(),
        })
        .safeParse(item.data.data)
    : null;
  const serialized = JSON.stringify(value) ?? "";
  return {
    phase,
    valueType: Array.isArray(value) ? "array" : typeof value,
    successful: item.success ? (item.data.successful ?? null) : null,
    hasData: item.success && item.data.data !== undefined,
    dataType: item.success
      ? Array.isArray(item.data.data)
        ? "array"
        : typeof item.data.data
      : "unknown",
    tables: item.success && !!item.data.tables,
    nestedTables: !!nested?.success && !!nested.data.tables,
    offloaded: /offload|truncat|workbench|response_file|file_path/i.test(
      serialized,
    ),
  };
}
export function airtableDiagnostic(error: unknown) {
  if (error instanceof AirtableReadError) return error.diagnostic;
  const message = error instanceof Error ? error.message : "";
  const phase = MESSAGE_PATTERN.exec(message)?.[2];
  const known = phases.find((candidate) => candidate === phase);
  return known ? { phase: known } : undefined;
}
export function schemaReadSummary(data: unknown) {
  const parsed = z
    .object({ tables: z.array(z.object({ fields: z.array(z.unknown()) })) })
    .safeParse(data);
  if (!parsed.success)
    throw new AirtableReadError(
      "response_invalid",
      responseShape(data, "schema_summary"),
    );
  return {
    state: "verified" as const,
    operation: "get_schema" as const,
    tableCount: parsed.data.tables.length,
    fieldCount: parsed.data.tables.reduce(
      (n, table) => n + table.fields.length,
      0,
    ),
  };
}
