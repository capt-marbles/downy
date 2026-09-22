/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deliberately partial Workers runtime fixtures; production code uses real DO state */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fixture,
  mocks,
  resetMocks,
  sentEvents,
  Socket,
} from "./VoiceCall.fixture";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      protected ctx: DurableObjectState,
      protected env: Cloudflare.Env,
    ) {}
  },
}));
vi.mock("./provider", async () => {
  const { mocks: handles } = await import("./VoiceCall.mocks");
  return {
    createLiveSession: handles.create,
    attachLiveSession: handles.attach,
    VoiceProviderError: class extends Error {},
  };
});
vi.mock("../lib/get-agent", async () => {
  const { mocks: handles } = await import("./VoiceCall.mocks");
  return {
    getAgentStub: async () => ({
      getVoiceContext: async () => "Existing digest",
      runVoiceTurn: handles.lookup,
      getVoiceTaskResult: handles.lookupResult,
      saveVoiceTranscript: handles.transcript,
    }),
  };
});

beforeEach(() => resetMocks());
afterEach(() => vi.useRealTimers());

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

it("does not count Downy speaking or a running lookup as idle", async () => {
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
    delta: "Count records",
    end_ms: 100,
  });
  f.socket.event({
    type: "session.delegation.created",
    delegation: { id: "count", target: "client" },
  });
  await vi.advanceTimersByTimeAsync(0);
  // Five minutes of caller silence while the lookup runs; heartbeats stay
  // inside the sixty-second lease.
  for (let t = 50_000; t <= 300_000; t += 50_000) {
    vi.setSystemTime(1_000_000 + t);
    expect((await f.call.heartbeat("one"))?.state).toBe("active");
  }
  finish("1460 records.");
  await f.drain();
  // Downy speaking alone keeps the call alive for another idle window.
  f.socket.event({
    type: "session.output_transcript.delta",
    delta: "Here is what I found",
    end_ms: 300_100,
  });
  await vi.advanceTimersByTimeAsync(0);
  for (let t = 350_000; t <= 450_000; t += 50_000) {
    vi.setSystemTime(1_000_000 + t);
    expect((await f.call.heartbeat("one"))?.state).toBe("active");
  }
  // Nothing spoke and nothing ran for three minutes: now it is idle.
  vi.setSystemTime(1_000_000 + 490_000);
  expect((await f.call.heartbeat("one"))?.state).not.toBe("active");
});
