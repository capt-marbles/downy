import { z } from "zod";
import { PilotOptionIdSchema } from "../../lib/pilot-choices";
import { getActiveAgentStub } from "../lib/active-agent";
import { AgentSlugError } from "../lib/get-agent";
const headers = { "Cache-Control": "private, no-store" };
export async function handlePilotChoicesRequest(
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
    const id = url.searchParams.get("ticket");
    const option = url.searchParams.get("option");
    if (
      (id && !z.uuid().safeParse(id).success) ||
      (option && !PilotOptionIdSchema.safeParse(option).success) ||
      (!id && option)
    )
      return Response.json(
        { error: "Invalid choice request" },
        { status: 400, headers },
      );
    const stub = await getActiveAgentStub(request, env);
    if (request.method === "GET") {
      if (!id)
        return Response.json(
          { error: "Missing ticket" },
          { status: 400, headers },
        );
      const choice = await stub.getPilotChoice(id);
      return choice
        ? Response.json({ choice }, { headers })
        : Response.json(
            { error: "Choice not found" },
            { status: 404, headers },
          );
    }
    if (!id)
      return Response.json(
        { choice: await stub.createPilotChoices() },
        { headers },
      );
    if (!option)
      return Response.json(
        { error: "Missing option" },
        { status: 400, headers },
      );
    const result = await stub.selectPilotChoice(
      id,
      PilotOptionIdSchema.parse(option),
    );
    return Response.json(result, { status: result.error ? 409 : 200, headers });
  } catch (error) {
    if (error instanceof AgentSlugError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    return Response.json(
      { error: "Could not update pilot choices. Reload chat and try again." },
      { status: 503, headers },
    );
  }
}
