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
import {
  createWorkflowTemplate,
  getWorkflowDetailOrThrow,
  listWorkflowTemplates,
  recordWorkflowGateDecision,
  startBuildroomWorkflow,
  advanceBuildroomWorkflow,
} from "../buildroom/workflow-db";
import {
  AdvanceWorkflowInputSchema,
  CreateWorkflowTemplateInputSchema,
  RecordGateDecisionInputSchema,
  StartWorkflowInputSchema,
} from "../buildroom/workflows";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function handleWorkflowRoutes(args: {
  request: Request;
  env: Cloudflare.Env;
  parts: string[];
  agentSlug: string;
}): Promise<Response | null> {
  const { request, env, parts, agentSlug } = args;
  if (parts[2] === "workflows") {
    if (request.method === "GET" && parts.length === 3) {
      return json({
        templates: await listWorkflowTemplates(env.DB, agentSlug),
      });
    }

    if (request.method === "POST" && parts.length === 3) {
      const input = CreateWorkflowTemplateInputSchema.parse(
        await request.json(),
      );
      const template = await createWorkflowTemplate(env.DB, {
        agentSlug,
        input,
      });
      return json({ template }, 201);
    }

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[3] === "start"
    ) {
      const input = StartWorkflowInputSchema.parse(await request.json());
      const workflow = await startBuildroomWorkflow(env.DB, {
        agentSlug,
        input,
      });
      return json({ workflow }, 201);
    }
  }

  const workflowJobId = parts[3] ? decodeURIComponent(parts[3]) : null;
  if (parts[2] !== "workflow-runs" || !workflowJobId) return null;

  if (request.method === "GET" && parts.length === 4) {
    return json({
      workflow: await getWorkflowDetailOrThrow(env.DB, workflowJobId),
    });
  }

  if (
    request.method === "POST" &&
    parts.length === 5 &&
    parts[4] === "advance"
  ) {
    const body = await request.json();
    const input = AdvanceWorkflowInputSchema.parse({
      ...(typeof body === "object" && body !== null ? body : {}),
      jobId: workflowJobId,
    });
    return json({ workflow: await advanceBuildroomWorkflow(env.DB, input) });
  }

  if (request.method === "POST" && parts.length === 5 && parts[4] === "gate") {
    const body = await request.json();
    const input = RecordGateDecisionInputSchema.parse({
      ...(typeof body === "object" && body !== null ? body : {}),
      jobId: workflowJobId,
    });
    return json({ workflow: await recordWorkflowGateDecision(env.DB, input) });
  }

  return null;
}

export async function handleBuildroomRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const agentSlug = slugFromRequest(request);

    const workflowResponse = await handleWorkflowRoutes({
      request,
      env,
      parts,
      agentSlug,
    });
    if (workflowResponse) return workflowResponse;

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
