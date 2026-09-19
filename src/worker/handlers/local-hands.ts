import { assertFetchUpload, inboxPath } from "../local-hands/upload";
import { z } from "zod";
import { BrowserResearchSchema } from "../../lib/browser-research";

import {
  AgentSlugError,
  getAgentStub,
  slugFromRequest,
} from "../lib/get-agent";
import {
  getLocalHandsActionOrThrow,
  claimNextLocalHandsAction,
  completeLocalHandsAction,
  confirmLocalHandsAction,
  heartbeatLocalHandsConnector,
  listLocalHandsActions,
  localHandsQueueStatus,
  requestLocalHandsAction,
} from "../local-hands/db";
import {
  ConfirmLocalHandsActionInputSchema,
  LocalHandsClaimInputSchema,
  LocalHandsCompleteInputSchema,
  LocalHandsHeartbeatInputSchema,
  RequestLocalHandsActionInputSchema,
} from "../local-hands/types";

const JSON_HEADERS = { "content-type": "application/json" };
const UnknownRecordSchema = z.record(z.string(), z.unknown());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function readObjectBody(
  request: Request,
): Promise<Record<string, unknown>> {
  return UnknownRecordSchema.catch({}).parse(await request.json());
}

export async function handleLocalHandsRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const agentSlug = slugFromRequest(request);

    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[3] === "upload"
    ) {
      const action = await getLocalHandsActionOrThrow(
        env.DB,
        decodeURIComponent(parts[2]),
      );
      const connectorId = request.headers.get("x-connector-id") ?? "";
      try {
        assertFetchUpload(action, agentSlug, connectorId);
      } catch {
        return json(
          { error: "Upload is not authorized for this claimed action" },
          403,
        );
      }
      const maxBytes = Number(env.DOWNY_MAX_FETCH_BYTES ?? 25 * 1024 * 1024);
      const length = Number(request.headers.get("content-length") ?? 0);
      if (length > maxBytes)
        return json(
          { error: `File size ${length} exceeds ${maxBytes} bytes` },
          413,
        );
      const destName = request.headers.get("x-dest-name") ?? "";
      const expectedName =
        action.input.destName ??
        String(action.input.sourcePath).split("/").pop();
      if (destName !== expectedName || !request.body)
        return json({ error: "Invalid upload destination or body" }, 400);
      const path = inboxPath(connectorId, destName);
      const agent = await getAgentStub(env, agentSlug);
      try {
        return json(
          await agent.writeWorkspaceFileBytes(path, request.body, maxBytes),
        );
      } catch (error) {
        if (String(error).includes("FETCH_TOO_LARGE"))
          return json({ error: String(error) }, 413);
        throw error;
      }
    }

    if (request.method === "GET" && parts.length === 2) {
      const includeCompleted =
        url.searchParams.get("includeCompleted") === "true";
      return json({
        actions: await listLocalHandsActions(env.DB, {
          agentSlug,
          includeCompleted,
        }),
        ...(await localHandsQueueStatus(env.DB, agentSlug)),
      });
    }

    if (request.method === "POST" && parts.length === 2) {
      const input = RequestLocalHandsActionInputSchema.parse(
        await readObjectBody(request),
      );
      return json(
        { action: await requestLocalHandsAction(env.DB, { agentSlug, input }) },
        201,
      );
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[2] === "confirm"
    ) {
      const input = ConfirmLocalHandsActionInputSchema.parse(
        await readObjectBody(request),
      );
      return json({ action: await confirmLocalHandsAction(env.DB, input) });
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[2] === "heartbeat"
    ) {
      const input = LocalHandsHeartbeatInputSchema.parse(
        await readObjectBody(request),
      );
      return json({
        connector: await heartbeatLocalHandsConnector(env.DB, agentSlug, input),
      });
    }

    if (
      request.method === "POST" &&
      parts.length === 3 &&
      parts[2] === "claim"
    ) {
      const input = LocalHandsClaimInputSchema.parse(
        await readObjectBody(request),
      );
      return json({
        action: await claimNextLocalHandsAction(env.DB, { agentSlug, input }),
      });
    }

    const actionId = parts[2] ? decodeURIComponent(parts[2]) : null;
    if (
      request.method === "POST" &&
      actionId &&
      parts.length === 4 &&
      parts[3] === "complete"
    ) {
      return await completeAction(request, env, actionId, agentSlug);
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    if (err instanceof z.ZodError)
      return json({ error: "Invalid local hands request or result" }, 400);
    if (err instanceof AgentSlugError) {
      return json({ error: err.message, code: err.code }, err.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/local-hands] failed", {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: message }, 500);
  }
}

async function completeAction(
  request: Request,
  env: Cloudflare.Env,
  actionId: string,
  agentSlug: string,
): Promise<Response> {
  const input = LocalHandsCompleteInputSchema.parse(
    await readObjectBody(request),
  );
  const current = await getLocalHandsActionOrThrow(env.DB, actionId);
  if (
    current.agentSlug !== agentSlug ||
    current.claimedBy !== input.connectorId ||
    !["claimed", "completed", "failed"].includes(current.status)
  )
    return json({ error: "Completion is not authorized for this action" }, 403);
  const browser = current.kind === "browser" || current.kind === "x.research";
  if (current.status === "claimed" && browser && input.status === "completed")
    input.result = BrowserResearchSchema.parse(input.result);
  const action =
    current.status === "claimed"
      ? await completeLocalHandsAction(env.DB, { actionId, input })
      : current;
  // Retry even after D1 completion: a transient DO/R2 failure must not lose
  // delivery. Never replace the canonical result with a retry's payload.
  if (browser && action.status === "completed") {
    const agent = await getAgentStub(env, agentSlug);
    await agent.saveBrowserResearch(action.id, action.result);
  }
  return json({ action });
}
