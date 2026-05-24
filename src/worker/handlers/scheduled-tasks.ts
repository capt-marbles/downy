import { slugFromRequest } from "../lib/get-agent";
import { AgentSlugError } from "../lib/get-agent";
import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
  updateScheduledTask,
} from "../scheduled-tasks/db";
import {
  CreateScheduledTaskInputSchema,
  UpdateScheduledTaskInputSchema,
} from "../scheduled-tasks/types";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function handleScheduledTasksRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const id = scheduledTaskId(url.pathname);
    if (request.method === "GET" && !id) {
      const agentSlug = slugFromRequest(request);
      const includeDisabled = url.searchParams.get("all") === "1";
      const scheduledTasks = await listScheduledTasks(env.DB, {
        agentSlug,
        includeDisabled,
      });
      return json({ scheduledTasks });
    }
    if (request.method === "POST" && !id) {
      const agentSlug = slugFromRequest(request);
      const body = CreateScheduledTaskInputSchema.omit({
        agentSlug: true,
      }).parse(await request.json());
      const scheduledTask = await createScheduledTask(env.DB, {
        ...body,
        agentSlug,
      });
      return json({ scheduledTask }, 201);
    }
    if (request.method === "PATCH" && id) {
      const body = UpdateScheduledTaskInputSchema.parse(await request.json());
      const scheduledTask = await updateScheduledTask(env.DB, id, body);
      return json({ scheduledTask });
    }
    if (request.method === "DELETE" && id) {
      await deleteScheduledTask(env.DB, id);
      return json({ ok: true });
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    if (err instanceof AgentSlugError) {
      return json({ error: err.message, code: err.code }, err.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/scheduled-tasks] failed", {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: message }, 500);
  }
}

function scheduledTaskId(pathname: string): string | null {
  const prefix = "/api/scheduled-tasks/";
  if (!pathname.startsWith(prefix)) return null;
  const raw = pathname.slice(prefix.length);
  return raw ? decodeURIComponent(raw) : null;
}
