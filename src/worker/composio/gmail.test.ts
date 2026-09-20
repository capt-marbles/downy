import { z } from "zod";
import { expect, it, vi } from "vitest";
import { GmailConnection, type GmailState } from "./gmail";
import {
  GmailActionSchema,
  isGmailConnectRequest,
} from "../../lib/gmail-connect";

const envelope = (data: unknown) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        successful: true,
        data,
        ignored_credential: "sentinel-secret",
      }),
    },
  ],
});
function fixture() {
  let saved: GmailState | undefined;
  let now = 100_000;
  let connected = false;
  let accountId = "account-one";
  let accounts:
    | {
        id: string;
        status: string;
        is_default: boolean;
        user_info: { email: string };
      }[]
    | undefined;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const call = vi.fn(
    async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      calls.push({ name, args });
      if (name === "COMPOSIO_SEARCH_TOOLS")
        return envelope({
          session: { id: "session" },
          toolkit_connection_statuses: [
            {
              toolkit: "gmail",
              has_active_connection: connected,
              connection_details: connected
                ? accounts
                  ? null
                  : { connected_account_id: accountId }
                : null,
              ...(accounts ? { accounts, account_selection: "required" } : {}),
            },
          ],
        });
      if (name === "COMPOSIO_MANAGE_CONNECTIONS")
        return envelope({
          results: {
            gmail: {
              toolkit: "gmail",
              status: "initiated",
              connected_account_id: accountId,
              redirect_url: "https://connect.composio.dev/link/secure",
            },
          },
        });
      const execution = args.tools;
      const slug = z
        .array(z.object({ tool_slug: z.string() }))
        .parse(execution)[0].tool_slug;
      return envelope({
        results: [
          {
            tool_slug: slug,
            response: {
              successful: true,
              data:
                slug === "GMAIL_GET_PROFILE"
                  ? { emailAddress: "owner@example.com" }
                  : { id: "draft-1", message: { id: "message-1" } },
            },
          },
        ],
      });
    },
  );
  const make = () =>
    new GmailConnection(
      call,
      async () => saved,
      async (state) => {
        saved = structuredClone(state);
      },
      () => now,
    );
  return {
    make,
    call,
    calls,
    connect: () => {
      connected = true;
    },
    multipleAccounts: () => {
      connected = true;
      accounts = [
        {
          id: "account-one",
          status: "ACTIVE",
          is_default: true,
          user_info: { email: "owner@example.com" },
        },
        {
          id: "account-two",
          status: "ACTIVE",
          is_default: false,
          user_info: { email: "second@example.com" },
        },
      ];
    },
    forgetPendingId: () => {
      if (saved) delete saved.accountId;
    },
    duplicateEmail: () => {
      if (accounts) accounts[1].user_info.email = accounts[0].user_info.email;
    },
    changeAccount: () => {
      accountId = "different-account";
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}
it("viewing a card only checks status; it never starts OAuth or enables an existing account", async () => {
  const f = fixture();
  f.connect();
  const status = await f.make().status(true);
  expect(status.state).toBe("not_connected");
  expect(status.authorized).toBe(false);
  expect(f.calls.map((c) => c.name)).toEqual(["COMPOSIO_SEARCH_TOOLS"]);
  expect(JSON.stringify(status)).not.toContain("sentinel-secret");
});
it("post-consent discovery with multiple accounts shows a choice instead of failing or guessing the default", async () => {
  const f = fixture();
  await f.make().start();
  f.forgetPendingId();
  f.multipleAccounts();
  f.advance(11_000);
  const status = await f.make().status(true);
  expect(status).toMatchObject({
    state: "needs_selection",
    email: null,
    accounts: [
      { id: "account-one", label: "owner@example.com" },
      { id: "account-two", label: "second@example.com" },
    ],
  });
  expect(
    f.calls.filter((c) => c.name === "COMPOSIO_MULTI_EXECUTE_TOOL"),
  ).toHaveLength(0);
  await expect(f.make().select("not-this-users-account")).rejects.toThrow(
    "unavailable",
  );
  expect(
    f.calls.filter((c) => c.name === "COMPOSIO_MULTI_EXECUTE_TOOL"),
  ).toHaveLength(0);
  await f.make().select("account-one");
  expect((await f.make().status()).state).toBe("ready");
  await f.make().action({ action: "search", query: "in:drafts", limit: 1 });
  expect(
    f.calls
      .filter((c) => c.name === "COMPOSIO_MULTI_EXECUTE_TOOL")
      .every(
        (c) =>
          z
            .array(z.object({ account: z.literal("account-one") }))
            .safeParse(c.args.tools).success,
      ),
  ).toBe(true);
  // Once explicitly selected, a second account never dislodges the pin.
  f.advance(16 * 60_000);
  expect((await f.make().status(true)).state).toBe("ready");
  expect(
    f.calls.filter((c) => c.name === "COMPOSIO_MANAGE_CONNECTIONS"),
  ).toHaveLength(1);
});
it("selecting an account only marks it ready after profile verification succeeds", async () => {
  const f = fixture();
  f.multipleAccounts();
  await f.make().start();
  const original = f.call.getMockImplementation()!;
  f.call.mockImplementation(async (name, args) =>
    name === "COMPOSIO_MULTI_EXECUTE_TOOL"
      ? envelope({
          results: [
            {
              tool_slug: "GMAIL_GET_PROFILE",
              error: "private-provider-error",
              response: null,
            },
          ],
        })
      : original(name, args),
  );
  await expect(f.make().select("account-one")).rejects.toThrow(
    "Gmail action failed",
  );
  expect((await f.make().status()).state).toBe("needs_selection");
});
it("distinguishes duplicate connections for the same mailbox without selecting either", async () => {
  const f = fixture();
  f.multipleAccounts();
  f.duplicateEmail();
  await f.make().start();
  const status = await f.make().status();
  expect(status.state).toBe("needs_selection");
  expect(new Set(status.accounts?.map((account) => account.label)).size).toBe(
    2,
  );
  expect(status.accounts?.[0].label).toContain("Composio default");
  expect(
    f.calls.some((call) => call.name === "COMPOSIO_MULTI_EXECUTE_TOOL"),
  ).toBe(false);
});
it("clicking Connect starts Gmail OAuth once and resumes the same pending link", async () => {
  const f = fixture();
  const first = await f.make().start();
  expect(first.redirectUrl).toBe("https://connect.composio.dev/link/secure");
  expect(await f.make().start()).toEqual(first);
  expect(
    f.calls.filter((c) => c.name === "COMPOSIO_MANAGE_CONNECTIONS"),
  ).toHaveLength(1);
  expect(f.calls[1].args).toEqual({
    toolkits: ["gmail"],
    reinitiate_all: false,
    session_id: "session",
  });
  expect((await f.make().status()).state).toBe("pending");
});
it("a completed connection is checked against its account profile and only then becomes ready", async () => {
  const f = fixture();
  await f.make().start();
  f.connect();
  f.advance(11_000);
  const status = await f.make().status(true);
  expect(status).toMatchObject({ state: "ready", email: "owner@example.com" });
  expect(JSON.stringify(status)).not.toMatch(
    /sentinel-secret|redirect_url|secure/,
  );
});
it("draft creation cannot send or switch mailboxes and uses the verified account", async () => {
  const f = fixture();
  f.connect();
  await f.make().start();
  const draft = await f.make().action({
    action: "create_draft",
    recipientEmail: "recipient@example.com",
    subject: "Hello",
    body: "Draft only",
  });
  expect(draft).toMatchObject({
    state: "draft_created",
    sent: false,
    draftId: "draft-1",
  });
  expect(f.calls.at(-1)?.args).toMatchObject({
    tools: [
      {
        tool_slug: "GMAIL_CREATE_EMAIL_DRAFT",
        arguments: {
          user_id: "me",
          recipient_email: "recipient@example.com",
          is_html: false,
        },
      },
    ],
    sync_response_to_workbench: false,
  });
  expect(
    GmailActionSchema.safeParse({ action: "send", body: "no" }).success,
  ).toBe(false);
  expect(
    GmailActionSchema.safeParse({
      action: "read",
      messageId: "1",
      user_id: "someone-else",
    }).success,
  ).toBe(false);
  f.changeAccount();
  await expect(
    f.make().action({ action: "search", query: "", limit: 10 }),
  ).rejects.toThrow("account changed");
  expect(f.calls.at(-1)?.name).toBe("COMPOSIO_SEARCH_TOOLS");
});
it("rejects unexpected auth hosts and expires a pending authorization", async () => {
  const f = fixture();
  await f.make().start();
  f.advance(16 * 60_000);
  expect((await f.make().status(true)).state).toBe("expired");
  f.call.mockResolvedValueOnce(
    envelope({
      session: { id: "session" },
      toolkit_connection_statuses: [
        {
          toolkit: "gmail",
          has_active_connection: false,
          connection_details: {},
        },
      ],
    }),
  );
  f.call.mockResolvedValueOnce(
    envelope({
      results: {
        gmail: {
          toolkit: "gmail",
          status: "initiated",
          redirect_url: "https://attacker.example/link",
        },
      },
    }),
  );
  await expect(f.make().start()).rejects.toThrow(
    "Unexpected authorization host",
  );
});
it("recognizes the reported connection request without confusing email work for setup", () => {
  expect(
    isGmailConnectRequest(
      "Connect my Gmail so you can read emails and create drafts for me to send.",
    ),
  ).toBe(true);
  expect(isGmailConnectRequest("Please reconnect Gmail")).toBe(true);
  expect(isGmailConnectRequest("Draft an email about connecting Gmail")).toBe(
    false,
  );
  expect(isGmailConnectRequest("Do not connect Gmail")).toBe(false);
});
