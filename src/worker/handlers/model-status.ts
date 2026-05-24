import { getActiveAgentStub } from "../lib/active-agent";
import { AgentSlugError } from "../lib/get-agent";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function handleModelStatusRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }
  try {
    const stub = await getActiveAgentStub(request, env);
    const modelStatus = await stub.getModelStatus();
    return json({ modelStatus });
  } catch (err) {
    if (err instanceof AgentSlugError) {
      return json({ error: err.message, code: err.code }, err.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/model-status] failed", {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: message }, 500);
  }
}
