import { readVoiceAiProvider } from "../agent/get-model";
import { computerStub } from "../cloud-computer/stub";
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

const LOOKUP_PREFIX = "voice-lookup:";
const MAX_LOOKUPS = 60;
interface Lookup {
  key: string;
  callId: string;
  delegationId: string;
  slug: string;
  startedAt: number;
  request: string;
  state: "running" | "finished" | "unknown";
  answer?: string;
}

const TRANSCRIPT_PREFIX = "pending-transcript:";
interface PendingTranscript {
  callId: string;
  slug: string;
  text: string;
}

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
  deliveredLookups?: string[];
}

// One coordinator per agent. Its alarm is independent of Think's scheduler.
// No recordings, SDP, API keys, or reflected audio are stored here.
export class VoiceCall extends DurableObject {
  private call: Call | undefined;
  private socket: WebSocket | undefined;
  private events: Promise<void> = Promise.resolve();
  private starting = false;
  private lookups: Lookup[] = [];
  private refreshing: Promise<void> | undefined;
  private transcriptDelivery: Promise<void> | undefined;
  private attaching: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.call = await ctx.storage.get<Call>("call");
      this.lookups = [
        ...(
          await ctx.storage.list<Lookup>({
            prefix: LOOKUP_PREFIX,
            limit: MAX_LOOKUPS,
          })
        ).values(),
      ];
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
    try {
      await this.flushTranscripts();
    } catch (error) {
      this.starting = false;
      throw error;
    }
    // Warm the optional reasoning runtime while GPT-Live starts independently.
    // A wake failure never tears down the audio call or changes its billing.
    this.ctx.waitUntil(
      readVoiceAiProvider(this.env.DB)
        .then(async (provider) => {
          if (provider === "cloud-computer" || provider === "boat-computer") {
            const response = await computerStub(this.env, provider).fetch(
              new Request("https://computer.internal/wake", { method: "POST" }),
            );
            await response.body?.cancel();
          }
        })
        .catch(() => {}),
    );
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
      await this.refreshLookups();
      // Existing outcomes are in the opening context; don't read them aloud
      // unprompted. Anything finishing after this snapshot is announced.
      const recent = this.lookups
        .filter((lookup) => lookup.slug === slug)
        .slice(-6);
      this.call.deliveredLookups = this.lookups
        .filter((lookup) => lookup.state !== "running")
        .map((lookup) => `${lookup.key}:${lookup.state}`);
      const taskContext = recent
        .map((lookup) => voiceChunks(this.lookupText(lookup)).join(""))
        .join("\n\n");
      if (this.call.state !== "starting") {
        this.call.state = "closed";
        await this.persist();
        await this.ctx.storage.deleteAlarm();
        return this.status();
      }
      const created = await createLiveSession(
        this.env.OPENAI_API_KEY,
        sdp,
        `${context}\n\nBackend lookup status (authoritative as of call start):\n${taskContext || "No tracked voice lookups."}`,
      );
      this.call.providerId = created.session.id;
      await this.persist();
      await this.attach();
      if (this.call.state !== "starting") {
        await this.end(callId);
        return this.status();
      }
      this.call.state = "active";
      await this.publishLookups();
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
    await this.flushTranscripts();
    if (this.call.state === "active") {
      // Check the OLD lease before extending it. Returning from a suspended
      // browser must not resurrect an expired call.
      if (Date.now() >= voiceDeadline(this.call) || !this.socket)
        await this.end(callId);
      else {
        this.call.heartbeatAt = Date.now();
        await this.refreshLookups();
        await this.publishLookups();
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
    const captions = appendCaption(call.captions, event);
    if (captions !== call.captions) call.transcriptSaved = false;
    call.captions = captions;
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
      // Save the outbox entry before marking closed or cancelling its alarm.
      // Recovery must still deliver captions if this isolate stops here.
      await this.queueTranscript(call);
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
      const transcript = captionText(call.captions);
      call.pendingTasks++;
      call.working = true;
      // Persist receipt before dispatch. A DO restart never replays a tool turn.
      await this.persist();
      const expired = this.lookups.find(
        (lookup) => lookup.state === "finished",
      );
      if (this.lookups.length >= MAX_LOOKUPS && expired) {
        this.lookups = this.lookups.filter((lookup) => lookup !== expired);
        await this.ctx.storage.delete(expired.key);
      }
      if (this.lookups.length >= MAX_LOOKUPS) {
        call.reason =
          "Too many unfinished lookups; check chat before starting more";
        await this.end(callId);
        return;
      }
      const lookup: Lookup = {
        key: `${LOOKUP_PREFIX}${Date.now()}:${callId}:${id}`,
        callId,
        delegationId: id,
        slug: call.slug,
        startedAt: Date.now(),
        request: transcript.slice(-1500),
        state: "running",
      };
      this.lookups.push(lookup);
      await this.ctx.storage.put(lookup.key, lookup);
      this.ctx.waitUntil(this.delegate(lookup, transcript));
      return;
    }
    if (event.type === "error") {
      call.reason = "Voice service reported an error";
      await this.end(callId);
      return;
    }
    await this.persist();
  }

