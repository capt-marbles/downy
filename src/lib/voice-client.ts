import { agentFetch } from "./agent-request";
import {
  appendCaption,
  LiveEventSchema,
  VoiceStatusSchema,
  type VoiceCaption,
} from "./voice";

export interface CallView {
  state: "idle" | "connecting" | "live" | "ending" | "ended";
  muted: boolean;
  working: boolean;
  needsPlayback: boolean;
  startedAt: number | null;
  captions: VoiceCaption[];
  error: string | null;
  /** Server-reported cap for this deployment, known after setup is read. */
  maxMinutes: number | null;
  /** The last call ended by an interruption; a tap may start a new one. */
  canReconnect: boolean;
}

const initialView = (): CallView => ({
  state: "idle",
  muted: false,
  working: false,
  needsPlayback: false,
  startedAt: null,
  captions: [],
  error: null,
  maxMinutes: null,
  canReconnect: false,
});

// Own all browser resources in one disposable object. React unmount, pagehide,
// permission races, failed SDP exchange, and hangup share the same teardown.
export class VoiceClient {
  private view = initialView();
  private pc?: RTCPeerConnection;
  private stream?: MediaStream;
  private channel?: RTCDataChannel;
  private timer?: ReturnType<typeof setInterval>;
  private setupTimer?: ReturnType<typeof setTimeout>;
  private abort?: AbortController;
  private callId?: string;
  private generation = 0;
  private disposed = false;
  private seen = new Set<string>();
  private heartbeatPending = false;
  private providerClosed = false;
  private closeReceived?: () => void;
  private readonly onPageHide = () => {
    void this.end();
  };
  private readonly onVisibility = () => {
    if (document.hidden) void this.end();
  };

