import { gzipSync } from "node:zlib";
import { expect, it, vi } from "vitest";
import { readOffloadedAirtableSchema } from "./airtable-schema";
import type { ManagedCall } from "./managed-protocol";
const schema = {
  tables: [
    {
      id: "tblOne",
      name: "Leads",
      fields: [
        {
          id: "fldStage",
          name: "Stage",
          type: "singleSelect",
          options: { choices: [{ name: "New" }] },
        },
      ],
    },
  ],
};
const envelope = (payload: unknown) => ({
  structuredContent: { successful: true, data: payload },
});
function output(payload: unknown) {
  return envelope({
    stdout: JSON.stringify({
      schema_gzip_base64: gzipSync(JSON.stringify(payload)).toString("base64"),
    }),
    stderr: "",
  });
}
it("retrieves a large saved schema using a fixed projection without exposing an executor", async () => {
  const call = vi.fn<ManagedCall>(async () => output(schema));
  expect(
    await readOffloadedAirtableSchema(call, "session", {
      file_path: "/mnt/files/response.json",
    }),
  ).toEqual(schema);
  expect(call.mock.calls[0][0]).toBe("COMPOSIO_REMOTE_WORKBENCH");
  const args = call.mock.calls[0][1];
  expect(args.session_id).toBe("session");
  expect(args.code_to_execute).toContain("AIRTABLE_GET_BASE_SCHEMA");
  expect(args.code_to_execute).not.toContain("run_composio_tool");
  expect(args.code_to_execute).not.toContain("proxy_execute");
});
it.each([
  "/etc/credentials.json",
  "/mnt/files/../credentials.json",
  "/mnt/files/x.json';evil()",
  "https://example.com/schema.json",
])(
  "rejects unsafe provider paths before invoking the workbench",
  async (path) => {
    const call = vi.fn<ManagedCall>();
    await expect(
      readOffloadedAirtableSchema(call, "session", { file_path: path }),
    ).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  },
);
it("rejects partial output, oversized decompression and invalid schema instead of counting it", async () => {
  for (const response of [
    envelope({
      stdout: "truncated",
      stderr: "",
      stdout_file_path: "/mnt/files/stdout.txt",
    }),
    output({ tables: [], padding: "x".repeat(1_048_577) }),
    output({ records: [] }),
  ]) {
    await expect(
      readOffloadedAirtableSchema(async () => response, "session", {
        file_path: "/mnt/files/response.json",
      }),
    ).rejects.toThrow();
  }
});
