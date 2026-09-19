/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deliberately partial Workers runtime fixtures; production code uses real DO state */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { VoiceCall } from "./VoiceCall";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      protected ctx: DurableObjectState,
      protected env: Cloudflare.Env,
    ) {}
  },
}));
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  attach: vi.fn(),
  lookup: vi.fn(),
  transcript: vi.fn(),
}));
vi.mock("./provider", () => ({
  createLiveSession: mocks.create,
  attachLiveSession: mocks.attach,
  VoiceProviderError: class extends Error {},
}));
vi.mock("../lib/get-agent", () => ({
  getAgentStub: async () => ({
    getVoiceContext: async () => "Existing digest",
    runVoiceTurn: mocks.lookup,
    saveVoiceTranscript: mocks.transcript,
  }),
}));

class Socket extends EventTarget {
  readyState = 1;
  sent: string[] = [];
  send(value: string) {
    this.sent.push(value);
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
  event(data: object) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }
}

const SentEvent = z.object({
  type: z.string(),
  delegation_id: z.string().optional(),
});
function sentEvents(socket: Socket) {
  return socket.sent.map((data) => SentEvent.parse(JSON.parse(data)));
}

function fixture() {
  const records = new Map<string, unknown>();
  const pending: Promise<unknown>[] = [];
  let ready: Promise<unknown> = Promise.resolve();
  const storage = {
    get: vi.fn(async (key: string) => structuredClone(records.get(key))),
    put: vi.fn(async (key: string, value: unknown) => {
      records.set(key, structuredClone(value));
    }),
    setAlarm: vi.fn(async () => {}),
    deleteAlarm: vi.fn(async () => {}),
  };
  const ctx = {
    storage,
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => {
      ready = fn();
    },
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
  } as unknown as DurableObjectState;
  const call = new VoiceCall(ctx, {} as Cloudflare.Env);
  const socket = new Socket();
  mocks.attach.mockResolvedValue(socket);
  return {
    call,
    socket,
    records,
    storage,
    ready: () => ready,
    drain: async () => {
      while (pending.length) await pending.shift();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({
    session: { id: "live_test" },
    transport: { type: "webrtc", sdp: "answer" },
  });
  mocks.lookup.mockResolvedValue("The digest cites a new game AI paper.");
  mocks.transcript.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

it("allows one call per agent and rejects a foreign call id", async () => {
  const f = fixture();
  await f.ready();
  expect((await f.call.start("research", "one", "offer")).state).toBe("active");
  await expect(f.call.start("research", "two", "offer")).rejects.toThrow(
    "already open",
  );
  expect(await f.call.end("someone-else")).toBeNull();
  expect(await f.call.heartbeat("someone-else")).toBeNull();
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

it("deduplicates delegation and leaves actions to the existing read-only backend", async () => {
  const f = fixture();
  await f.ready();
  await f.call.start("research", "one", "offer");
  f.socket.event({
    type: "session.input_transcript.delta",
    event_id: "text",
    delta: "What did the digest find?",
    start_ms: 0,
    end_ms: 100,
  });
  const delegation = {
    type: "session.delegation.created",
    delegation: { id: "task", target: "client" },
  };
  f.socket.event(delegation);
  f.socket.event(delegation);
  await f.drain();
  expect(mocks.lookup).toHaveBeenCalledTimes(1);
  expect(mocks.lookup.mock.calls[0][2]).toContain("What did the digest find?");
  expect(
    sentEvents(f.socket).some((data) => data.delegation_id === "task"),
  ).toBe(true);
});

it("does not speak a stale lookup over a correction and never stores audio", async () => {
  let finish: ((answer: string) => void) | undefined;
  mocks.lookup.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  const f = fixture();
  await f.ready();
  await f.call.start("research", "one", "offer");
  f.socket.event({
    type: "session.input_transcript.delta",
    delta: "Read the first digest",
    end_ms: 100,
  });
  f.socket.event({
    type: "session.delegation.created",
    delegation: { id: "task", target: "client" },
  });
  await vi.advanceTimersByTimeAsync(0);
  f.socket.event({
    type: "session.input_transcript.delta",
    delta: "No, the second one",
    start_ms: 200,
    end_ms: 300,
  });
  f.socket.event({
    type: "session.input_audio.delta",
    audio: "private-audio-bytes",
  });
  await vi.advanceTimersByTimeAsync(0);
  finish?.("First digest result");
  await f.drain();
  expect(sentEvents(f.socket).map((data) => data.type)).toContain(
    "session.thinking.append",
  );
  expect(sentEvents(f.socket).map((data) => data.type)).not.toContain(
    "session.commentary.append",
  );
  expect(JSON.stringify([...f.records])).not.toContain("private-audio-bytes");
});

it("does not resurrect expired leases and waits for provider confirmation before marking closed", async () => {
  const f = fixture();
  await f.ready();
  await f.call.start("research", "one", "offer");
  vi.setSystemTime(1_060_001);
  expect((await f.call.heartbeat("one"))?.state).toBe("closing");
  expect(sentEvents(f.socket).map((data) => data.type)).toContain(
    "session.close",
  );
  f.socket.event({ type: "session.closed", usage: { seconds: 60 } });
  await f.drain();
  expect((await f.call.heartbeat("one"))?.state).toBe("closed");
  expect(f.storage.deleteAlarm).toHaveBeenCalled();
  expect(f.records.get("usage:one")).toMatchObject({
    seconds: 60,
    finalization: "confirmed",
  });
});

it("closes through the durable alarm after browser disappearance", async () => {
  const f = fixture();
  await f.ready();
  await f.call.start("research", "one", "offer");
  vi.setSystemTime(1_060_001);
  await f.call.alarm();
  expect((await f.call.heartbeat("one"))?.state).toBe("closing");
  expect(f.storage.setAlarm).toHaveBeenCalled();
});
