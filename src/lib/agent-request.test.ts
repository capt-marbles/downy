import { afterEach, expect, it, vi } from "vitest";
import { agentFetch } from "./agent-request";
import { slugFromRequest } from "../worker/lib/get-agent";
vi.mock("agents", () => ({ getAgentByName: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it("keeps concurrent agent scopes distinct and preserves query parameters and request options", async () => {
  const fetcher = vi.fn(async () => Response.json({}));
  vi.stubGlobal("fetch", fetcher);
  const abort = new AbortController();
  const options = {
    method: "POST",
    body: "payload",
    keepalive: true,
    signal: abort.signal,
    headers: { "content-type": "application/json" },
  };
  await Promise.all([
    agentFetch("research", "/api/composio?toolkit=test", options),
    agentFetch("campaign", "/api/composio?toolkit=test", options),
  ]);
  expect(fetcher).toHaveBeenNthCalledWith(
    1,
    "/api/composio?toolkit=test&agentSlug=research",
    {
      ...options,
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-agent-slug": "research",
      },
    },
  );
  expect(fetcher).toHaveBeenNthCalledWith(
    2,
    "/api/composio?toolkit=test&agentSlug=campaign",
    {
      ...options,
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-agent-slug": "campaign",
      },
    },
  );
  expect(options.headers).toEqual({ "content-type": "application/json" });
});

it.each([
  "https://other.test/api/credentials",
  "//other.test/api/credentials",
  "/outside-api",
])("does not forward agent requests outside the local API: %s", (path) => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(() =>
    agentFetch("research", path, { body: "private", method: "POST" }),
  ).toThrow("local API");
  expect(fetcher).not.toHaveBeenCalled();
});

it("resolves URL scope without a header and preserves legacy header callers", () => {
  expect(
    slugFromRequest(
      new Request("https://downy.test/api/skills?agentSlug=research"),
    ),
  ).toBe("research");
  expect(
    slugFromRequest(
      new Request("https://downy.test/api/skills", {
        headers: { "X-Agent-Slug": "research" },
      }),
    ),
  ).toBe("research");
});

it.each([
  "",
  "?agentSlug=",
  "?agentSlug=../bad",
  "?agentSlug=research&agentSlug=campaign",
])("rejects absent or ambiguous scope: %s", (query) => {
  expect(() =>
    slugFromRequest(new Request(`https://downy.test/api/skills${query}`)),
  ).toThrow("explicit valid agent");
});
it("rejects conflicting URL and header scopes", () => {
  expect(() =>
    slugFromRequest(
      new Request("https://downy.test/api/skills?agentSlug=research", {
        headers: { "X-Agent-Slug": "campaign" },
      }),
    ),
  ).toThrow("disagree");
});
