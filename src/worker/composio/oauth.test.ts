import { z } from "zod";
import { expect, it, vi } from "vitest";
import { ComposioOAuth } from "./oauth";

const methodSchema = z.object({ method: z.string() });
const urlText = (input: Parameters<typeof fetch>[0]) =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
const bodyText = (body: RequestInit["body"]) =>
  typeof body === "string"
    ? body
    : body instanceof URLSearchParams
      ? body.toString()
      : "";
const ISSUER = "https://connect.composio.dev";
const RESOURCE = `${ISSUER}/mcp`;
const SECRET = btoa("k".repeat(32));
function fixture(sse = false) {
  const records = new Map<string, unknown>();
  const store = {
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    get: async <T>(key: string) => records.get(key) as T | undefined,
    put: async (key: string, value: unknown) => {
      records.set(key, value);
    },
    delete: async (key: string) => records.delete(key),
  };
  let time = 1_000_000;
  let rotate = 0;
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = urlText(input);
    if (url.endsWith("oauth-protected-resource"))
      return Response.json({
        resource: RESOURCE,
        authorization_servers: [ISSUER],
      });
    if (url.endsWith("oauth-authorization-server"))
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        registration_endpoint: "https://login.composio.dev/oauth2/register",
        token_endpoint: "https://login.composio.dev/oauth2/token",
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (url.endsWith("/register"))
      return Response.json({ client_id: "downy-test" });
    if (url.endsWith("/token")) {
      rotate++;
      return Response.json({
        access_token: `secret-access-${rotate}`,
        refresh_token: `secret-refresh-${rotate}`,
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    const body = methodSchema.parse(JSON.parse(bodyText(init?.body)));
    if (body.method === "notifications/initialized")
      return new Response(null, { status: 202 });
    const result =
      body.method === "initialize"
        ? { protocolVersion: "2025-03-26" }
        : { tools: [{ name: "COMPOSIO_SEARCH_TOOLS" }] };
    return sse
      ? new Response(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result })}\n\n`,
          {
            headers: {
              "content-type": "text/event-stream",
              "mcp-session-id": "session",
            },
          },
        )
      : Response.json(
          { jsonrpc: "2.0", id: 1, result },
          { headers: { "mcp-session-id": "session" } },
        );
  });
  const make = (owner = "user-one") =>
    new ComposioOAuth(store, SECRET, owner, request, () => time);
  return {
    make,
    store,
    records,
    request,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

it.each([false, true])(
  "completes PKCE OAuth and verifies MCP (%s SSE) without returning or persisting plaintext credentials",
  async (sse) => {
    const f = fixture(sse);
    const oauth = f.make();
    const url = new URL(await oauth.start("https://downy.example", "gtm"));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource")).toBe(RESOURCE);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://downy.example/api/composio/oauth/callback",
    );
    const outcome = await oauth.complete(
      url.searchParams.get("state")!,
      "secret-code",
      false,
    );
    expect(outcome).toEqual({ agentSlug: "gtm", state: "connected" });
    const tokenCall = f.request.mock.calls.find(([input]) =>
      urlText(input).endsWith("/token"),
    )!;
    const parameters = new URLSearchParams(bodyText(tokenCall[1]?.body));
    const challenge = Buffer.from(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(parameters.get("code_verifier")!),
      ),
    ).toString("base64url");
    expect(challenge).toBe(url.searchParams.get("code_challenge"));
    const safe = JSON.stringify([
      outcome,
      await oauth.status(),
      [...f.records.values()],
    ]);
    for (const secret of [
      "secret-code",
      "secret-access-1",
      "secret-refresh-1",
      parameters.get("code_verifier")!,
    ])
      expect(safe).not.toContain(secret);
    const mcp = f.request.mock.calls.filter(
      ([input]) => urlText(input) === RESOURCE,
    );
    expect(
      mcp.map(
        ([, init]) =>
          methodSchema.parse(JSON.parse(bodyText(init?.body))).method,
      ),
    ).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(new Headers(mcp[1][1]?.headers).get("mcp-session-id")).toBe(
      "session",
    );
    // Durable storage survives construction of a new service instance.
    expect((await f.make().status()).state).toBe("connected");
  },
);
it("the encrypted OAuth vault discovers toolkits and preserves both app states without exposing credentials", async () => {
  const f = fixture();
  const url = new URL(await f.make().start("https://downy.example", "gtm"));
  await f.make().complete(url.searchParams.get("state")!, "secret-code", false);
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (input, init) => {
    if (urlText(input) === RESOURCE) {
      const body = z
        .object({
          method: z.string(),
          params: z
            .object({
              name: z.string(),
              arguments: z.object({
                queries: z.array(z.object({ use_case: z.string() })),
              }),
            })
            .optional(),
        })
        .safeParse(JSON.parse(bodyText(init?.body)));
      if (
        body.success &&
        body.data.method === "tools/call" &&
        body.data.params?.name === "COMPOSIO_SEARCH_TOOLS"
      ) {
        const toolkit = body.data.params.arguments.queries[0].use_case
          .toLowerCase()
          .includes("gmail")
          ? "gmail"
          : "airtable";
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              successful: true,
              data: {
                session: { id: `${toolkit}-session` },
                toolkit_connection_statuses: [
                  {
                    toolkit,
                    has_active_connection: false,
                    connection_details: null,
                  },
                ],
                private_token: "never-return-this",
              },
            },
          },
        });
      }
    }
    return original(input, init);
  });
  expect(await f.make().discoverSetup("Airtable")).toEqual([
    {
      name: "airtable",
      toolkit: "airtable",
      path: "composio",
      confidence: "confirmed",
    },
  ]);
  expect((await f.make().airtableStatus(true)).state).toBe("not_connected");
  expect((await f.make().gmailStatus(true)).state).toBe("not_connected");
  expect((await f.make().airtableStatus()).checkedAt).not.toBeNull();
  const persisted = JSON.stringify([...f.records.values()]);
  expect(persisted).not.toMatch(
    /secret-access|secret-refresh|airtable-session|gmail-session|never-return-this/,
  );
});

it("rejects wrong state, expired callbacks and replay without exchanging a code", async () => {
  const f = fixture();
  const oauth = f.make();
  const url = new URL(await oauth.start("https://downy.example", "gtm"));
  await expect(oauth.complete("wrong", "secret", false)).rejects.toThrow(
    "invalid or expired",
  );
  expect(
    f.request.mock.calls.filter(([input]) => urlText(input).endsWith("/token")),
  ).toHaveLength(0);
  await oauth.complete(url.searchParams.get("state")!, "secret", false);
  await expect(
    oauth.complete(url.searchParams.get("state")!, "secret", false),
  ).rejects.toThrow();
  expect(
    f.request.mock.calls.filter(([input]) => urlText(input).endsWith("/token")),
  ).toHaveLength(1);
  const next = new URL(await oauth.start("https://downy.example", "gtm"));
  f.advance(16 * 60_000);
  await expect(
    oauth.complete(next.searchParams.get("state")!, "secret", false),
  ).rejects.toThrow();
  expect((await oauth.status()).state).toBe("expired");
});

it("resumes duplicate starts and cannot decrypt another user's vault", async () => {
  const f = fixture();
  const first = await f.make().start("https://downy.example", "gtm");
  expect(await f.make().start("https://downy.example", "gtm")).toBe(first);
  expect(
    f.request.mock.calls.filter(([input]) =>
      urlText(input).endsWith("/register"),
    ),
  ).toHaveLength(1);
  await expect(f.make("user-two").status()).rejects.toThrow();
});

it("refreshes and persists rotating tokens across restarts; a rejected refresh asks for reconnect", async () => {
  const f = fixture();
  const oauth = f.make();
  const url = new URL(await oauth.start("https://downy.example", "gtm"));
  await oauth.complete(url.searchParams.get("state")!, "code", false);
  f.advance(3_550_000);
  expect((await f.make().status()).state).toBe("connected");
  f.advance(3_550_000);
  expect((await f.make().status()).state).toBe("connected");
  const calls = f.request.mock.calls.filter(([input]) =>
    urlText(input).endsWith("/token"),
  );
  expect(
    new URLSearchParams(bodyText(calls[2][1]?.body)).get("refresh_token"),
  ).toBe("secret-refresh-2");
  f.advance(3_550_000);
  f.request.mockRejectedValueOnce(
    new Error("provider printed secret-access-3"),
  );
  const status = await f.make().status();
  expect(status.state).toBe("needs_reconnect");
  expect(JSON.stringify(status)).not.toContain("secret");
});

it("denied consent does not exchange tokens and disconnect erases the encrypted session", async () => {
  const f = fixture();
  const oauth = f.make();
  const url = new URL(await oauth.start("https://downy.example", "gtm"));
  expect(
    (await oauth.complete(url.searchParams.get("state")!, null, true)).state,
  ).toBe("failed");
  expect(
    f.request.mock.calls.filter(([input]) => urlText(input).endsWith("/token")),
  ).toHaveLength(0);
  await oauth.disconnect();
  expect(f.records.size).toBe(0);
  expect((await oauth.status()).state).toBe("disconnected");
});

it("calls the native Workers fetch without using the service as its receiver", async () => {
  const f = fixture();
  vi.stubGlobal(
    "fetch",
    function (this: unknown, ...args: Parameters<typeof fetch>) {
      if (this !== undefined && this !== globalThis)
        throw new TypeError("Illegal invocation");
      return f.request(...args);
    },
  );
  try {
    const oauth = new ComposioOAuth(f.store, SECRET, "user");
    expect(
      new URL(await oauth.start("https://downy.example", "gtm")).host,
    ).toBe("connect.composio.dev");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("logs only a fixed phase and error category when the provider throws sensitive text", async () => {
  const f = fixture();
  f.request.mockRejectedValueOnce(new Error("secret-provider-value"));
  const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    await expect(
      f.make().start("https://downy.example", "gtm"),
    ).rejects.toThrow("Composio OAuth setup failed");
    expect(log).toHaveBeenCalledWith("Composio OAuth setup failed", {
      stage: "resource-discovery",
      type: "request",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "secret-provider-value",
    );
  } finally {
    log.mockRestore();
  }
});

it("rejects provider redirects without following them", async () => {
  const f = fixture();
  f.request.mockResolvedValueOnce(
    new Response(null, {
      status: 302,
      headers: { Location: "https://untrusted.example" },
    }),
  );
  const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    await expect(
      f.make().start("https://downy.example", "gtm"),
    ).rejects.toThrow();
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.request.mock.calls[0][1]?.redirect).toBe("manual");
  } finally {
    log.mockRestore();
  }
});
