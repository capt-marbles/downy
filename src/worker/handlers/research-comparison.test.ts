/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Minimal authenticated handler bindings. */
import { beforeEach, expect, it, vi } from "vitest";
import { handleResearchComparisonRequest } from "./research-comparison";
vi.mock("agents", () => ({ getAgentByName: vi.fn() }));
const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  getComparison: vi.fn(),
  startComparison: vi.fn(),
  recordComparisonFeedback: vi.fn(),
}));
vi.mock("../lib/active-agent", () => ({ getActiveAgentStub: mocks.active }));
const env = {} as Cloudflare.Env;
const ticket = "11111111-1111-4111-8111-111111111111";
function request(
  op: string,
  method = "POST",
  origin = "https://downy.test",
  body?: unknown,
) {
  return new Request(
    `https://downy.test/api/research-comparison?ticket=${ticket}&op=${op}`,
    {
      method,
      headers: { origin, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.active.mockResolvedValue(mocks);
  mocks.getComparison.mockResolvedValue(null);
});
it("rejects cross-origin start before looking up an agent", async () => {
  expect(
    (
      await handleResearchComparisonRequest(
        request("start", "POST", "https://bad.test"),
        env,
      )
    ).status,
  ).toBe(403);
  expect(mocks.active).not.toHaveBeenCalled();
});
it("reading status never starts model or browser work", async () => {
  const response = await handleResearchComparisonRequest(
    request("", "GET"),
    env,
  );
  expect(await response.json()).toEqual({ run: null });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(mocks.startComparison).not.toHaveBeenCalled();
});
it("requires explicit start and forwards the ticket", async () => {
  expect(
    (await handleResearchComparisonRequest(request("start"), env)).status,
  ).toBe(200);
  expect(mocks.startComparison).toHaveBeenCalledWith(ticket);
});
it("feedback identifies its immutable run and cannot submit model evidence", async () => {
  const body = {
    id: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    findingIndex: 0,
    verdict: "unsupported",
    note: "Wrong scope",
  };
  expect(
    (
      await handleResearchComparisonRequest(
        request("feedback", "POST", "https://downy.test", body),
        env,
      )
    ).status,
  ).toBe(200);
  expect(mocks.recordComparisonFeedback).toHaveBeenCalledWith(
    ticket,
    body.runId,
    expect.objectContaining(body),
  );
  mocks.recordComparisonFeedback.mockClear();
  expect(
    (
      await handleResearchComparisonRequest(
        request("feedback", "POST", "https://downy.test", {
          ...body,
          checks: [],
        }),
        env,
      )
    ).status,
  ).toBe(400);
  expect(mocks.recordComparisonFeedback).not.toHaveBeenCalled();
});
it("does not expose provider errors", async () => {
  mocks.startComparison.mockRejectedValue(new Error("private-provider-data"));
  const response = await handleResearchComparisonRequest(request("start"), env);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private-provider-data");
});
