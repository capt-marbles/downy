import { z } from "zod";

export const VOICE_MODEL = "gpt-live-1";
export const VOICE_MAX_MS = 15 * 60_000;
export const VOICE_LEASE_MS = 60_000;
export const VOICE_IDLE_MS = 2 * 60_000;

export const VoiceCommandSchema = z.discriminatedUnion("command", [
  z
    .object({
      command: z.literal("start"),
      callId: z.uuid(),
      sdp: z.string().min(1).max(64_000),
    })
    .strict(),
  z.object({ command: z.literal("heartbeat"), callId: z.uuid() }).strict(),
  z.object({ command: z.literal("end"), callId: z.uuid() }).strict(),
]);

export const VoiceStatusSchema = z.object({
  callId: z.string(),
  state: z.enum(["starting", "active", "closing", "closed", "error"]),
  startedAt: z.number(),
  expiresAt: z.number(),
  reason: z.string().nullable(),
  working: z.boolean(),
  sdp: z.string().optional(),
});
export type VoiceStatus = z.infer<typeof VoiceStatusSchema>;

export const LiveEventSchema = z.object({
  type: z.string(),
  event_id: z.string().optional(),
  delta: z.string().max(16_000).optional(),
  start_ms: z.number().optional(),
  end_ms: z.number().optional(),
  offset_ms: z.number().optional(),
  delegation: z
    .object({ id: z.string().max(200), target: z.string() })
    .optional(),
  session: z.object({ expires_at: z.number().optional() }).optional(),
  usage: z.object({ seconds: z.number().nonnegative() }).optional(),
});

export interface VoiceCaption {
  role: "user" | "assistant";
  text: string;
  startMs: number;
  endMs: number;
}

// Deltas include their own whitespace. Never trim or deduplicate words:
// "no, no" can be a meaningful correction. Times are approximate captions.
export function appendCaption(
  captions: VoiceCaption[],
  event: z.infer<typeof LiveEventSchema>,
): VoiceCaption[] {
  if (
    !event.delta ||
    ![
      "session.input_transcript.delta",
      "session.output_transcript.delta",
    ].includes(event.type)
  )
    return captions;
  const role =
    event.type === "session.input_transcript.delta" ? "user" : "assistant";
  const startMs = event.start_ms ?? 0;
  const endMs = event.end_ms ?? startMs;
  const next = captions.map((item) => ({ ...item }));
  const last = next.at(-1);
  if (
    last?.role === role &&
    startMs - last.endMs < 1500 &&
    last.text.length < 4000
  ) {
    last.text += event.delta;
    last.endMs = endMs;
  } else next.push({ role, text: event.delta, startMs, endMs });
  // Bounded rolling context; the UI explicitly labels it live captions.
  while (
    next.length > 60 ||
    (next.length > 1 && next.reduce((n, c) => n + c.text.length, 0) > 24_000)
  )
    next.shift();
  return next;
}

export function captionText(captions: VoiceCaption[]): string {
  return captions
    .map((c) => `${c.role === "user" ? "You" : "Downy"}: ${c.text}`)
    .join("\n");
}

// UTF-8 bytes are a conservative upper bound for byte-level tokenizer tokens.
// Live append events allow 500 tokens. Leave room for framing, and bound totals.
export function voiceChunks(text: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let bytes = 0;
  for (const character of text) {
    const size = new TextEncoder().encode(character).length;
    if (bytes + size > 420) {
      chunks.push(chunk);
      if (chunks.length === 7)
        return [...chunks, "The full answer and sources are in your chat."];
      chunk = "";
      bytes = 0;
    }
    chunk += character;
    bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
