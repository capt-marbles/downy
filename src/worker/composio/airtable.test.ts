import { gzipSync } from "node:zlib";
import { z } from "zod";
import { expect, it, vi } from "vitest";
import { AirtableConnection, type AirtableStateSchema } from "./airtable";
import {
  airtableErrorCode,
  airtableRejectedField,
} from "./airtable-diagnostics";
import {
  AirtableActionSchema,
  isAirtableConnectRequest,
} from "../../lib/airtable-connect";
import type { ManagedCall } from "./managed-protocol";

const envelope = (data: unknown) => ({
  structuredContent: { successful: true, data, token: "secret-sentinel" },
});
function fixture() {
  let state: z.infer<typeof AirtableStateSchema> | undefined;
  let accounts: string[] = [];
  let now = 100000;
  let failProfile = false;
  let offload = false;
  const call = vi.fn<ManagedCall>(async (name, args) => {
    if (name === "COMPOSIO_SEARCH_TOOLS")
      return envelope({
        session: { id: "session" },
        toolkit_connection_statuses: [
          {
            toolkit: "airtable",
            has_active_connection: accounts.length > 0,
            connection_details: null,
            accounts: accounts.map((id) => ({
              id,
              status: "ACTIVE",
              is_default: id === "one",
              user_info: { email: `${id}@example.com` },
            })),
          },
        ],
      });
    if (name === "COMPOSIO_MANAGE_CONNECTIONS")
      return envelope({
        results: {
          airtable: {
            toolkit: "airtable",
            status: "initiated",
            redirect_url: "https://connect.composio.dev/link/test",
          },
        },
      });
    if (
      name === "COMPOSIO_REMOTE_WORKBENCH" &&
      String(args.code_to_execute).includes("AIRTABLE_LIST_RECORDS")
    )
      return envelope({
        stdout: JSON.stringify({
          schema_gzip_base64: gzipSync(
            JSON.stringify({
              records: [{ id: "recOffloaded1", fields: { Name: "Big page" } }],
              offset: "offloaded-next",
            }),
          ).toString("base64"),
        }),
        stderr: "",
      });
    if (name === "COMPOSIO_REMOTE_WORKBENCH")
      return envelope({
        stdout: JSON.stringify({
          schema_gzip_base64: gzipSync(
            JSON.stringify({
              tables: [
                {
                  id: "tblExample",
                  name: "Leads",
                  fields: [
                    { id: "fldStage", name: "Stage", type: "singleSelect" },
                  ],
                },
              ],
            }),
          ).toString("base64"),
        }),
        stderr: "",
      });
    const item = z
      .array(
        z.object({
          tool_slug: z.string(),
          account: z.string(),
          arguments: z.record(z.string(), z.unknown()),
        }),
      )
      .parse(args.tools)[0];
    if (failProfile && item.tool_slug === "AIRTABLE_GET_USER_INFO")
      return envelope({
        results: [
          {
            tool_slug: item.tool_slug,
            error: "secret-sentinel",
            response: null,
          },
        ],
      });
    if (
      offload &&
      ["AIRTABLE_GET_BASE_SCHEMA", "AIRTABLE_LIST_RECORDS"].includes(
        item.tool_slug,
      )
    )
      return envelope({
        remote_file_info: { file_path: "/mnt/files/response.json" },
        results: [
          { tool_slug: item.tool_slug, response: { successful: true } },
        ],
      });
    if (
      item.tool_slug === "AIRTABLE_LIST_RECORDS" &&
      JSON.stringify(item.arguments.fields ?? []).includes("Ghost")
    )
      return envelope({
        results: [
          {
            tool_slug: item.tool_slug,
            error: 'Unknown field name: "Ghost". secret-sentinel',
            response: { successful: false },
          },
        ],
      });
    return envelope({
      results: [
        {
          tool_slug: item.tool_slug,
          response: {
            successful: true,
            data:
              item.tool_slug === "AIRTABLE_GET_USER_INFO"
                ? {
                    id: `usr${item.account}`,
                    email: `${item.account}@example.com`,
                  }
                : item.tool_slug === "AIRTABLE_GET_BASE_SCHEMA"
                  ? {
                      tables: [
                        {
                          id: "tblExample",
                          name: "Leads",
                          description: "raw detail",
                          views: [{ id: "viw1" }],
                          fields: [
                            {
                              id: "fldStage",
                              name: "Stage",
                              type: "singleSelect",
                              options: {
                                choices: [{ id: "sel1", name: "New" }],
                              },
                            },
                          ],
                        },
                      ],
                    }
                  : {
                      records: [{ id: "rec1", fields: { Name: "Example" } }],
                      offset: "next-page",
                    },
          },
        },
      ],
    });
  });
  const make = () =>
    new AirtableConnection(
      call,
      async () => (state ? structuredClone(state) : undefined),
      async (value) => {
        state = structuredClone(value);
      },
      () => now,
    );
  return {
    make,
    call,
    offload: () => {
      offload = true;
    },
    connect: (ids = ["one"]) => {
      accounts = ids;
    },
    advance: () => {
      now += 11000;
    },
    expire: () => {
      now += 16 * 60_000;
    },
    failProfile: () => {
      failProfile = true;
    },
  };
}
it("viewing an Airtable card never attaches an account or initiates authorization", async () => {
  const f = fixture();
  f.connect();
  expect(await f.make().status(true)).toMatchObject({
    state: "not_connected",
    authorized: false,
  });
  expect(f.call.mock.calls.map(([name]) => name)).toEqual([
    "COMPOSIO_SEARCH_TOOLS",
  ]);
});
it("consent resumes the same link, verifies identity, and persists the verified connection", async () => {
  const f = fixture();
  const started = await f.make().start();
  expect(await f.make().start()).toEqual(started);
  f.connect();
  f.advance();
  const ready = await f.make().status(true);
  expect(ready).toMatchObject({
    state: "ready",
    identity: "one@example.com (usrone)",
  });
  expect(JSON.stringify(ready)).not.toContain("secret-sentinel");
  expect(
    f.call.mock.calls.filter(
      ([name]) => name === "COMPOSIO_MANAGE_CONNECTIONS",
    ),
  ).toHaveLength(1);
  expect((await f.make().status()).state).toBe("ready");
});
it("multiple accounts require a choice; execution stays pinned and paginates bounded reads", async () => {
  const f = fixture();
  f.connect(["one", "two"]);
  await f.make().start();
  expect((await f.make().status()).state).toBe("needs_selection");
  await expect(f.make().select("foreign")).rejects.toThrow("unavailable");
  expect(
    f.call.mock.calls.filter(
      ([name]) => name === "COMPOSIO_MULTI_EXECUTE_TOOL",
    ),
  ).toHaveLength(0);
  await f.make().select("two");
  const result = await f.make().action({
    action: "list_records",
    baseId: "appExample",
    tableId: "tblExample",
    limit: 20,
    offset: "existing-cursor",
    filterByFormula: "{Priority}='High'",
  });
  expect(result.data).toMatchObject({ offset: "next-page" });
  expect(f.call.mock.calls.at(-1)?.[1]).toMatchObject({
    tools: [
      {
        tool_slug: "AIRTABLE_LIST_RECORDS",
        account: "two",
        arguments: {
          baseId: "appExample",
          tableIdOrName: "tblExample",
          pageSize: 20,
          offset: "existing-cursor",
        },
      },
    ],
  });
  // maxRecords caps the whole traversal and would suppress later pages.
  expect(JSON.stringify(f.call.mock.calls.at(-1)?.[1])).not.toContain(
    "maxRecords",
  );
  f.connect(["one"]);
  // A recent identity check is reused, so the next read does not re-verify.
  const before = f.call.mock.calls.length;
  await f.make().action({ action: "list_bases" });
  expect(f.call.mock.calls.slice(before).map(([name]) => name)).not.toContain(
    "COMPOSIO_SEARCH_TOOLS",
  );
  // Once the check ages out, the account change is caught before acting.
  f.expire();
  await expect(f.make().action({ action: "list_bases" })).rejects.toThrow(
    "account changed",
  );
});
it("profile failures never claim readiness or disclose raw provider errors", async () => {
  const f = fixture();
  f.connect(["one", "two"]);
  await f.make().start();
  f.failProfile();
  await expect(f.make().select("one")).rejects.toThrow(
    "Airtable action failed",
  );
  expect((await f.make().status()).state).toBe("needs_selection");
});
it("expires pending links and rejects writes or injected account overrides", async () => {
  const f = fixture();
  await f.make().start();
  f.expire();
  expect((await f.make().status(true)).state).toBe("expired");
  for (const input of [
    { action: "update_record", recordId: "rec1" },
    { action: "list_bases", account: "foreign" },
  ])
    expect(AirtableActionSchema.safeParse(input).success).toBe(false);
  expect(isAirtableConnectRequest("Can you connect to Airtable?")).toBe(true);
  expect(isAirtableConnectRequest("Do not connect Airtable")).toBe(false);
});

