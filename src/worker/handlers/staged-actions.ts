import { z } from "zod";
import { getActiveAgentStub } from "../lib/active-agent";
import { AgentSlugError } from "../lib/get-agent";

const headers = { "Cache-Control": "private, no-store" };

// Confirmation is a same-origin POST from the card, never a model tool call.
export async function handleStagedActionsRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (!["GET", "POST"].includes(request.method))
      return Response.json(
        { error: "Method not allowed" },
        { status: 405, headers },
      );
    if (
      request.method === "POST" &&
      request.headers.get("origin") !== url.origin
    )
      return Response.json(
        { error: "Invalid origin" },
        { status: 403, headers },
      );
    const id = url.searchParams.get("id");
    const confirming = url.searchParams.get("confirm") === "1";
    const cancelling = url.searchParams.get("cancel") === "1";
    if (
      !id ||
      !z.uuid().safeParse(id).success ||
      (request.method === "POST") === !(confirming !== cancelling)
    )
      return Response.json(
        { error: "Invalid proposal request" },
        { status: 400, headers },
      );
    const stub = await getActiveAgentStub(request, env);
    if (request.method === "GET") {
      const action = await stub.getStagedAction(id);
      return action
        ? Response.json({ action }, { headers })
        : Response.json(
            { error: "Proposal not found" },
            { status: 404, headers },
          );
    }
    if (cancelling) {
      const result = await stub.cancelStagedAction(id);
      return Response.json(result, {
        status: result.error ? 409 : 200,
        headers,
      });
    }
    const body = z
      .object({ revision: z.uuid() })
      .strict()
      .safeParse(await request.json().catch(() => null));
    if (!body.success)
      return Response.json(
        { error: "Confirm the proposal from its card." },
        { status: 400, headers },
      );
    const result = await stub.confirmStagedAction(id, body.data.revision);
    return Response.json(result, { status: result.error ? 409 : 200, headers });
  } catch (error) {
    if (error instanceof AgentSlugError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    return Response.json(
      { error: "Could not update the proposal. Reload chat and try again." },
      { status: 503, headers },
    );
  }
}
