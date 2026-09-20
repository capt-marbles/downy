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
                ? { connected_account_id: accountId }
                : null,
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
