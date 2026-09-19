/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Minimal bindings at an authenticated handler boundary. */
import { beforeEach, expect, it, vi } from "vitest";
import { handleResearchViewRequest } from "./research-view";
vi.mock("agents", () => ({ getAgentByName: vi.fn() }));
const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  composeResearchView: vi.fn(),
  getResearchView: vi.fn(),
}));
vi.mock("../lib/active-agent", () => ({ getActiveAgentStub: mocks.active }));
const env = {} as Cloudflare.Env;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.active.mockResolvedValue(mocks);
  mocks.getResearchView.mockResolvedValue({ version: 1, records: [] });
});
it("restores persisted results on repeated GETs without calling Jev", async () => {
  for (let i = 0; i < 2; i++) {
    const response = await handleResearchViewRequest(
      new Request("https://downy.test/api/research-view?agentSlug=buildroom"),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      snapshot: { version: 1, records: [] },
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  }
  expect(mocks.composeResearchView).not.toHaveBeenCalled();
});
it("rejects cross-origin composition before looking up an agent", async () => {
  const response = await handleResearchViewRequest(
    new Request("https://downy.test/api/research-view", {
      method: "POST",
      headers: { origin: "https://other.test" },
    }),
    env,
  );
  expect(response.status).toBe(403);
  expect(mocks.active).not.toHaveBeenCalled();
});
it("only accepts the bounded view choices", async () => {
  const response = await handleResearchViewRequest(
    new Request("https://downy.test/api/research-view?view=arbitrary", {
      method: "POST",
      headers: { origin: "https://downy.test" },
    }),
    env,
  );
  expect(response.status).toBe(400);
  expect(mocks.composeResearchView).not.toHaveBeenCalled();
});
