/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Minimal bindings at an authenticated handler boundary. */
import { beforeEach, expect, it, vi } from "vitest";
import { handleStagedActionsRequest } from "./staged-actions";
vi.mock("agents", () => ({ getAgentByName: vi.fn() }));
const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  getStagedAction: vi.fn(),
  confirmStagedAction: vi.fn(),
  cancelStagedAction: vi.fn(),
}));
vi.mock("../lib/active-agent", () => ({ getActiveAgentStub: mocks.active }));
const env = {} as Cloudflare.Env;
const id = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
function request(
  query: string,
  init: RequestInit & { origin?: string | null } = {},
) {
  const { origin = "https://downy.test", ...rest } = init;
  return new Request(`https://downy.test/api/staged-actions${query}`, {
    ...rest,
    headers: {
      ...(origin ? { origin } : {}),
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.active.mockResolvedValue(mocks);
  mocks.getStagedAction.mockResolvedValue({ id, state: "proposed" });
  mocks.confirmStagedAction.mockResolvedValue({
    action: { id, state: "succeeded" },
    error: null,
  });
  mocks.cancelStagedAction.mockResolvedValue({
    action: { id, state: "cancelled" },
    error: null,
  });
});

it("confirms only with a same-origin POST quoting the shown revision", async () => {
  const ok = await handleStagedActionsRequest(
    request(`?id=${id}&confirm=1`, {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
    env,
  );
  expect(ok.status).toBe(200);
  expect(mocks.confirmStagedAction).toHaveBeenCalledWith(id, revision);
  mocks.confirmStagedAction.mockClear();
  for (const bad of [
    request(`?id=${id}&confirm=1`, {
      method: "POST",
      body: JSON.stringify({ revision }),
      origin: "https://evil.test",
    }),
    request(`?id=${id}&confirm=1`, { method: "POST" }),
    request(`?id=${id}&confirm=1`, {
      method: "POST",
      body: JSON.stringify({ revision: "not-a-uuid" }),
    }),
    request(`?id=${id}&confirm=1&cancel=1`, {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
    request(`?id=${id}`, { method: "POST" }),
    request(`?id=nope&confirm=1`, {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
    request(`?id=${id}&confirm=1`, { method: "GET" }),
  ]) {
    const response = await handleStagedActionsRequest(bad, env);
    expect([400, 403]).toContain(response.status);
  }
  expect(mocks.confirmStagedAction).not.toHaveBeenCalled();
  expect(mocks.cancelStagedAction).not.toHaveBeenCalled();
});

it("returns a conflict with the current proposal when the decision is rejected", async () => {
  mocks.confirmStagedAction.mockResolvedValue({
    action: { id, state: "proposed", revision: "other" },
    error: "This proposal changed since it was shown.",
  });
  const response = await handleStagedActionsRequest(
    request(`?id=${id}&confirm=1`, {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
    env,
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    action: { state: "proposed" },
    error: expect.stringContaining("changed"),
  });
});

it("reads and cancels through the same active-agent checks", async () => {
  const read = await handleStagedActionsRequest(request(`?id=${id}`), env);
  expect(read.status).toBe(200);
  expect(read.headers.get("Cache-Control")).toBe("private, no-store");
  mocks.getStagedAction.mockResolvedValue(null);
  expect(
    (await handleStagedActionsRequest(request(`?id=${id}`), env)).status,
  ).toBe(404);
  const cancel = await handleStagedActionsRequest(
    request(`?id=${id}&cancel=1`, { method: "POST" }),
    env,
  );
  expect(cancel.status).toBe(200);
  expect(mocks.cancelStagedAction).toHaveBeenCalledWith(id);
  expect(mocks.confirmStagedAction).not.toHaveBeenCalled();
});
