import { getActiveAgentStub } from "../lib/active-agent";
import { slugFromRequest, AgentSlugError } from "../lib/get-agent";
import {
  createBuildroomJob,
  listBuildroomEvents,
  listBuildroomJobs,
} from "../buildroom/db";
import {
  BuildroomArtifactNameSchema,
  CreateBuildroomJobInputSchema,
} from "../buildroom/schemas";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function handleBuildroomRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const agentSlug = slugFromRequest(request);

    if (request.method === "GET" && parts.length === 2) {
      const jobs = await listBuildroomJobs(env.DB, agentSlug);
      return json({ jobs });
    }

    if (request.method === "POST" && parts.length === 2) {
      const input = CreateBuildroomJobInputSchema.parse(await request.json());
      const job = await createBuildroomJob(env.DB, { agentSlug, input });
      return json({ job }, 201);
    }

    const jobId = parts[2] ? decodeURIComponent(parts[2]) : null;
    if (request.method === "GET" && jobId && parts.length === 3) {
      const stub = await getActiveAgentStub(request, env);
      const detail = await stub.readBuildroomJob(jobId);
      return json(detail);
    }

    if (
      request.method === "GET" &&
      jobId &&
      parts.length === 4 &&
      parts[3] === "events"
    ) {
      return json({ events: await listBuildroomEvents(env.DB, jobId) });
    }

    if (
      request.method === "GET" &&
      jobId &&
      parts.length === 5 &&
      parts[3] === "artifacts"
    ) {
      const artifactName = BuildroomArtifactNameSchema.parse(
        decodeURIComponent(parts[4]),
      );
      const stub = await getActiveAgentStub(request, env);
      const artifact = await stub.readBuildroomArtifact(jobId, artifactName);
      return artifact ? json({ artifact }) : json({ error: "Not found" }, 404);
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    if (err instanceof AgentSlugError) {
      return json({ error: err.message, code: err.code }, err.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/buildroom] failed", {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: message }, 500);
  }
}
