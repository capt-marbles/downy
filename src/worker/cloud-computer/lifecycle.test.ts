/* eslint-disable typescript/no-unsafe-type-assertion -- bounded Cloudflare test doubles */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  running: false,
  authenticated: false,
  initialized: false,
  restored: false,
  checkpoint: {
    v: 1,
    iv: "a".repeat(16),
    tag: "b".repeat(24),
    ciphertext: "encrypted",
  },
  initializers: [] as Promise<unknown>[],
}));
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      public ctx: DurableObjectState,
      public env: Env,
    ) {}
  },
}));
vi.mock("../credentials/crypto", () => ({
  readSecret: async () => "test-key",
}));
vi.mock("@cloudflare/computer", () => ({
  withWorkspace: (base: unknown) => base,
  getWorkspace: async () => ({
    runtime: {
      exec: async () => {
        runtime.running = true;
        return { result: async () => ({ exitCode: 0 }) };
      },
    },
  }),
}));
vi.mock("@cloudflare/computer/backends/container", () => ({
  CloudflareContainerBackend: vi.fn(),
  withWorkspaceContainer: (base: new (...args: never[]) => object) =>
    class extends base {
      getWorkspaceContainer() {
        return {
          status: async () => ({ running: runtime.running }),
          setInactivityTimeout: async () => {},
          fetchPort: async (_port: number, request: Request) => {
            const path = new URL(request.url).pathname;
            if (path === "/initialize") {
              const body = (await request.json()) as { checkpoint?: unknown };
              if (!runtime.initialized) {
                runtime.authenticated = !!body.checkpoint;
                runtime.restored = !!body.checkpoint;
                runtime.initialized = true;
              }
            }
            if (path === "/account")
              return Response.json({
                authenticated: runtime.authenticated,
                checkpoint: runtime.authenticated ? runtime.checkpoint : null,
              });
            if (path === "/login")
              return Response.json({
                verificationUrl: "https://auth.openai.com/device",
                userCode: "TEST",
              });
            return Response.json({ ready: true });
          },
        };
      }
    },
}));
import { CloudComputer } from "./CloudComputer";
import { AUTH_CHECKPOINT_KEY } from "./auth-checkpoint";

function harness() {
  const saved = new Map<string, unknown>();
  const put = vi.fn(async (key: string, value: unknown) => {
    saved.set(key, value);
  });
  const destroy = vi.fn(async () => {
    runtime.running = false;
    runtime.authenticated = false;
    runtime.initialized = false;
  });
  const ctx = {
    id: { toString: () => "test" },
    storage: {
      get: async (key: string) => saved.get(key),
      put,
      setAlarm: vi.fn(async () => {}),
    },
    container: {
      get running() {
        return runtime.running;
      },
      destroy,
    },
    waitUntil: () => {},
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => {
      const promise = fn();
      runtime.initializers.push(promise);
      return promise;
    },
  } as unknown as DurableObjectState;
  const create = async () => {
    const computer = new CloudComputer(ctx, {
      DOWNY_CODEX_MODEL: "test",
    } as Env);
    await Promise.all(runtime.initializers);
    return computer;
  };
  return { saved, put, destroy, create };
}
const post = (path: string) =>
  new Request(`https://computer.internal/${path}`, { method: "POST" });
beforeEach(() => {
  vi.useFakeTimers();
  runtime.running = false;
  runtime.authenticated = false;
  runtime.initialized = false;
  runtime.restored = false;
  runtime.initializers = [];
});
afterEach(() => vi.useRealTimers());
it("saves a completed login without browser polling and restores it after idle shutdown", async () => {
  const h = harness();
  const computer = await h.create();
  expect((await computer.fetch(post("login"))).status).toBe(200);
  runtime.authenticated = true; // OAuth finishes after the Settings tab closes.
  await computer.alarm();
  expect(h.saved.get(AUTH_CHECKPOINT_KEY)).toEqual(runtime.checkpoint);
  expect(h.destroy).not.toHaveBeenCalled();
  vi.setSystemTime(Date.now() + 16 * 60_000);
  await computer.alarm();
  expect(h.destroy).toHaveBeenCalledOnce();
  const replacement = await h.create();
  expect((await replacement.fetch(post("wake"))).status).toBe(200);
  expect(runtime.restored).toBe(true);
  const status = await (
    await replacement.fetch(new Request("https://computer.internal/status"))
  ).json();
  expect(status).toMatchObject({
    authenticated: true,
    credentialCheckpoint: "present",
  });
  expect(JSON.stringify(status)).not.toContain("ciphertext");
});
it("preserves the running computer if its durable login write fails", async () => {
  const h = harness();
  const computer = await h.create();
  await computer.fetch(post("login"));
  runtime.authenticated = true;
  h.put.mockImplementation(async (key, value) => {
    if (key === AUTH_CHECKPOINT_KEY) throw new Error("Storage failure");
    h.saved.set(key, value);
  });
  vi.setSystemTime(Date.now() + 16 * 60_000);
  await computer.alarm();
  expect(h.destroy).not.toHaveBeenCalled();
  const status = await (
    await computer.fetch(new Request("https://computer.internal/status"))
  ).json();
  expect(status).toMatchObject({
    state: "error",
    authenticated: false,
    credentialCheckpoint: "missing",
  });
});