  private lookupText(lookup: Lookup) {
    return `Backend lookup ${lookup.callId}/${lookup.delegationId}: ${lookup.state}. Original request context: ${lookup.request}\n${lookup.answer ?? "Submitted; no final result received yet. This is not evidence of ongoing progress."}`;
  }

  private async refreshLookups() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.reconcileLookups();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }

  private async reconcileLookups() {
    await Promise.all(
      this.lookups
        .filter(
          (lookup) =>
            lookup.state !== "finished" && Date.now() - lookup.startedAt > 5000,
        )
        .map(async (lookup) => {
          // Read durable results only. Recovery never replays inference or tools.
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const agent = await getAgentStub(this.env, lookup.slug);
            const result = await Promise.race([
              agent.getVoiceTaskResult(lookup.callId, lookup.delegationId),
              new Promise<null>((resolve) => {
                timer = setTimeout(() => resolve(null), 3000);
              }),
            ]);
            // A callback may have completed while the status RPC was in flight.
            if (lookup.state === "finished") return;
            lookup.state = result?.state ?? "unknown";
            lookup.answer = result
              ? result.answer?.slice(0, 16_000)
              : "Task status could not be verified. Check chat; do not claim the lookup is still running.";
            await this.ctx.storage.put(lookup.key, lookup);
          } catch {
            // Transport failure proves neither completion nor ongoing execution.
            if (lookup.state === "finished") return;
            lookup.state = "unknown";
            lookup.answer =
              "Task status could not be verified. Check the report in chat; do not claim the lookup is still running.";
            await this.ctx.storage.put(lookup.key, lookup);
          } finally {
            clearTimeout(timer);
          }
        }),
    );
  }

  private async publishLookups() {
    const call = this.call;
    if (!call || call.state !== "active") return;
    call.pendingTasks = this.lookups.filter(
      (lookup) => lookup.slug === call.slug && lookup.state === "running",
    ).length;
    call.working = call.pendingTasks > 0;
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    call.deliveredLookups ??= [];
    for (const lookup of this.lookups) {
      const receipt = `${lookup.key}:${lookup.state}`;
      if (
        lookup.slug !== call.slug ||
        lookup.state === "running" ||
        call.deliveredLookups.includes(receipt)
      )
        continue;
      // Completion is useful even after an interruption or hangup. Scope it to
      // the original request rather than treating all newer speech as cancellation.
      for (const content of voiceChunks(this.lookupText(lookup)))
        this.send({
          type: "session.commentary.append",
          delegation_id:
            lookup.callId === call.callId ? lookup.delegationId : null,
          content,
        });
      call.deliveredLookups = [...call.deliveredLookups.slice(-119), receipt];
    }
    await this.persist();
  }

  private async delegate(lookup: Lookup, transcript: string) {
    const call = this.call;
    if (!call || call.callId !== lookup.callId) return;
    // Read-only research dispatched by the turn keeps the lookup open; the
    // agent's durable task record reports the finish through reconciliation.
    let pending = false;
    try {
      // Caption/delegation streams can arrive out of order. Wait outside the
      // event queue so late caller captions can still arrive.
      if (
        !call.captions.some(
          (caption) => caption.role === "user" && caption.text.trim(),
        )
      ) {
        const deadline = Date.now() + 1500;
        while (
          Date.now() < deadline &&
          !call.captions.some(
            (caption) => caption.role === "user" && caption.text.trim(),
          )
        )
          await new Promise((resolve) => setTimeout(resolve, 50));
        transcript = captionText(call.captions);
        lookup.request = transcript.slice(-1500);
      }
      if (
        !call.captions.some(
          (caption) => caption.role === "user" && caption.text.trim(),
        )
      ) {
        lookup.answer =
          "I didn't receive enough of the question to look it up. Please repeat it.";
      } else {
        const agent = await getAgentStub(this.env, call.slug);
        const result = await agent.runVoiceTurn(
          lookup.callId,
          lookup.delegationId,
          transcript,
        );
        if (typeof result === "string") lookup.answer = result.slice(0, 16_000);
        else {
          lookup.answer = result.answer.slice(0, 16_000);
          pending = true;
        }
      }
    } catch {
      lookup.answer =
        "Downy could not complete that lookup. Please check the chat and try again there.";
    } finally {
      lookup.state = pending ? "running" : "finished";
      // This receipt belongs to the agent, not the audio session. A new call
      // may already be open by the time the original lookup returns.
      await this.ctx.storage.put(lookup.key, lookup);
      if (pending) await this.acknowledgeDispatch(lookup);
      await this.publishLookups();
    }
  }

  // Tell the caller once that research started. The lookup stays running, so
  // `publishLookups` skips it until the worker's finish is reconciled.
  private async acknowledgeDispatch(lookup: Lookup) {
    const call = this.call;
    if (!call || call.state !== "active" || call.callId !== lookup.callId)
      return;
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    call.deliveredLookups ??= [];
    const receipt = `${lookup.key}:dispatched`;
    if (call.deliveredLookups.includes(receipt)) return;
    for (const content of voiceChunks(this.lookupText(lookup)))
      this.send({
        type: "session.commentary.append",
        delegation_id: lookup.delegationId,
        content,
      });
    call.deliveredLookups = [...call.deliveredLookups.slice(-119), receipt];
    await this.persist();
  }

  private async saveTranscript(final = false) {
    const call = this.call;
    if (!call || (call.transcriptSaved && !final) || !call.captions.length)
      return;
    // Durable outbox: closing the provider or starting another call must not
    // discard captions when the agent is temporarily unavailable.
    await this.queueTranscript(call);
    await this.flushTranscripts();
  }

  private async queueTranscript(call: Call) {
    if (!call.captions.length) return;
    await this.ctx.storage.put<PendingTranscript>(
      `${TRANSCRIPT_PREFIX}${call.callId}`,
      {
        callId: call.callId,
        slug: call.slug,
        text: captionText(call.captions),
      },
    );
  }

  private async flushTranscripts(): Promise<void> {
    if (this.transcriptDelivery) return this.transcriptDelivery;
    this.transcriptDelivery = this.deliverTranscripts();
    try {
      await this.transcriptDelivery;
    } finally {
      this.transcriptDelivery = undefined;
    }
  }

  private async deliverTranscripts() {
    const pending = await this.ctx.storage.list<PendingTranscript>({
      prefix: TRANSCRIPT_PREFIX,
      limit: 10,
    });
    for (const [key, receipt] of pending) {
      try {
        const agent = await getAgentStub(this.env, receipt.slug);
        await agent.saveVoiceTranscript(receipt.callId, receipt.text);
        const latest = await this.ctx.storage.get<PendingTranscript>(key);
        // A final caption may have superseded this snapshot during delivery.
        if (latest?.text !== receipt.text) continue;
        await this.ctx.storage.delete(key);
        if (
          this.call?.callId === receipt.callId &&
          captionText(this.call.captions) === receipt.text
        ) {
          this.call.transcriptSaved = true;
          await this.persist();
        }
      } catch {
        // Retry the idempotent chat receipt, never the model/task itself.
        console.warn("[voice] transcript delivery pending");
      }
    }
    const remaining = await this.ctx.storage.list({
      prefix: TRANSCRIPT_PREFIX,
      limit: 1,
    });
    if (remaining.size) await this.ctx.storage.setAlarm(Date.now() + 15_000);
    else if (this.call?.state === "closed" || this.call?.state === "error")
      await this.ctx.storage.deleteAlarm();
  }

  override async alarm() {
    await this.flushTranscripts();
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
