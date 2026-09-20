import { beforeEach, expect, it, vi } from "vitest";
import { handleComposioOAuthRequest } from "./composio-oauth";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  stub: vi.fn(),
  active: vi.fn(),
  getAgent: vi.fn(),
  start: vi.fn(),
  complete: vi.fn(),
  status: vi.fn(),
  card: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("../auth/cloudflare-access", () => ({
  verifyAccessJwt: mocks.identity,
}));
vi.mock("../lib/active-agent", () => ({ getActiveAgentStub: mocks.active }));
vi.mock("../lib/get-agent", () => ({
  slugFromRequest: (request: Request) =>
    new URL(request.url).searchParams.get("agentSlug"),
  getAgentStub: mocks.stub,
}));
vi.mock("../db/profile", () => ({ getAgent: mocks.getAgent }));
// eslint-disable-next-line typescript/no-unsafe-type-assertion
const env = {} as Cloudflare.Env;
const request = (
  path: string,
  method = "GET",
  origin = "https://downy.example",
) =>
  new Request(`https://downy.example/api/composio/oauth${path}`, {
    method,
    headers: { origin },
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ ok: true, sub: "one" });
  mocks.stub.mockResolvedValue({
    startComposioOAuth: mocks.start,
    completeComposioOAuth: mocks.complete,
    getComposioOAuthStatus: mocks.status,
    disconnectComposioOAuth: mocks.disconnect,
    showComposioConnectCard: mocks.card,
  });
  mocks.active.mockResolvedValue({ showComposioConnectCard: mocks.card });
  mocks.getAgent.mockResolvedValue({ archivedAt: null });
});
it("requires same-origin POST and verified Access identity before reaching the vault", async () => {
  expect(
    (
      await handleComposioOAuthRequest(
        request("/start?agentSlug=gtm", "POST", "https://evil.example"),
        env,
      )
    ).status,
  ).toBe(403);
  mocks.identity.mockResolvedValue({ ok: false });
  expect((await handleComposioOAuthRequest(request(""), env)).status).toBe(401);
  expect(mocks.stub).not.toHaveBeenCalled();
});
it("uses a native OAuth redirect and shared user scope rather than the currently selected bot", async () => {
  mocks.start.mockResolvedValue(
    "https://connect.composio.dev/oauth/authorize?state=random",
  );
  const result = await handleComposioOAuthRequest(
    request("/start?agentSlug=gtm", "POST"),
    env,
  );
  expect(result.status).toBe(303);
  expect(result.headers.get("location")).toContain(
    "https://connect.composio.dev/oauth/authorize",
  );
  expect(mocks.start).toHaveBeenCalledWith("https://downy.example", "gtm");
  const first: unknown = mocks.stub.mock.calls[0][1];
  await handleComposioOAuthRequest(request("?agentSlug=another"), env);
  expect(mocks.stub.mock.calls[1][1]).toBe(first);
  mocks.identity.mockResolvedValue({ ok: true, sub: "two" });
  await handleComposioOAuthRequest(request(""), env);
  expect(mocks.stub.mock.calls[2][1]).not.toBe(first);
});
it("callback sends only a fixed outcome to chat and immediately removes code from the URL", async () => {
  mocks.complete.mockResolvedValue({ agentSlug: "gtm", state: "connected" });
  const result = await handleComposioOAuthRequest(
    request("/callback?state=random&code=secret-code"),
    env,
  );
  expect(result.headers.get("location")).toBe("/agent/gtm");
  expect(result.headers.get("referrer-policy")).toBe("no-referrer");
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.card).toHaveBeenCalledWith("connected");
  expect(JSON.stringify(mocks.card.mock.calls)).not.toContain("secret-code");
  expect(await result.text()).not.toContain("secret-code");
});
it("does not echo provider errors or expired callback details", async () => {
  mocks.complete.mockRejectedValue(new Error("secret-token"));
  const result = await handleComposioOAuthRequest(
    request("/callback?state=random&code=secret-code"),
    env,
  );
  expect(result.headers.get("location")).toBe("/settings");
  expect(await result.text()).not.toContain("secret");
  expect(mocks.card).not.toHaveBeenCalled();
});
