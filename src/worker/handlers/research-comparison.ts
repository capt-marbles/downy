import { z } from "zod";
import { ComparisonFeedbackSchema } from "../../lib/research-comparison";
import { getActiveAgentStub } from "../lib/active-agent";
import { AgentSlugError } from "../lib/get-agent";
const headers = { "Cache-Control": "private, no-store" };
export async function handleResearchComparisonRequest(
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
    const ticket = z.uuid().safeParse(url.searchParams.get("ticket"));
    if (!ticket.success)
      return Response.json(
        { error: "Invalid ticket" },
        { status: 400, headers },
      );
    const stub = await getActiveAgentStub(request, env);
    if (request.method === "GET")
      return Response.json(
        { run: await stub.getComparison(ticket.data) },
        { headers },
      );
    if (url.searchParams.get("op") === "start")
      return Response.json(
        { run: await stub.startComparison(ticket.data) },
        { headers },
      );
    if (url.searchParams.get("op") !== "feedback")
      return Response.json(
        { error: "Unknown operation" },
        { status: 400, headers },
      );
    const body = ComparisonFeedbackSchema.omit({ createdAt: true })
      .extend({ runId: z.uuid() })
      .strict()
      .safeParse(await request.json().catch(() => null));
    if (!body.success)
      return Response.json(
        { error: "Invalid feedback" },
        { status: 400, headers },
      );
    return Response.json(
      {
        run: await stub.recordComparisonFeedback(ticket.data, body.data.runId, {
          ...body.data,
          createdAt: Date.now(),
        }),
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof AgentSlugError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    return Response.json(
      {
        error:
          "Could not update the comparison. Check the saved sources and reload before retrying.",
      },
      { status: 503, headers },
    );
  }
}
