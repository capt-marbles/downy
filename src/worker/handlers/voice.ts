import { VoiceCommandSchema, VOICE_MODEL } from "../../lib/voice";
import { voiceMaxMs } from "../voice/limits";
import { getActiveAgentStub } from "../lib/active-agent";
import { AgentSlugError, slugFromRequest } from "../lib/get-agent";
import { readSecret } from "../credentials/crypto";

const headers = { "Cache-Control": "no-store" };

// Authentication stays at server.ts's existing Cloudflare Access chokepoint.
export async function handleVoiceRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  try {
    await getActiveAgentStub(request, env);
    if (request.method === "GET") {
      const configured =
        env.DOWNY_VOICE_ENABLED === "true" &&
        Boolean(await readSecret(env.OPENAI_API_KEY).catch(() => ""));
      return Response.json(
        {
          configured,
          model: VOICE_MODEL,
          maxMinutes: voiceMaxMs(env) / 60_000,
        },
        { headers },
      );
    }
    if (request.method !== "POST")
      return Response.json(
        { error: "Method not allowed" },
        { status: 405, headers },
      );
    // Browser-only commands. No credential-bearing cross-origin posts.
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return Response.json(
        { error: "Invalid origin" },
        { status: 403, headers },
      );
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return Response.json(
        { error: "JSON required" },
        { status: 415, headers },
      );
    // Enforce the actual streamed length, not just an untrusted Content-Length.
    const reader = request.body?.getReader();
    if (!reader)
      return Response.json({ error: "Missing body" }, { status: 400, headers });
    let size = 0;
    let text = "";
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 70_000) {
        await reader.cancel();
        return Response.json(
          { error: "Voice request too large" },
          { status: 413, headers },
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const parsed = VoiceCommandSchema.safeParse(JSON.parse(text));
    if (!parsed.success)
      return Response.json(
        { error: "Invalid voice request" },
        { status: 400, headers },
      );
    const command = parsed.data;
    const slug = slugFromRequest(request);
    const call = env.VoiceCall.getByName(slug);
    if (command.command === "start") {
      if (env.DOWNY_VOICE_ENABLED !== "true")
        return Response.json(
          {
            error:
              "Voice needs server setup. Ask the operator to enable GPT-Live in Downy; keep API keys out of chat.",
          },
          { status: 503, headers },
        );
      const result = await call.start(slug, command.callId, command.sdp);
      return Response.json(result, { headers });
    }
    const result =
      command.command === "end"
        ? await call.end(command.callId)
        : await call.heartbeat(command.callId);
    return result
      ? Response.json(result, { headers })
      : Response.json({ error: "Call not found" }, { status: 404, headers });
  } catch (error) {
    if (error instanceof AgentSlugError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    if (error instanceof SyntaxError)
      return Response.json({ error: "Invalid JSON" }, { status: 400, headers });
    // No provider bodies, SDP, transcripts, or secrets in error/log output.
    return Response.json(
      {
        error:
          "Voice is unavailable or a call is already open. Text chat is still available.",
      },
      { status: 503, headers },
    );
  }
}
