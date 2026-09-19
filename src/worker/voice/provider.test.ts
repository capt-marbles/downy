import { afterEach, expect, it, vi } from "vitest";
import { createLiveSession } from "./provider";

afterEach(() => vi.unstubAllGlobals());

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
