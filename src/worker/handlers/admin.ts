import { z } from "zod";

import { listAgents } from "../db/profile";
import { getAgentStub } from "../lib/get-agent";

const CONFIRM_RESET = "CONFIRM RESET DOWNY STATE";
const JSON_HEADERS = { "content-type": "application/json" };

const ResetRequestSchema = z.object({
  confirmation: z.literal(CONFIRM_RESET),
  scope: z.enum(["all_agents", "default_agent"]),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function handleAdminRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/reset-state") {
    return json({ error: "Not found" }, 404);
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = ResetRequestSchema.parse(await request.json());
    const slugs =
      body.scope === "all_agents"
        ? (await listAgents(env.DB)).map((agent) => agent.slug)
        : ["default"];

    const results = [];
    for (const slug of slugs) {
      const stub = await getAgentStub(env, slug);
      results.push(await stub.resetAgentStateForOperator());
    }

    return json({ ok: true, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/admin/reset-state] failed", {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: message }, 500);
  }
}