it("schema checks recover successful responses offloaded by Composio", async () => {
  const f = fixture();
  f.connect();
  await f.make().start();
  f.offload();
  expect(await f.make().checkSchema("appExample")).toEqual({
    state: "verified",
    operation: "get_schema",
    tableCount: 1,
    fieldCount: 1,
  });
  expect(
    f.call.mock.calls.some(([name]) => name === "COMPOSIO_REMOTE_WORKBENCH"),
  ).toBe(true);
});
it("retries a transient schema read once, revalidating the pinned identity", async () => {
  const f = fixture();
  f.connect();
  await f.make().start();
  f.offload();
  const original = f.call.getMockImplementation()!;
  let schemaCalls = 0;
  f.call.mockImplementation(async (name, args) => {
    if (
      (JSON.stringify(args.tools) ?? "").includes("AIRTABLE_GET_BASE_SCHEMA") &&
      ++schemaCalls === 1
    )
      throw new DOMException("secret-sentinel", "TimeoutError");
    return original(name, args);
  });
  const result = await f
    .make()
    .action({ action: "get_schema", baseId: "appExample" });
  expect(result.data).toMatchObject({ tables: [{ name: "Leads" }] });
  expect(schemaCalls).toBe(2);
  expect(JSON.stringify(result)).not.toContain("secret-sentinel");
});
it.each([
  [new DOMException("secret-sentinel", "TimeoutError"), 2, "timeout"],
  [new Error("HTTP 503 secret-sentinel"), 2, "temporarily_unavailable"],
  [new Error("HTTP 403 secret-sentinel"), 1, "permission_denied"],
  [new Error("unknown secret-sentinel"), 1, "provider_failure"],
])(
  "bounds retries and preserves a safe phase on failure",
  async (error, attempts, code) => {
    const f = fixture();
    f.connect();
    await f.make().start();
    const original = f.call.getMockImplementation()!;
    let schemaCalls = 0;
    f.call.mockImplementation(async (name, args) => {
      if (
        (JSON.stringify(args.tools) ?? "").includes("AIRTABLE_GET_BASE_SCHEMA")
      ) {
        schemaCalls++;
        throw error;
      }
      return original(name, args);
    });
    const result = await f.make().checkSchema("appExample");
    expect(schemaCalls).toBe(attempts);
    expect(result).toMatchObject({
      state: "failed",
      code,
      diagnostic: { phase: "schema_read" },
    });
    expect(JSON.stringify(result)).not.toContain("secret-sentinel");
  },
);
it("recovers a record page that Composio offloaded and forwards sort and view", async () => {
  const f = fixture();
  f.connect();
  await f.make().start();
  f.offload();
  const result = await f.make().action({
    action: "list_records",
    baseId: "appExample",
    tableId: "tblExample",
    sort: [{ field: "Fit Score", direction: "desc" }],
    view: "Grid view",
    limit: 5,
  });
  expect(result.data).toEqual({
    records: [{ id: "recOffloaded1", fields: { Name: "Big page" } }],
    offset: "offloaded-next",
  });
  const execute = f.call.mock.calls.find(
    ([name, args]) =>
      name === "COMPOSIO_MULTI_EXECUTE_TOOL" &&
      JSON.stringify(args).includes("AIRTABLE_LIST_RECORDS"),
  );
  expect(execute?.[1]).toMatchObject({
    tools: [
      {
        arguments: {
          pageSize: 5,
          sort: [{ field: "Fit Score", direction: "desc" }],
          view: "Grid view",
        },
      },
    ],
  });
  const workbench = f.call.mock.calls.find(
    ([name]) => name === "COMPOSIO_REMOTE_WORKBENCH",
  );
  expect(String(workbench?.[1].code_to_execute)).toContain(
    "AIRTABLE_LIST_RECORDS",
  );
});
it("names a rejected field, keeps the verified identity, projects an inline schema and reports timing", async () => {
  const f = fixture();
  f.connect();
  await f.make().start();
  const schema = await f
    .make()
    .action({ action: "get_schema", baseId: "appExample" });
  expect(schema.data).toEqual({
    tables: [
      {
        id: "tblExample",
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
  });
  expect(Object.keys(schema.timing)).toEqual(["verifyMs", "executeMs"]);
  const before = f.call.mock.calls.length;
  const failure = await f
    .make()
    .action({
      action: "list_records",
      baseId: "appExample",
      tableId: "tblExample",
      fields: ["Ghost"],
      limit: 20,
    })
    .catch((error: unknown) => error);
  expect(airtableErrorCode(failure)).toBe("unknown_field");
  expect(airtableRejectedField(failure)).toBe("Ghost");
  expect(String(failure)).not.toContain("secret-sentinel");
  // The next read reuses the verified session: no search, no profile call.
  await f.make().action({ action: "list_bases" });
  expect(f.call.mock.calls.slice(before).map(([name]) => name)).not.toContain(
    "COMPOSIO_SEARCH_TOOLS",
  );
});