  constructor(
    private slug: string,
    private audio: Pick<HTMLAudioElement, "play" | "pause" | "srcObject">,
    private changed: (view: CallView) => void,
  ) {
    window.addEventListener("pagehide", this.onPageHide);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private update(patch: Partial<CallView>) {
    this.view = { ...this.view, ...patch };
    if (!this.disposed) this.changed(this.view);
  }

  private async request(body: object, keepalive = false) {
    const response = await agentFetch(this.slug, "/api/voice", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      keepalive,
      signal: keepalive ? AbortSignal.timeout(10_000) : this.abort?.signal,
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Your sign-in expired. Refresh Downy and sign in again."
          : "Voice could not connect. Check server setup or end any other open call.",
      );
    return VoiceStatusSchema.parse(await response.json());
  }

  async start() {
    if (
      this.disposed ||
      ["connecting", "live", "ending"].includes(this.view.state)
    )
      return;
    const generation = ++this.generation;
    this.abort = new AbortController();
    this.providerClosed = false;
    this.update({
      ...initialView(),
      state: "connecting",
      maxMinutes: this.view.maxMinutes,
    });
    this.setupTimer = setTimeout(() => {
      void this.end("Voice connection timed out. Please try again.");
    }, 45_000);
    // Try to activate playback within the original tap. If Safari still blocks
    // it, expose an explicit Enable sound button rather than a silent call.
    void this.audio.play().catch(() => undefined);
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof RTCPeerConnection === "undefined"
      )
        throw new Error(
          "Voice needs a microphone-enabled browser over HTTPS. Text and dictation remain available.",
        );
      const config = await agentFetch(this.slug, "/api/voice", {
        signal: this.abort.signal,
      });
      const body: unknown = await config.json();
      if (
        !config.ok ||
        !body ||
        typeof body !== "object" ||
        !("configured" in body) ||
        body.configured !== true
      )
        throw new Error(
          "Voice needs server setup: enable GPT-Live and add the OpenAI key to Cloudflare Secrets Store. Never paste a key into chat.",
        );
      if (generation !== this.generation) return;
      if ("maxMinutes" in body && typeof body.maxMinutes === "number")
        this.update({ maxMinutes: body.maxMinutes });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const pc = new RTCPeerConnection();
      this.pc = pc;
      this.seen.clear();
      const callId = crypto.randomUUID();
      this.callId = callId;
      pc.addEventListener("track", (event) => {
        if (generation !== this.generation) return;
        this.audio.srcObject =
          event.streams[0] ?? new MediaStream([event.track]);
        void this.play();
      });
      pc.addEventListener("connectionstatechange", () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected"
        )
          void this.interrupt(
            "Connection interrupted. Reconnect to start a new call.",
          );
      });
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      const channel = pc.createDataChannel("oai-events");
      this.channel = channel;
      channel.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        try {
          const parsed = LiveEventSchema.safeParse(JSON.parse(event.data));
          if (!parsed.success) return;
          const data = parsed.data;
          if (data.type === "session.closed") {
            this.providerClosed = true;
            this.closeReceived?.();
            // A close we did not ask for (provider expiry, server cap) is an
            // interruption; a close after our own hangup is already handled.
            if (generation === this.generation)
              void this.interrupt("The call ended. Reconnect to continue.");
            return;
          }
          if (generation !== this.generation) return;
          if (data.event_id && this.seen.has(data.event_id)) return;
          if (data.event_id) {
            this.seen.add(data.event_id);
            if (this.seen.size > 512)
              this.seen.delete(this.seen.values().next().value ?? "");
          }
          if (data.type === "session.started") {
            clearTimeout(this.setupTimer);
            this.update({ state: "live" });
          }
          if (data.type === "error") {
            void this.interrupt(
              "The voice service interrupted the call. Please check the chat.",
            );
            return;
          }
          this.update({ captions: appendCaption(this.view.captions, data) });
        } catch {
          /* Ignore malformed provider events; never render raw errors. */
        }
      });
      channel.addEventListener("close", () => {
        if (generation === this.generation)
          void this.interrupt("Voice connection closed.");
      });
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIce(pc, this.abort.signal);
      if (generation !== this.generation) return;
      const result = await this.request({
        command: "start",
        callId,
        sdp: pc.localDescription?.sdp,
      });
      if (generation !== this.generation) return;
      if (result.state !== "active" || !result.sdp)
        throw new Error(
          result.reason ?? "Voice did not start. Please try again later.",
        );
      this.update({ startedAt: result.startedAt });
      await pc.setRemoteDescription({ type: "answer", sdp: result.sdp });
      if (generation !== this.generation) return;
      this.timer = setInterval(() => {
        void this.heartbeat(generation);
      }, 10_000);
    } catch (error) {
      if (generation !== this.generation) return;
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow it in your browser settings, then start a call."
          : error instanceof Error
            ? error.message
            : "Could not start voice.";
      await this.end(message);
    }
  }

  private async heartbeat(generation: number) {
    if (this.heartbeatPending || !this.callId) return;
    this.heartbeatPending = true;
    try {
      const result = await this.request(
        { command: "heartbeat", callId: this.callId },
        true,
      );
      if (generation !== this.generation) return;
      if (result.state !== "active") {
        await this.interrupt(result.reason ?? "Call ended");
        return;
      }
      this.update({ working: result.working });
    } catch {
      if (generation === this.generation)
        await this.interrupt(
          "Connection lost. The call is ending; text chat is still available.",
        );
    } finally {
      this.heartbeatPending = false;
    }
  }

  mute() {
    if (this.view.state !== "live") return;
    const muted = !this.view.muted;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    if (this.channel?.readyState === "open")
      this.channel.send(
        JSON.stringify({
          type: muted
            ? "session.input_audio.mute"
            : "session.input_audio.unmute",
          event_id: crypto.randomUUID(),
        }),
      );
    this.update({ muted });
  }

  async play() {
    try {
      await this.audio.play();
      this.update({ needsPlayback: false });
    } catch {
      this.update({ needsPlayback: true });
    }
  }

  // An interruption ends the call exactly like a hangup, then offers a new
  // call. Nothing reconnects on its own: a new call is a new paid session
  // and a deliberate tap, and lookups still running finish into it.
  private interrupt(error: string) {
    return this.end(error, true);
  }

  async end(error: string | null = null, interrupted = false) {
    if (["ending", "ended", "idle"].includes(this.view.state)) return;
    this.update({ state: "ending", error, canReconnect: false });
    ++this.generation;
    const callId = this.callId;
    this.callId = undefined;
    if (this.channel?.readyState === "open")
      this.channel.send(
        JSON.stringify({
          type: "session.close",
          event_id: crypto.randomUUID(),
        }),
      );
    this.abort?.abort();
    clearInterval(this.timer);
    clearTimeout(this.setupTimer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.audio.pause();
    this.audio.srcObject = null;
    let finalError = error;
    if (callId) {
      try {
        const result = await this.request({ command: "end", callId }, true);
        this.providerClosed ||= result.state === "closed";
      } catch {
        finalError ??=
          "Microphone stopped. Server hangup could not be confirmed; the disconnect timeout will close the call.";
      }
    }
    // Keep the primary connection alive to receive final usage, with the mic
    // already stopped. A bounded wait is essential when the network is gone.
    if (callId && !this.providerClosed && this.channel?.readyState === "open") {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.closeReceived = undefined;
          resolve();
        }, 5000);
        this.closeReceived = () => {
          clearTimeout(timer);
          this.closeReceived = undefined;
          resolve();
        };
      });
    }
    if (callId && !this.providerClosed)
      finalError ??=
        "Microphone stopped. The server is still confirming hangup; do not start another call until it finishes.";
    this.channel?.close();
    this.pc?.close();
    this.pc = undefined;
    this.channel = undefined;
    this.update({
      state: "ended",
      working: false,
      error: finalError,
      canReconnect: interrupted && !this.disposed,
    });
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("visibilitychange", this.onVisibility);
    void this.end();
  }
}

async function waitForIce(
  pc: RTCPeerConnection,
  signal: AbortSignal,
): Promise<void> {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", changed);
      signal.removeEventListener("abort", aborted);
    };
    const changed = () => {
      if (pc.iceGatheringState === "complete") {
        cleanup();
        resolve();
      }
    };
    const aborted = () => {
      cleanup();
      reject(new Error("Call cancelled"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Could not establish the audio connection. Check your network.",
        ),
      );
    }, 10_000);
    pc.addEventListener("icegatheringstatechange", changed);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    else changed();
  });
}
