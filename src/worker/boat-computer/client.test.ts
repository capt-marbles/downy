/* eslint-disable typescript/no-unsafe-type-assertion -- bounded test Env */
import { afterEach, expect, it, vi } from "vitest";
import { BoatClient } from "./client";

const env = {
  BOAT_SANDBOX_ID: "bx_23456789",
  BOAT_API_KEY: "boat-account-secret",
  BOAT_BRIDGE_TOKEN: "bridge-secret",
} as unknown as Env;
afterEach(() => vi.unstubAllGlobals());

it("scopes lifecycle calls to the fixed pilot, never sends credentials in bodies, and refuses forced stop", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ ok: true });
  });
  const client = new BoatClient(env);
  await client.resume();
  await client.stop();
  expect(calls.map((c) => c.url)).toEqual([
    "https://boat.dev/api/v1/sandboxes/bx_23456789/resume",
    "https://boat.dev/api/v1/sandboxes/bx_23456789/stop",
  ]);
  expect(calls[0].init.body).toBe('{"ttlSeconds":7200,"noEnv":true}');
  expect(calls[1].init.body).toBe('{"force":false}');
  expect(calls[0].init.redirect).toBe("error");
});

it("rejects mismatched sandbox identity and untrusted/public bridge addresses", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ sandbox: { id: "bx_abcdefgh", state: "ready" } }),
    )
    .mockResolvedValueOnce(
      Response.json({ url: "https://evil.test/", isProtected: true }),
    )
    .mockResolvedValueOnce(
      Response.json({ url: "https://pilot.on.boat.dev/", isProtected: false }),
    );
  vi.stubGlobal("fetch", fetcher);
  const client = new BoatClient(env);
  await expect(client.info()).rejects.toThrow("identity mismatch");
  await expect(client.endpoint()).rejects.toThrow("Unexpected Boat");
  await expect(client.endpoint()).rejects.toThrow();
});

it("keeps the private port token while forwarding only the bridge credential", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ready: true }));
  vi.stubGlobal("fetch", fetcher);
  await new BoatClient(env).bridge(
    "https://pilot.on.boat.dev/?_token=port-secret",
    "/initialize",
    { key: "encryption-secret" },
  );
  const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
  expect(url.pathname).toBe("/initialize");
  expect(url.searchParams.get("_token")).toBe("port-secret");
  expect(new Headers(init.headers).get("Authorization")).toBe(
    "Bearer bridge-secret",
  );
  expect(JSON.stringify(init)).not.toContain("boat-account-secret");
  expect(init.redirect).toBe("error");
});

it("does not reflect provider error bodies containing credentials", async () => {
  vi.stubGlobal(
    "fetch",
    async () => new Response("secret-provider-payload", { status: 403 }),
  );
  await expect(new BoatClient(env).info()).rejects.toThrow(
    "Boat control request failed (403)",
  );
});
