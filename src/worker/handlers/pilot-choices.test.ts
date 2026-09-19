/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Minimal bindings at an authenticated handler boundary. */
import { beforeEach, expect, it, vi } from "vitest";
import { handlePilotChoicesRequest } from "./pilot-choices";
vi.mock("agents", () => ({ getAgentByName: vi.fn() }));
const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  createPilotChoices: vi.fn(),
  getPilotChoice: vi.fn(),
  selectPilotChoice: vi.fn(),
  savePilotSources: vi.fn(),
}));
vi.mock("../lib/active-agent", () => ({ getActiveAgentStub: mocks.active }));
const env = {} as Cloudflare.Env;
const ticket = "11111111-1111-4111-8111-111111111111";
function request(
  query: string,
  method = "POST",
  origin = "https://downy.test",
) {
  return new Request(`https://downy.test/api/pilot-choices${query}`, {
    method,
    headers: { origin },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.active.mockResolvedValue(mocks);
  mocks.getPilotChoice.mockResolvedValue({
    id: ticket,
    selectedId: "recovery",
  });
});
it("validates source entry without fetching pages or running a task", async () => {
  const urls = ["https://one.test", "https://two.test", "https://three.test"];
  mocks.savePilotSources.mockResolvedValue({
    choice: { sources: { urls } },
    error: null,
  });
  const make = (values: string[]) =>
    new Request(
      `https://downy.test/api/pilot-choices?ticket=${ticket}&sources=1`,
      {
        method: "POST",
        headers: {
          origin: "https://downy.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ urls: values }),
      },
    );
  expect((await handlePilotChoicesRequest(make(urls), env)).status).toBe(200);
  expect(mocks.savePilotSources).toHaveBeenCalledWith(ticket, urls);
  mocks.savePilotSources.mockClear();
  expect(
    (await handlePilotChoicesRequest(make(urls.slice(0, 2)), env)).status,
  ).toBe(400);
  expect(mocks.savePilotSources).not.toHaveBeenCalled();
  expect(mocks.selectPilotChoice).not.toHaveBeenCalled();
  expect(mocks.createPilotChoices).not.toHaveBeenCalled();
});
it("restores a saved choice without composing or selecting", async () => {
  const response = await handlePilotChoicesRequest(
    request(`?ticket=${ticket}`, "GET"),
    env,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    choice: { id: ticket, selectedId: "recovery" },
  });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(mocks.createPilotChoices).not.toHaveBeenCalled();
  expect(mocks.selectPilotChoice).not.toHaveBeenCalled();
});
it("rejects cross-origin writes and unknown options before agent access", async () => {
  expect(
    (
      await handlePilotChoicesRequest(
        request("", "POST", "https://other.test"),
        env,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handlePilotChoicesRequest(
        request(`?ticket=${ticket}&option=run-shell`),
        env,
      )
    ).status,
  ).toBe(400);
  expect(mocks.active).not.toHaveBeenCalled();
});
it("returns the winning choice on a conflicting selection", async () => {
  mocks.selectPilotChoice.mockResolvedValue({
    choice: { selectedId: "recovery" },
    error: "A pilot has already been selected.",
  });
  const response = await handlePilotChoicesRequest(
    request(`?ticket=${ticket}&option=single-page`),
    env,
  );
  expect(response.status).toBe(409);
  expect(mocks.selectPilotChoice).toHaveBeenCalledWith(ticket, "single-page");
  expect(await response.json()).toEqual({
    choice: { selectedId: "recovery" },
    error: "A pilot has already been selected.",
  });
});
it("returns a bounded error on a storage or provider failure", async () => {
  mocks.createPilotChoices.mockRejectedValue(new Error("private-value"));
  const response = await handlePilotChoicesRequest(request(""), env);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private-value");
});
