/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- deliberately partial Workers runtime fixtures; production code uses real DO state */
// Shared fixture for the VoiceCall test files. Each test file installs the
// module mocks itself (vi.mock is hoisted per test module) and points them at
// `mocks` here, so both files drive the same fakes.
import { vi } from "vitest";
import { z } from "zod";
import { VoiceCall } from "./VoiceCall";

import { mocks } from "./VoiceCall.mocks";
export { mocks };

export class Socket extends EventTarget {
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
export function sentEvents(socket: Socket) {
  return socket.sent.map((data) => SentEvent.parse(JSON.parse(data)));
}

export function fixture(records = new Map<string, unknown>()) {
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

export function resetMocks() {
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
}
