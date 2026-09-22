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
  lookupResult: vi.fn(),
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
    getVoiceTaskResult: mocks.lookupResult,
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
  delegation_id: z.string().nullable().optional(),
  content: z.string().optional(),
});
function sentEvents(socket: Socket) {
  return socket.sent.map((data) => SentEvent.parse(JSON.parse(data)));
}

function fixture(records = new Map<string, unknown>()) {
  const pending: Promise<unknown>[] = [];
  let ready: Promise<unknown> = Promise.resolve();
  const storage = {
    get: vi.fn(async (key: string) => structuredClone(records.get(key))),
    put: vi.fn(async (key: string, value: unknown) => {
      records.set(key, structuredClone(value));
    }),
    list: vi.fn(
      async ({
        prefix,
        limit,
        reverse,
      }: {
        prefix: string;
        limit: number;
        reverse?: boolean;
      }) =>
        new Map(
          [...records]
            .filter(([key]) => key.startsWith(prefix))
            // eslint-disable-next-line unicorn/no-array-sort -- Fresh fixture array; project targets ES2022.
            .sort(([a], [b]) =>
              reverse ? b.localeCompare(a) : a.localeCompare(b),
            )
            .slice(0, limit)
            .map(([key, value]) => [key, structuredClone(value)]),
        ),
    ),
    delete: vi.fn(async (key: string) => records.delete(key)),
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
  mocks.lookupResult.mockResolvedValue({ state: "running", answer: null });
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

it("scopes completion to the original request after a correction and never stores audio", async () => {
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
    "session.commentary.append",
  );
  expect(
    sentEvents(f.socket).find(
      (data) => data.type === "session.commentary.append",
    )?.content,
  ).toContain("Original request context: You: Read the first digest");
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

it("retries a failed final transcript save after hangup without losing it to the next call", async () => {
  const f = fixture();
  await f.ready();
  await f.call.start("research", "phone", "offer");
  f.socket.event({
    type: "session.input_transcript.delta",
    delta: "Suggest an example CUA pilot",
    start_ms: 0,
    end_ms: 100,
  });
  await f.drain();
  mocks.transcript.mockRejectedValueOnce(
    new Error("Temporary agent disconnect"),
  );
  f.socket.event({ type: "session.closed" });
  await f.drain();
  expect(mocks.transcript).toHaveBeenCalledTimes(1);
  await f.call.alarm();
  expect(mocks.transcript).toHaveBeenCalledTimes(2);
  expect(mocks.transcript).toHaveBeenLastCalledWith(
    "phone",
    expect.stringContaining("example CUA pilot"),
  );
});

it("waits for the caller transcript when delegation arrives before its captions", async () => {
  const f = fixture();
  await f.ready();
  await f.call.start("research", "phone", "offer");
  f.socket.event({
    type: "session.delegation.created",
    delegation: { id: "task", target: "client" },
  });
  await vi.advanceTimersByTimeAsync(0);
  f.socket.event({
    type: "session.input_transcript.delta",
    delta: "Suggest an example CUA pilot",
    start_ms: 0,
    end_ms: 100,
  });
  await vi.advanceTimersByTimeAsync(500);
  await f.drain();
  expect(mocks.lookup).toHaveBeenCalledTimes(1);
  expect(mocks.lookup.mock.calls[0][2]).toContain("example CUA pilot");
});

it("recovers the phone transcript after coordinator restart and a new laptop call", async () => {
  const phone = fixture();
  await phone.ready();
  await phone.call.start("research", "phone", "offer");
  phone.socket.event({
    type: "session.input_transcript.delta",
    delta: "Suggest an example CUA pilot",
    end_ms: 100,
  });
  await phone.drain();
  mocks.transcript.mockRejectedValue(new Error("Temporary agent disconnect"));
  phone.socket.event({ type: "session.closed" });
  await phone.drain();
  expect(phone.records.has("pending-transcript:phone")).toBe(true);
  const laptop = fixture(phone.records);
  await laptop.ready();
  await laptop.call.start("research", "laptop", "offer");
  expect(phone.records.has("pending-transcript:phone")).toBe(true);
  mocks.transcript.mockResolvedValue(undefined);
  mocks.lookupResult.mockResolvedValue({ state: "running", answer: null });
  await laptop.call.alarm();
  expect(mocks.transcript).toHaveBeenLastCalledWith(
    "phone",
    expect.stringContaining("example CUA pilot"),
  );
  expect(phone.records.has("pending-transcript:phone")).toBe(false);
});

it("does not re-run model work when retrying the transcript after hangup", async () => {
  const f = fixture();
  await f.ready();
  await f.call.start("research", "phone", "offer");
  f.socket.event({
    type: "session.input_transcript.delta",
    delta: "Suggest an example CUA pilot",
    end_ms: 100,
  });
  f.socket.event({
    type: "session.delegation.created",
    delegation: { id: "task", target: "client" },
  });
  await f.drain();
  expect(mocks.lookup).toHaveBeenCalledTimes(1);
  mocks.transcript.mockRejectedValueOnce(
    new Error("Temporary agent disconnect"),
  );
  f.socket.event({ type: "session.closed" });
  await f.drain();
  await f.call.alarm();
  expect(mocks.lookup).toHaveBeenCalledTimes(1);
  expect(mocks.transcript).toHaveBeenCalledTimes(2);
});

it("bounds waiting for absent captions and does not invent a lookup", async () => {
  const f = fixture();
  await f.ready();
  await f.call.start("research", "phone", "offer");
  f.socket.event({
    type: "session.delegation.created",
    delegation: { id: "task", target: "client" },
  });
  await vi.advanceTimersByTimeAsync(1600);
  await f.drain();
  expect(mocks.lookup).not.toHaveBeenCalled();
  expect(
    f.socket.sent.some((value) => value.includes("Please repeat it")),
  ).toBe(true);
});

it("retains final captions that supersede a transcript being delivered", async () => {
  const f = fixture();
  await f.ready();
  await f.call.start("research", "phone", "offer");
  f.socket.event({
    type: "session.input_transcript.delta",
    delta: "Suggest a CUA pilot",
    end_ms: 100,
  });
  await f.drain();
  let finish: (() => void) | undefined;
  mocks.transcript.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const ending = f.call.end("phone");
  await vi.advanceTimersByTimeAsync(0);
  f.socket.event({
    type: "session.output_transcript.delta",
    delta: "A safe public-page capture",
    start_ms: 200,
    end_ms: 300,
  });
  f.socket.event({ type: "session.closed" });
  await vi.advanceTimersByTimeAsync(0);
  finish?.();
  await ending;
  await f.drain();
  await f.call.alarm();
  expect(mocks.transcript).toHaveBeenLastCalledWith(
    "phone",
    expect.stringContaining("A safe public-page capture"),
  );
  expect(f.records.has("pending-transcript:phone")).toBe(false);
});

it("announces a completed lookup after the caller asks for progress", async () => {
  let finish!: (answer: string) => void;
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
    delta: "Count pipeline records",
    end_ms: 100,
  });
  f.socket.event({
    type: "session.delegation.created",
    delegation: { id: "pipeline", target: "client" },
  });
  await vi.advanceTimersByTimeAsync(0);
  f.socket.event({
    type: "session.input_transcript.delta",
    delta: "Are you still working on it?",
    start_ms: 200,
    end_ms: 300,
  });
  await vi.advanceTimersByTimeAsync(0);
  finish("Complete pipeline count: 1460 records across 15 pages.");
  await f.drain();
  expect(
    f.socket.sent.some(
      (raw) =>
        raw.includes("session.commentary.append") && raw.includes("1460"),
    ),
  ).toBe(true);
  expect((await f.call.heartbeat("one"))?.working).toBe(false);
});

it("delivers a lookup from an ended call to the current call without rerunning it", async () => {
  let finish!: (answer: string) => void;
  mocks.lookup.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  const f = fixture();
  await f.ready();
  await f.call.start("research", "first", "offer");
  f.socket.event({
    type: "session.input_transcript.delta",
    delta: "Count pipeline records",
    end_ms: 100,
  });
  f.socket.event({
    type: "session.delegation.created",
    delegation: { id: "pipeline", target: "client" },
  });
  await vi.advanceTimersByTimeAsync(0);
  await f.call.end("first");
  f.socket.event({ type: "session.closed" });
  await vi.advanceTimersByTimeAsync(0);
  const next = new Socket();
  mocks.attach.mockResolvedValue(next);
  await f.call.start("research", "second", "offer");
  finish("Complete pipeline count: 1460 records across 15 pages.");
  await f.drain();
  expect(
    next.sent.some(
      (raw) =>
        raw.includes("session.commentary.append") && raw.includes("1460"),
    ),
  ).toBe(true);
  expect(mocks.lookup).toHaveBeenCalledTimes(1);
  expect(
    sentEvents(next)
      .filter((event) => event.type === "session.commentary.append")
      .every((event) => event.delegation_id === null),
  ).toBe(true);
  const count = next.sent.length;
  await f.call.heartbeat("second");
  expect(next.sent).toHaveLength(count);
});

function storedLookup(state: "running" | "finished" | "unknown" = "running") {
  const key = "voice-lookup:990000:first:pipeline";
  return new Map<string, unknown>([
    [
      key,
      {
        key,
        callId: "first",
        delegationId: "pipeline",
        slug: "research",
        startedAt: 990_000,
        request: "Count pipeline records",
        state,
        ...(state === "finished"
          ? { answer: "1460 records across 15 pages." }
          : {}),
      },
    ],
  ]);
}

it("recovers completion from the agent after a coordinator restart without replaying the task", async () => {
  const f = fixture(storedLookup());
  await f.ready();
  expect((await f.call.start("research", "second", "offer")).working).toBe(
    true,
  );
  expect(mocks.create.mock.calls[0][2]).toContain("Count pipeline records");
  mocks.lookupResult.mockResolvedValue({
    state: "finished",
    answer: "1460 records across 15 pages.",
  });
  expect((await f.call.heartbeat("second"))?.working).toBe(false);
  expect(f.socket.sent.join("")).toContain("1460");
  expect(mocks.lookup).not.toHaveBeenCalled();
  expect(mocks.lookupResult).toHaveBeenCalledWith("first", "pipeline");
  const count = f.socket.sent.length;
  await Promise.all([f.call.heartbeat("second"), f.call.heartbeat("second")]);
  expect(f.socket.sent).toHaveLength(count);
});

it("includes already completed work in a new call's context without announcing it unprompted", async () => {
  const f = fixture(storedLookup("finished"));
  await f.ready();
  expect((await f.call.start("research", "second", "offer")).working).toBe(
    false,
  );
  expect(mocks.create.mock.calls[0][2]).toContain("1460");
  expect(f.socket.sent).toHaveLength(0);
  expect(mocks.lookup).not.toHaveBeenCalled();
});

it("reports unverifiable task status instead of pretending to make progress, then recovers", async () => {
  const f = fixture(storedLookup());
  await f.ready();
  await f.call.start("research", "second", "offer");
  mocks.lookupResult.mockRejectedValueOnce(new Error("private-provider-error"));
  expect((await f.call.heartbeat("second"))?.working).toBe(false);
  expect(f.socket.sent.join("")).toContain("could not be verified");
  expect(f.socket.sent.join("")).not.toContain("private-provider-error");
  mocks.lookupResult.mockResolvedValue({
    state: "finished",
    answer: "1460 records across 15 pages.",
  });
  await f.call.heartbeat("second");
  expect(f.socket.sent.join("")).toContain("1460");
  expect(mocks.lookup).not.toHaveBeenCalled();
});

it("keeps a failed lookup terminal and never sends its result to a closed call", async () => {
  let fail!: (error: Error) => void;
  mocks.lookup.mockReturnValue(
    new Promise<string>((_resolve, reject) => {
      fail = reject;
    }),
  );
  const f = fixture();
  await f.ready();
  await f.call.start("research", "first", "offer");
  f.socket.event({
    type: "session.input_transcript.delta",
    delta: "Count pipeline records",
    end_ms: 100,
  });
  f.socket.event({
    type: "session.delegation.created",
    delegation: { id: "pipeline", target: "client" },
  });
  await vi.advanceTimersByTimeAsync(0);
  await f.call.end("first");
  f.socket.event({ type: "session.closed" });
  await vi.advanceTimersByTimeAsync(0);
  const count = f.socket.sent.length;
  fail(new Error("private-provider-error"));
  await f.drain();
  expect(f.socket.sent).toHaveLength(count);
  const next = new Socket();
  mocks.attach.mockResolvedValue(next);
  expect((await f.call.start("research", "second", "offer")).working).toBe(
    false,
  );
  expect(mocks.create.mock.calls.at(-1)?.[2]).toContain("could not complete");
  expect(mocks.create.mock.calls.at(-1)?.[2]).not.toContain(
    "private-provider-error",
  );
  expect(mocks.lookup).toHaveBeenCalledOnce();
});

it("acknowledges dispatched research once, keeps the lookup open, and announces the finish from the task record", async () => {
  mocks.lookup.mockResolvedValue({
    answer: "I've started a read-only background research task.",
    pending: true,
  });
  const f = fixture();
  await f.ready();
  await f.call.start("research", "one", "offer");
  f.socket.event({
    type: "session.input_transcript.delta",
    delta: "Compare the three vendors' pricing pages",
    end_ms: 100,
  });
  f.socket.event({
    type: "session.delegation.created",
    delegation: { id: "compare", target: "client" },
  });
  await f.drain();
  const acknowledgements = sentEvents(f.socket).filter(
    (event) =>
      event.type === "session.commentary.append" &&
      event.content?.includes("started"),
  );
  expect(acknowledgements).toHaveLength(1);
  expect(acknowledgements[0].delegation_id).toBe("compare");
  expect((await f.call.heartbeat("one"))?.working).toBe(true);
  // Still running: nothing new is said and the ack is not repeated.
  mocks.lookupResult.mockResolvedValue({
    state: "running",
    answer: "I've started a read-only background research task.",
  });
  vi.setSystemTime(1_020_000);
  const before = f.socket.sent.length;
  await f.call.heartbeat("one");
  expect(f.socket.sent).toHaveLength(before);
  expect(mocks.lookup).toHaveBeenCalledTimes(1);
  // The worker finishes: the durable record is read, never the model re-run.
  mocks.lookupResult.mockResolvedValue({
    state: "finished",
    answer:
      "The background research has finished. Its findings are saved as a new workspace note and the link is in chat.",
  });
  await f.call.heartbeat("one");
  const finish = sentEvents(f.socket).filter(
    (event) =>
      event.type === "session.commentary.append" &&
      event.content?.includes("has finished"),
  );
  expect(finish).toHaveLength(1);
  expect(finish[0].delegation_id).toBe("compare");
  expect((await f.call.heartbeat("one"))?.working).toBe(false);
  expect(mocks.lookup).toHaveBeenCalledTimes(1);
});

it("forwards backend progress as coalesced commentary and keeps the last note for a later call", async () => {
  let finish!: (answer: string) => void;
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
    delta: "Draft outreach for Studio A",
    end_ms: 100,
  });
  f.socket.event({
    type: "session.delegation.created",
    delegation: { id: "draft", target: "client" },
  });
  await vi.advanceTimersByTimeAsync(0);
  // Nothing has happened yet: no progress sent.
  const before = sentEvents(f.socket).filter(
    (event) => event.type === "session.commentary.append",
  ).length;
  await f.call.progress("one", "draft", "loaded the runbook");
  await f.call.progress("one", "draft", "read Airtable");
  await f.call.progress("other-call", "draft", "must be dropped");
  await f.call.progress(null, null, "a card is waiting in chat for your tap");
  expect(
    sentEvents(f.socket).filter((e) => e.type === "session.commentary.append"),
  ).toHaveLength(before);
  await vi.advanceTimersByTimeAsync(1500);
  const progress = sentEvents(f.socket)
    .filter((e) => e.type === "session.commentary.append")
    .slice(before);
  expect(progress).toHaveLength(2);
  expect(progress[0].delegation_id).toBe("draft");
  expect(progress[0].content).toContain("not a result");
  expect(progress[0].content).toContain("loaded the runbook; read Airtable");
  expect(progress[0].content).not.toContain("must be dropped");
  expect(progress[1].delegation_id).toBeNull();
  expect(progress[1].content).toContain("a card is waiting in chat");
  // The lookup remembers its last note; a new call sees it as context.
  await f.call.end("one");
  f.socket.event({ type: "session.closed" });
  await vi.advanceTimersByTimeAsync(0);
  const next = new Socket();
  mocks.attach.mockResolvedValue(next);
  await f.call.start("research", "two", "offer");
  expect(mocks.create.mock.calls.at(-1)?.[2]).toContain(
    "last progress note: read Airtable",
  );
  finish("Draft saved.");
  await f.drain();
});

it("ignores progress when no call is active and caps notes per lookup", async () => {
  const f = fixture();
  await f.ready();
  await f.call.progress("one", "draft", "nothing to send to");
  expect(f.storage.put).not.toHaveBeenCalled();
  await f.call.start("research", "one", "offer");
  f.socket.event({
    type: "session.input_transcript.delta",
    delta: "Count records",
    end_ms: 100,
  });
  mocks.lookup.mockReturnValue(new Promise<string>(() => {}));
  f.socket.event({
    type: "session.delegation.created",
    delegation: { id: "count", target: "client" },
  });
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 40; i++)
    await f.call.progress("one", "count", `step ${i}`);
  await vi.advanceTimersByTimeAsync(1500);
  const lookup = [...f.records.values()].find(
    (value): value is { progressCount: number; progress: string } =>
      !!value &&
      typeof value === "object" &&
      "progressCount" in value &&
      typeof (value as { progressCount: unknown }).progressCount === "number",
  );
  expect(lookup?.progressCount).toBe(25);
  expect(lookup?.progress).toBe("step 24");
});
