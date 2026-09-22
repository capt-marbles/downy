import { expect, it } from "vitest";
import {
  airtableFailure,
  airtableDiagnostic,
  airtableErrorCode,
  airtableRejectedField,
  schemaReadSummary,
} from "./airtable-diagnostics";
it.each([
  ["403 forbidden secret-sentinel", "permission_denied"],
  ["validation failed missing parameter secret-sentinel", "invalid_arguments"],
  ["tool not discovered secret-sentinel", "tool_unavailable"],
  ["404 not found secret-sentinel", "not_found"],
  ["429 rate limit secret-sentinel", "rate_limited"],
  ["secret-sentinel", "provider_failure"],
])(
  "maps provider failure to a fixed code without forwarding credentials",
  (message, code) => {
    const error = airtableFailure({ error: message });
    expect(airtableErrorCode(error)).toBe(code);
    expect(airtableErrorCode(new Error(error.message))).toBe(code);
    expect(JSON.stringify(error)).not.toContain("secret-sentinel");
    expect(error.message).not.toContain("secret-sentinel");
  },
);
it("returns only table/field counts and rejects malformed schema", () => {
  expect(
    schemaReadSummary({
      tables: [{ name: "private", fields: [{ name: "private" }] }],
    }),
  ).toEqual({
    state: "verified",
    operation: "get_schema",
    tableCount: 1,
    fieldCount: 1,
  });
  expect(() => schemaReadSummary({ error: "secret" })).toThrow(
    "response_invalid",
  );
});
it("preserves a timeout code and safe phase after crossing the DO RPC boundary", () => {
  const error = airtableFailure(
    new DOMException("secret-sentinel", "TimeoutError"),
    "provider_failure",
    "schema_read",
  );
  const rpcError = new Error(error.message);
  expect(airtableErrorCode(rpcError)).toBe("timeout");
  expect(airtableDiagnostic(rpcError)?.phase).toBe("schema_read");
  expect(error.message).not.toContain("secret-sentinel");
});
it("names the rejected field for an unknown field name and keeps it across the RPC boundary", () => {
  const error = airtableFailure(
    {
      successful: false,
      error:
        'Unknown field name: "ICP Tier". Field names are case-sensitive. secret-sentinel',
      data: { status_code: 422 },
    },
    "provider_failure",
    "records_read",
  );
  expect(airtableErrorCode(error)).toBe("unknown_field");
  expect(airtableRejectedField(error)).toBe("ICP Tier");
  expect(error.message).not.toContain("secret-sentinel");
  const crossed = new Error(error.message);
  expect(airtableErrorCode(crossed)).toBe("unknown_field");
  expect(airtableRejectedField(crossed)).toBe("ICP Tier");
  expect(airtableDiagnostic(crossed)).toEqual({ phase: "records_read" });
  // Names are reduced to plain characters and bounded; other failures carry none.
  const odd = airtableFailure(new Error('Unknown field name: "<b>Game</b>\n"'));
  expect(airtableRejectedField(odd)).toBe("bGame/b");
  expect(airtableRejectedField(airtableFailure(new Error("403")))).toBeNull();
});
