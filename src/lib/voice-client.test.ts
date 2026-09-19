import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VoiceClient, type CallView } from "./voice-client";
import { VoiceCommandSchema } from "./voice";

class Channel extends EventTarget {
  readyState = "open";
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = "closed";
    this.dispatchEvent(new Event("close"));
  });
  event(type: string) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify({ type }) }),
    );
  }
}
class Peer extends EventTarget {
  static instances: Peer[] = [];
  channel = new Channel();
  iceGatheringState = "complete";
  localDescription = { sdp: "offer" };
  connectionState = "connected";
  ontrack: ((event: { streams: object[]; track: object }) => void) | null =
    null;
  onconnectionstatechange: (() => void) | null = null;
  close = vi.fn();
  addTrack = vi.fn();
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "offer" }));
  setLocalDescription = vi.fn(async () => {});
  setRemoteDescription = vi.fn(async () => {
    this.channel.event("session.started");
  });
  createDataChannel = vi.fn(() => this.channel);
  constructor() {
    super();
    Peer.instances.push(this);
  }
}

let view: CallView;
let client: VoiceClient;
let track: { enabled: boolean; stop: ReturnType<typeof vi.fn> };
let media: ReturnType<typeof vi.fn>;
let fetcher: ReturnType<typeof vi.fn>;
let audio: {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  srcObject: HTMLMediaElement["srcObject"];
};
let documentEvents: EventTarget & { hidden: boolean };

beforeEach(() => {
  vi.useFakeTimers();
  Peer.instances = [];
  vi.stubGlobal("window", new EventTarget());
  documentEvents = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", documentEvents);
  vi.stubGlobal("RTCPeerConnection", Peer);
  track = { enabled: true, stop: vi.fn() };
  media = vi.fn(async () => ({
    getTracks: () => [track],
    getAudioTracks: () => [track],
  }));
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: media } });
  fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options?.method) return Response.json({ configured: true });
    if (typeof options.body !== "string") throw new Error("Expected JSON body");
    const body = VoiceCommandSchema.parse(JSON.parse(options.body));
    return Response.json({
      callId: body.callId,
      state: body.command === "end" ? "closed" : "active",
      startedAt: Date.now(),
      expiresAt: Date.now() + 900_000,
      reason: null,
      working: false,
      ...(body.command === "start" ? { sdp: "answer" } : {}),
    });
  });
  vi.stubGlobal("fetch", fetcher);
  audio = { play: vi.fn(async () => {}), pause: vi.fn(), srcObject: null };
  client = new VoiceClient("research", audio, (next) => {
    view = next;
  });
});
afterEach(async () => {
  client.dispose();
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("connects WebRTC, supports mute, and releases every resource on hangup", async () => {
  await client.start();
  expect(view.state).toBe("live");
  expect(Peer.instances[0].createDataChannel).toHaveBeenCalledWith(
    "oai-events",
  );
  client.mute();
  expect(track.enabled).toBe(false);
  expect(view.muted).toBe(true);
  client.mute();
  expect(track.enabled).toBe(true);
  await client.end();
  expect(view.state).toBe("ended");
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(Peer.instances[0].close).toHaveBeenCalledTimes(1);
  expect(audio.srcObject).toBeNull();
  const calls = fetcher.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({
    keepalive: true,
    headers: { "X-Agent-Slug": "research" },
  });
});

it("handles microphone denial without starting a paid session", async () => {
  media.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  await client.start();
  expect(view.error).toContain("permission was denied");
  expect(Peer.instances).toHaveLength(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("stops a late microphone grant after cancellation without creating a session", async () => {
  let allow: ((stream: unknown) => void) | undefined;
  media.mockReturnValue(
    new Promise((resolve) => {
      allow = resolve;
    }),
  );
  const starting = client.start();
  await vi.advanceTimersByTimeAsync(0);
  await client.end();
  allow?.({ getTracks: () => [track] });
  await starting;
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(Peer.instances).toHaveLength(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("requires setup before requesting microphone permission", async () => {
  fetcher.mockResolvedValue(Response.json({ configured: false }));
  await client.start();
  expect(view.error).toContain("server setup");
  expect(media).not.toHaveBeenCalled();
});

it("shows a sound activation control when autoplay is blocked", async () => {
  await client.start();
  audio.play.mockRejectedValueOnce(
    new DOMException("Autoplay blocked", "NotAllowedError"),
  );
  await client.play();
  expect(view.needsPlayback).toBe(true);
  await client.play();
  expect(view.needsPlayback).toBe(false);
});

it("ends instead of listening in a background tab or reconnecting on its own", async () => {
  await client.start();
  documentEvents.hidden = true;
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(view.state).toBe("ended");
  expect(track.stop).toHaveBeenCalled();
  documentEvents.hidden = false;
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Peer.instances).toHaveLength(1);
});

it("stops the mic immediately but keeps WebRTC open until the final close event", async () => {
  await client.start();
  fetcher.mockResolvedValue(
    Response.json({
      callId: crypto.randomUUID(),
      state: "closing",
      startedAt: 0,
      expiresAt: 900_000,
      reason: null,
      working: false,
    }),
  );
  const ending = client.end();
  await vi.advanceTimersByTimeAsync(0);
  expect(track.stop).toHaveBeenCalled();
  expect(Peer.instances[0].close).not.toHaveBeenCalled();
  Peer.instances[0].channel.event("session.closed");
  await ending;
  expect(Peer.instances[0].close).toHaveBeenCalled();
  expect(view.error).toBeNull();
});

it("bounds the graceful-close wait and reports incomplete finalization", async () => {
  await client.start();
  fetcher.mockResolvedValue(
    Response.json({
      callId: crypto.randomUUID(),
      state: "closing",
      startedAt: 0,
      expiresAt: 900_000,
      reason: null,
      working: false,
    }),
  );
  const ending = client.end();
  await vi.advanceTimersByTimeAsync(5001);
  await ending;
  expect(view.state).toBe("ended");
  expect(view.error).toContain("still confirming hangup");
  expect(Peer.instances[0].close).toHaveBeenCalled();
});
