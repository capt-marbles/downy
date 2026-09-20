import { z } from "zod";
import { expect, it, vi } from "vitest";
import { AirtableConnection, type AirtableStateSchema } from "./airtable";
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
