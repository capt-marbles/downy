import { expect, it } from "vitest";
import {
  airtableFailure,
  airtableErrorCode,
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
