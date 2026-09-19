import { DurableObject } from "cloudflare:workers";
import {
  appendCaption,
  captionText,
  LiveEventSchema,
  VOICE_MAX_MS,
  VOICE_MODEL,
  voiceChunks,
  type VoiceCaption,
  type VoiceStatus,
} from "../../lib/voice";
import { getAgentStub } from "../lib/get-agent";
import {
  attachLiveSession,
  createLiveSession,
  VoiceProviderError,
} from "./provider";
import { voiceDeadline } from "./policy";

interface Call extends VoiceStatus {
  slug: string;
  providerId?: string;
  heartbeatAt: number;
  activityAt: number;
  captions: VoiceCaption[];
  seen: string[];
  delegations: string[];
  inputRevision: number;
  transcriptSaved: boolean;
  usageSeconds?: number;
  pendingTasks: number;
  closeAttempts: number;
}

// One coordinator per agent. Its alarm is independent of Think's scheduler.
// No recordings, SDP, API keys, or reflected audio are stored here.
export class VoiceCall extends DurableObject {
  private call: Call | undefined;
  private socket: WebSocket | undefined;
  private events: Promise<void> = Promise.resolve();
  private starting = false;
  private attaching: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.call = await ctx.storage.get<Call>("call");
    });
  }

  private status(sdp?: string): VoiceStatus {
    const call = this.call;
    if (!call) throw new Error("No call");
    return {
      callId: call.callId,
      state: call.state,
      startedAt: call.startedAt,
      expiresAt: call.expiresAt,
      reason: call.reason,
      working: call.working,
      ...(sdp ? { sdp } : {}),
    };
  }

  private async persist() {
    if (this.call) await this.ctx.storage.put("call", this.call);
  }

  async start(slug: string, callId: string, sdp: string): Promise<VoiceStatus> {
    if (
      this.starting ||
      (this.call && this.call.state !== "closed" && this.call.state !== "error")
    ) {
      throw new Error(
        "A call is already open for this agent. End it before starting another.",
      );
    }
    // Never replay a creation request after a network retry; the original may
    // already be billed. A fresh explicit button press uses a fresh call ID.
    if (this.call?.callId === callId) return this.status();
    this.starting = true;
    const now = Date.now();
    this.call = {
      callId,
      slug,
      state: "starting",
      startedAt: now,
      expiresAt: now + VOICE_MAX_MS,
      heartbeatAt: now,
      activityAt: now,
      reason: null,
      working: false,
      captions: [],
      seen: [],
      delegations: [],
      inputRevision: 0,
      transcriptSaved: false,
      pendingTasks: 0,
      closeAttempts: 0,
    };
    try {
      await this.persist();
      await this.ctx.storage.setAlarm(now + 30_000);
      const agent = await getAgentStub(this.env, slug);
      const context = await agent.getVoiceContext();
      if (this.call.state !== "starting") {
        this.call.state = "closed";
        await this.persist();
        await this.ctx.storage.deleteAlarm();
        return this.status();
      }
      const created = await createLiveSession(
        this.env.OPENAI_API_KEY,
        sdp,
        context,
      );
      this.call.providerId = created.session.id;
      await this.persist();
      await this.attach();
      if (this.call.state !== "starting") {
        await this.end(callId);
        return this.status();
      }
      this.call.state = "active";
      await this.persist();
      await this.ctx.storage.setAlarm(voiceDeadline(this.call));
      return this.status(created.transport.sdp);
    } catch (error) {
      this.call.reason =
        error instanceof VoiceProviderError
          ? error.message
          : "Voice setup failed or timed out. Text chat is still available; the call will not retry automatically.";
      if (this.call.providerId) {
        this.call.state = "closing";
        await this.persist();
        await this.ctx.storage.setAlarm(Date.now() + 1000);
      } else {
        this.call.state = "error";
        await this.persist();
        await this.ctx.storage.deleteAlarm();
      }
      return this.status();
    } finally {
      this.starting = false;
    }
  }

  async heartbeat(callId: string): Promise<VoiceStatus | null> {
    if (this.call?.callId !== callId) return null;
    if (this.call.state === "active") {
      // Check the OLD lease before extending it. Returning from a suspended
      // browser must not resurrect an expired call.
      if (Date.now() >= voiceDeadline(this.call) || !this.socket)
        await this.end(callId);
      else {
        this.call.heartbeatAt = Date.now();
        await this.persist();
        await this.ctx.storage.setAlarm(voiceDeadline(this.call));
      }
    }
    return this.status();
  }

  async end(callId: string): Promise<VoiceStatus | null> {
    if (this.call?.callId !== callId) return null;
    if (this.call.state === "closed" || this.call.state === "error")
      return this.status();
    if (!this.call.providerId && !this.starting) {
      // Recovery after an interrupted create cannot safely replay that create.
      this.call.state = "error";
      this.call.reason =
        "Voice setup was interrupted before a session ID was saved. Finalization is unconfirmed; no automatic retry was made.";
      await this.persist();
      await this.ctx.storage.deleteAlarm();
      return this.status();
    }
    this.call.state = "closing";
    this.call.reason ??= "Call ended";
    await this.persist();
    // Keep the coordinator alive until session.closed confirms finalization.
    // If setup is still in flight, start() attaches and closes when it returns.
    this.call.closeAttempts++;
    await this.ctx.storage.setAlarm(
      Date.now() + Math.min(300_000, 15_000 * this.call.closeAttempts),
    );
    if (this.call.providerId) {
      try {
        await this.attach();
        this.send({ type: "session.close" });
      } catch (error) {
        if (
          error instanceof VoiceProviderError &&
          (error.status === 404 || error.status === 410)
        ) {
          // A vanished session cannot be attached again. Record uncertainty,
          // never fabricate a session.closed event or final usage.
          this.call.state = "error";
          this.call.reason =
            "The provider session is no longer available. Final usage could not be confirmed.";
          await this.persist();
          await this.ctx.storage.deleteAlarm();
        }
        // Other failures retain the alarm for close after network recovery.
      }
    }
    await this.saveTranscript();
    return this.status();
  }

  private async attach(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.attaching) return this.attaching;
    this.attaching = this.connectSideband();
    try {
      await this.attaching;
    } finally {
      this.attaching = undefined;
    }
  }

  private async connectSideband() {
    if (!this.call?.providerId) return;
    const callId = this.call.callId;
    const socket = await attachLiveSession(
      this.env.OPENAI_API_KEY,
      this.call.providerId,
    );
    if (this.call?.callId !== callId || this.call.state === "closed") {
      socket.close(1000, "Call already ended");
      return;
    }
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data.length > 1_000_000)
        return;
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = LiveEventSchema.safeParse(data);
      if (!parsed.success) return;
      // Audio arrives on the sideband too. Discard immediately; no logs/history.
      if (
        parsed.data.type.includes("audio") &&
        !parsed.data.type.includes("transcript")
      )
        return;
      this.events = this.events
        .then(() => this.onEvent(callId, parsed.data))
        .catch(() => this.end(callId).then(() => undefined));
      this.ctx.waitUntil(this.events);
    });
    const lost = () => {
      if (this.socket === socket) this.socket = undefined;
      if (this.call?.callId === callId && this.call.state === "active") {
        this.call.reason =
          "Voice connection interrupted. Start a new call when connected.";
        this.ctx.waitUntil(this.end(callId));
      }
    };
    socket.addEventListener("close", lost);
    socket.addEventListener("error", lost);
  }

  private send(event: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(
        JSON.stringify({ event_id: crypto.randomUUID(), ...event }),
      );
  }

  private async onEvent(
    callId: string,
    event: ReturnType<typeof LiveEventSchema.parse>,
  ) {
    const call = this.call;
    if (!call || call.callId !== callId || call.state === "closed") return;
    if (event.event_id && call.seen.includes(event.event_id)) return;
    if (event.event_id) call.seen = [...call.seen.slice(-255), event.event_id];
    call.captions = appendCaption(call.captions, event);
    if (event.type === "session.input_transcript.delta" && event.delta) {
      call.activityAt = Date.now();
      call.inputRevision++;
    }
    if (event.type === "session.started" && event.session?.expires_at)
      call.expiresAt = Math.min(
        call.expiresAt,
        event.session.expires_at * 1000,
      );
    if (event.type === "session.closed") {
      call.usageSeconds = event.usage?.seconds;
      call.state = "closed";
      call.working = false;
      await this.persist();
      await this.ctx.storage.put(`usage:${callId}`, {
        callId,
        model: VOICE_MODEL,
        startedAt: call.startedAt,
        endedAt: Date.now(),
        seconds: call.usageSeconds ?? null,
        finalization: "confirmed",
      });
      await this.ctx.storage.deleteAlarm();
      this.socket?.close(1000, "Call ended");
      this.socket = undefined;
      // Include any final captions arriving between hangup and session.closed.
      await this.saveTranscript(true);
      return;
    }
    if (
      event.type === "session.delegation.created" &&
      event.delegation?.target === "client" &&
      call.state === "active"
    ) {
      const id = event.delegation.id;
      if (call.delegations.includes(id)) return;
      if (call.delegations.length >= 30) {
        call.reason = "Call task limit reached";
        await this.end(callId);
        return;
      }
      call.delegations.push(id);
      const revision = call.inputRevision;
      const transcript = captionText(call.captions);
      call.pendingTasks++;
      call.working = true;
      // Persist receipt before dispatch. A DO restart never replays a tool turn.
      await this.persist();
      this.ctx.waitUntil(this.delegate(callId, id, revision, transcript));
      return;
    }
    if (event.type === "error") {
      call.reason = "Voice service reported an error";
      await this.end(callId);
      return;
    }
    await this.persist();
  }

  private async delegate(
    callId: string,
    id: string,
    revision: number,
    transcript: string,
  ) {
    const call = this.call;
    if (!call) return;
    try {
      if (!transcript.trim()) {
        this.send({
          type: "session.commentary.append",
          delegation_id: id,
          content:
            "I didn't receive enough of the question to look it up. Please repeat it.",
        });
        return;
      }
      const agent = await getAgentStub(this.env, call.slug);
      const answer = await agent.runVoiceTurn(callId, id, transcript);
      if (this.call?.callId !== callId || this.call.state !== "active") return;
      const type =
        this.call.inputRevision === revision
          ? "session.commentary.append"
          : "session.thinking.append";
      for (const content of voiceChunks(answer))
        this.send({ type, delegation_id: id, content });
    } catch {
      if (this.call?.callId === callId && this.call.state === "active")
        this.send({
          type: "session.commentary.append",
          delegation_id: id,
          content:
            "Downy could not complete that lookup. Please check the chat and try again there.",
        });
    } finally {
      if (this.call?.callId === callId) {
        this.call.pendingTasks = Math.max(0, this.call.pendingTasks - 1);
        this.call.working =
          this.call.state === "active" && this.call.pendingTasks > 0;
        await this.persist();
      }
    }
  }

  private async saveTranscript(final = false) {
    const call = this.call;
    if (!call || (call.transcriptSaved && !final) || !call.captions.length)
      return;
    const agent = await getAgentStub(this.env, call.slug);
    await agent.saveVoiceTranscript(call.callId, captionText(call.captions));
    call.transcriptSaved = true;
    await this.persist();
  }

  override async alarm() {
    const call = this.call;
    if (!call || call.state === "closed" || call.state === "error") return;
    if (
      call.state === "active" &&
      this.socket &&
      Date.now() < voiceDeadline(call)
    ) {
      await this.ctx.storage.setAlarm(voiceDeadline(call));
      return;
    }
    call.reason ??= "Call timed out or disconnected";
    await this.end(call.callId);
  }
}
