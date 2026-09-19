import { ResearchViewModeSchema } from "../../lib/research-view";
import { getActiveAgentStub } from "../lib/active-agent";
import { AgentSlugError } from "../lib/get-agent";

const headers = { "Cache-Control": "private, no-store" };
export async function handleResearchViewRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  try {
    if (request.method !== "GET" && request.method !== "POST")
      return Response.json(
        { error: "Method not allowed" },
        { status: 405, headers },
      );
    const url = new URL(request.url);
    if (
      request.method === "POST" &&
      request.headers.get("origin") !== url.origin
    )
      return Response.json(
        { error: "Invalid origin" },
        { status: 403, headers },
      );
    const mode = ResearchViewModeSchema.safeParse(
      url.searchParams.get("view") ?? "all",
    );
    if (!mode.success)
      return Response.json(
        { error: "Unknown research view" },
        { status: 400, headers },
      );
    const stub = await getActiveAgentStub(request, env);
    const snapshot =
      request.method === "POST"
        ? await stub.composeResearchView(mode.data)
        : await stub.getResearchView();
    return Response.json({ snapshot }, { headers });
  } catch (error) {
    if (error instanceof AgentSlugError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    return Response.json(
      {
        error:
          "Could not load the research view. Your files are still available in Files.",
      },
      { status: 503, headers },
    );
  }
}
