import { beforeEach, expect, it, vi } from "vitest";
import { testDb } from "../../test/d1";
import { GMAIL_PILOT_TOOLS } from "../../lib/composio";
import { pollComposioSetup, startComposioSetup } from "./setup";
const mocks = vi.hoisted(() => ({
  request:
    vi.fn<
      (
        _key: unknown,
        path: string,
        body?: unknown,
      ) => Promise<Record<string, unknown>>
    >(),
  connect: vi.fn(),
  notify: vi.fn(),
  storeLink: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("./client", async (original) => ({
  ...(await original<object>()),
  composio: mocks.request,
}));
vi.mock("../lib/get-agent", () => ({
  getAgentStub: async () => ({
    connectCredential: mocks.connect,
    notifyComposioConnection: mocks.notify,
    storeComposioLink: mocks.storeLink,
    scheduleComposioSetup: mocks.schedule,
  }),
}));
function environment() {
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return {
    DB: testDb(["0011_composio_connections.sql"]),
    COMPOSIO_API_KEY: "sentinel-project-secret",
  } as unknown as Cloudflare.Env;
}
async function seed(
  env: Cloudflare.Env,
  status = "pending",
  expiresAt = Date.now() + 60_000,
) {
  await env.DB.prepare(
    "INSERT INTO composio_connections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "setup",
      "test",
      "operator",
      "gmail",
      "auth",
      "account",
      null,
      JSON.stringify(GMAIL_PILOT_TOOLS),
      status,
      Date.now(),
      expiresAt,
    )
    .run();
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue({
    state: "ready",
    toolNames: [...GMAIL_PILOT_TOOLS],
    error: null,
  });
});
it("rejects Gmail sending tools before any provider call", async () => {
  await expect(
    startComposioSetup(environment(), "test", "operator", {
      toolkit: "gmail",
      allowedTools: ["GMAIL_SEND_EMAIL"],
    }),
  ).rejects.toThrow("read-only");
  expect(mocks.request).not.toHaveBeenCalled();
});
it("uses hosted OAuth and stores the link outside the transcript", async () => {
  mocks.request.mockImplementation(async (_key, path) => {
    if (path.startsWith("/tools?"))
      return { items: GMAIL_PILOT_TOOLS.map((slug) => ({ slug })) };
    if (path === "/toolkits/gmail")
      return {
        slug: "gmail",
        name: "Gmail",
        composio_managed_auth_schemes: ["OAUTH2"],
      };
    if (path === "/auth_configs") return { auth_config: { id: "auth" } };
    return {
      redirect_url: "https://connect.composio.dev/link/test",
      connected_account_id: "account",
    };
  });
  const result = await startComposioSetup(environment(), "test", "operator", {
    toolkit: "gmail",
    allowedTools: [...GMAIL_PILOT_TOOLS],
  });
  expect(result.kind).toBe("oauth");
  expect(
    mocks.request.mock.calls.find(
      (call) => call[1] === "/connected_accounts/link",
    )?.[2],
  ).toEqual({ auth_config_id: "auth", user_id: "operator" });
  expect(mocks.storeLink).toHaveBeenCalled();
  expect(mocks.schedule).toHaveBeenCalled();
});
it("pins the account, disables all broad execution paths and notifies without secrets", async () => {
  const env = environment();
  await seed(env);
  mocks.request.mockImplementation(async (_key, path) =>
    path.startsWith("/connected_accounts/")
      ? { status: "ACTIVE", credentials: "sentinel-oauth-secret" }
      : {
          session_id: "trs_test",
          mcp: { url: "https://backend.composio.dev/tool_router/trs_test/mcp" },
        },
  );
  const result = await pollComposioSetup(env, "test", "setup", "operator");
  const request = mocks.request.mock.calls.find(
    (call) => call[1] === "/tool_router/session",
  )?.[2];
  expect(request).toMatchObject({
    connected_accounts: { gmail: ["account"] },
    tools: { gmail: { enable: [...GMAIL_PILOT_TOOLS] } },
    workbench: {
      enable: false,
      enable_tool_execution: false,
      enable_proxy_execution: false,
    },
    manage_connections: { enable: false },
    search: { enable: false },
    execute: { enable_multi_execute: false },
  });
  expect(result.state).toBe("ready");
  const observable = JSON.stringify({
    result,
    notifications: mocks.notify.mock.calls,
    db: await env.DB.prepare("SELECT * FROM composio_connections").all(),
  });
  expect(observable).not.toContain("sentinel-");
});
it("only one simultaneous poll attaches tools", async () => {
  const env = environment();
  await seed(env);
  mocks.request.mockImplementation(async (_key, path) =>
    path.startsWith("/connected_accounts/")
      ? { status: "ACTIVE" }
      : {
          session_id: "trs_test",
          mcp: { url: "https://backend.composio.dev/mcp" },
        },
  );
  await Promise.all([
    pollComposioSetup(env, "test", "setup", "operator"),
    pollComposioSetup(env, "test", "setup", "operator"),
  ]);
  expect(mocks.connect).toHaveBeenCalledTimes(1);
});
it("ready connections survive ticket expiry; another user cannot poll them", async () => {
  const env = environment();
  await seed(env, "ready", Date.now() - 1000);
  expect(
    (await pollComposioSetup(env, "test", "setup", "operator")).state,
  ).toBe("ready");
  await expect(
    pollComposioSetup(env, "test", "setup", "intruder"),
  ).rejects.toThrow();
  expect(mocks.request).not.toHaveBeenCalled();
});
it("expired pending connections stop and provider secrets are not echoed on failure", async () => {
  const env = environment();
  await seed(env, "pending", Date.now() - 1000);
  expect(
    (await pollComposioSetup(env, "test", "setup", "operator")).state,
  ).toBe("expired");
  expect(mocks.request).not.toHaveBeenCalled();
  await env.DB.prepare("UPDATE composio_connections SET expires_at = ?")
    .bind(Date.now() + 10000)
    .run();
  mocks.request.mockImplementation(async (_key, path) => {
    if (path.startsWith("/connected_accounts/")) return { status: "ACTIVE" };
    throw new Error("provider echoed sentinel-secret");
  });
  expect(
    JSON.stringify(await pollComposioSetup(env, "test", "setup", "operator")),
  ).not.toContain("sentinel-secret");
});
