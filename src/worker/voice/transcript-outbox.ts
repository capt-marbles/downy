import { captionText, type VoiceCaption } from "../../lib/voice";
import { getAgentStub } from "../lib/get-agent";

/**
 * Durable outbox for call captions. Closing the provider or starting another
 * call must not discard a transcript while the chat agent is temporarily
 * unavailable, so captions are queued in the coordinator's storage and the
 * idempotent chat receipt is retried by alarm until it lands.
 */
const TRANSCRIPT_PREFIX = "pending-transcript:";
interface PendingTranscript {
  callId: string;
  slug: string;
  text: string;
}

export async function queueTranscript(
  storage: DurableObjectStorage,
  call: { callId: string; slug: string; captions: VoiceCaption[] },
): Promise<void> {
  if (!call.captions.length) return;
  await storage.put<PendingTranscript>(`${TRANSCRIPT_PREFIX}${call.callId}`, {
    callId: call.callId,
    slug: call.slug,
    text: captionText(call.captions),
  });
}

export async function deliverTranscripts(deps: {
  storage: DurableObjectStorage;
  env: Cloudflare.Env;
  /** The live call, so a delivered snapshot can be marked saved on it. */
  current: () =>
    | { callId: string; captions: VoiceCaption[]; state: string }
    | undefined;
  markSaved: () => Promise<void>;
}): Promise<void> {
  const pending = await deps.storage.list<PendingTranscript>({
    prefix: TRANSCRIPT_PREFIX,
    limit: 10,
  });
  for (const [key, receipt] of pending) {
    try {
      const agent = await getAgentStub(deps.env, receipt.slug);
      await agent.saveVoiceTranscript(receipt.callId, receipt.text);
      const latest = await deps.storage.get<PendingTranscript>(key);
      // A final caption may have superseded this snapshot during delivery.
      if (latest?.text !== receipt.text) continue;
      await deps.storage.delete(key);
      const call = deps.current();
      if (
        call?.callId === receipt.callId &&
        captionText(call.captions) === receipt.text
      )
        await deps.markSaved();
    } catch {
      // Retry the idempotent chat receipt, never the model/task itself.
      console.warn("[voice] transcript delivery pending");
    }
  }
  const remaining = await deps.storage.list({
    prefix: TRANSCRIPT_PREFIX,
    limit: 1,
  });
  const call = deps.current();
  if (remaining.size) await deps.storage.setAlarm(Date.now() + 15_000);
  else if (call?.state === "closed" || call?.state === "error")
    await deps.storage.deleteAlarm();
}
