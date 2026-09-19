/* eslint-disable typescript/no-unsafe-type-assertion -- bounded DO and Env test doubles */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  state: "ready",
  authenticated: false,
  initializers: [] as Promise<unknown>[],
  calls: [] as string[],
  failSave: false,
  checkpoint: {
    v: 1,
    iv: "a".repeat(16),
    tag: "b".repeat(24),
    ciphertext: "encrypted-only",
  },
}));
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      public ctx: DurableObjectState,
      public env: Env,
    ) {}
  },
}));
vi.mock("./client", () => ({
  BoatClient: class {
    async info() {
      runtime.calls.push("info");
      return { id: "bx_23456789", state: runtime.state };
    }
    async extend() {
      runtime.calls.push("extend");
    }
    async resume() {
      runtime.calls.push("resume");
      runtime.state = "ready";
    }
    async stop() {
      runtime.calls.push("stop");
      runtime.state = "archived";
      runtime.authenticated = false;
    }
    async endpoint() {
      return "https://pilot.on.boat.dev/?_token=private";
    }
    async bridge(_endpoint: string, path: string, body?: unknown) {
      runtime.calls.push(path);
      if (
        path === "/initialize" &&
        body &&
        typeof body === "object" &&
        "checkpoint" in body &&
        body.checkpoint
      )
        runtime.authenticated = true;
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
      if (path === "/step")
        return Response.json({
          text: "",
          toolCalls: [
            {
              id: "call",
              name: "request_local_hands_action",
              arguments: '{"kind":"filesystem.fetch"}',
            },
          ],
        });
      return Response.json({ ready: true });
    }
  },
}));
import { BoatComputer } from "./BoatComputer";
import { AUTH_CHECKPOINT_KEY } from "../cloud-computer/auth-checkpoint";

function harness() {
  const storage = new Map<string, unknown>();
  const ctx = {
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        if (runtime.failSave && key === AUTH_CHECKPOINT_KEY)
          throw new Error("disk unavailable");
        storage.set(key, structuredClone(value));
      },
      setAlarm: vi.fn(),
      deleteAlarm: vi.fn(),
    },
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => {
      const p = fn();
      runtime.initializers.push(p);
      return p;
    },
  } as unknown as DurableObjectState;
  const create = async () => {
    const computer = new BoatComputer(ctx, {
      BOAT_SANDBOX_ID: "bx_23456789",
      BOAT_CREDENTIAL_KEY: "private-key",
      DOWNY_CODEX_MODEL: "gpt-5.5",
    } as unknown as Env);
    await Promise.all(runtime.initializers);
    return computer;
  };
  return { create, storage };
}
const post = (path: string, body?: unknown) =>
  new Request(`https://computer.internal/${path}`, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
const status = () => new Request("https://computer.internal/status");
beforeEach(() => {
  vi.useFakeTimers();
  runtime.calls = [];
  runtime.initializers = [];
  runtime.state = "ready";
  runtime.authenticated = false;
  runtime.failSave = false;
});
afterEach(() => vi.useRealTimers());

it("saves login after Settings closes, sleeps, and restores after DO and VM replacement", async () => {
  const h = harness();
  const computer = await h.create();
  expect((await computer.fetch(post("login"))).status).toBe(200);
  runtime.authenticated = true;
  await computer.alarm();
  expect(h.storage.get(AUTH_CHECKPOINT_KEY)).toEqual(runtime.checkpoint);
  vi.setSystemTime(Date.now() + 16 * 60_000);
  await computer.alarm();
  expect(runtime.state).toBe("archived");
  const replacement = await h.create();
  expect((await replacement.fetch(post("wake"))).status).toBe(200);
  expect(runtime.authenticated).toBe(true);
  const result = await (await replacement.fetch(status())).text();
  expect(result).toContain('"credentialCheckpoint":"present"');
  expect(result).not.toContain("encrypted-only");
  expect(result).not.toContain("private-key");
});

it("does not stop or report success when the encrypted credential save fails", async () => {
  const computer = await harness().create();
  await computer.fetch(post("wake"));
  runtime.authenticated = true;
  runtime.failSave = true;
  expect((await computer.fetch(post("sleep"))).status).toBe(503);
  expect(runtime.calls).not.toContain("stop");
});

it("status polling cannot wake a stopped machine or expose provider credentials", async () => {
  const computer = await harness().create();
  await computer.fetch(status());
  await computer.fetch(status());
  expect(runtime.calls).toEqual(["info"]);
});

it("does not wake a sandbox stopped externally when its checkpoint alarm fires", async () => {
  const computer = await harness().create();
  await computer.fetch(post("login"));
  runtime.state = "archived";
  runtime.calls = [];
  await computer.alarm();
  expect(runtime.calls).toEqual(["info"]);
  expect(await (await computer.fetch(status())).text()).toContain(
    '"state":"sleeping"',
  );
});

it("returns side-effect intent for Downy's existing confirmation gate without executing it", async () => {
  const computer = await harness().create();
  const response = await computer.fetch(
    post("step", {
      id: "11111111-1111-4111-8111-111111111111",
      model: "gpt-5.5",
      system: "",
      transcript: "[]",
      tools: [
        {
          name: "request_local_hands_action",
          description: "confirmation required",
          inputSchema: {},
        },
      ],
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("request_local_hands_action");
  expect(runtime.calls).not.toContain("/prompt");
  expect(runtime.calls).not.toContain("/commands");
});

it("rejects lifecycle mutation while a step is queued or running", async () => {
  const computer = await harness().create();
  const first = computer.fetch(post("wake"));
  const second = await computer.fetch(post("sleep"));
  expect(second.status).toBe(409);
  await first;
});
