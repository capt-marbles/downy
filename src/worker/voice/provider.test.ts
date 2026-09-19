import { afterEach, expect, it, vi } from "vitest";
import { attachLiveSession, createLiveSession } from "./provider";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("cancels the connection deadline after WebSocket upgrade so a live call survives ten seconds", async () => {
  vi.useFakeTimers();
  // Make native timeout signals deterministic under fake timers. Workerd keeps
  // fetch's abort signal attached to the upgraded WebSocket (runtime repro).
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  const socket = { accept: vi.fn(), close: vi.fn() };
  const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
    options.signal?.addEventListener("abort", socket.close);
    return Object.assign(new Response(null), { webSocket: socket });
  });
  vi.stubGlobal("fetch", fetcher);
  await attachLiveSession("secret-value", "live_test");
  expect(socket.accept).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(false);
  expect(socket.close).not.toHaveBeenCalled();
});

it("still aborts a stalled sideband connection after ten seconds", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Timed out", "AbortError")),
          );
        }),
    ),
  );
  const result = expect(
    attachLiveSession("secret-value", "live_test"),
  ).rejects.toThrow("Timed out");
  await vi.advanceTimersByTimeAsync(10_001);
  await result;
});

it("keeps the API key in the authorization header and restricts the browser event channel", async () => {
  const fetcher = vi.fn<
    (url: string, options: RequestInit) => Promise<Response>
  >(async () =>
    Response.json({
      session: { id: "live_test" },
      transport: { type: "webrtc", sdp: "answer" },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await createLiveSession(
    "secret-value",
    "offer",
    "Discuss the X research digest",
  );
  expect(result.transport.sdp).toBe("answer");
  const options = fetcher.mock.calls[0][1];
  expect(options.headers).toMatchObject({
    Authorization: "Bearer secret-value",
  });
  expect(options.body).not.toContain("secret-value");
  if (typeof options.body !== "string") throw new Error("Expected JSON body");
  const body: unknown = JSON.parse(options.body);
  expect(body).toMatchObject({
    session: {
      model: "gpt-live-1",
      store: false,
      delegation: { type: "client" },
      client: {
        data_channel: {
          allowed_client_events: [
            "session.close",
            "session.input_audio.mute",
            "session.input_audio.unmute",
          ],
        },
      },
    },
  });
  expect(JSON.stringify(result)).not.toContain("secret-value");
});

it("never echoes a failed provider response or retries a paid creation", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response("bad key secret-value; private transcript", { status: 401 }),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    createLiveSession("secret-value", "offer", "private transcript"),
  ).rejects.toThrow("OpenAI voice access");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
