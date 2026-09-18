import { verifyAccessJwt } from "../auth/cloudflare-access";
import { slugFromRequest } from "../lib/get-agent";
import { composio, ToolListSchema } from "../composio/client";
import {
  pollComposioSetup,
  SetupInputSchema,
  startComposioSetup,
} from "../composio/setup";
export async function handleComposioRequest(
  request: Request,
  env: Cloudflare.Env,
) {
  try {
    const identity = await verifyAccessJwt(request, env);
    if (!identity.ok)
      return Response.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    const slug = slugFromRequest(request);
    const url = new URL(request.url);
    if (request.method === "GET" && url.searchParams.has("toolkit")) {
      return Response.json(
        ToolListSchema.parse(
          await composio(
            env.COMPOSIO_API_KEY,
            `/tools?toolkit_slug=${encodeURIComponent(url.searchParams.get("toolkit")!)}&limit=1000`,
          ),
        ),
      );
    }
    if (request.method === "POST")
      return Response.json(
        await startComposioSetup(
          env,
          slug,
          identity.sub,
          SetupInputSchema.parse(await request.json()),
        ),
      );
    if (request.method === "GET" && url.searchParams.has("setupId"))
      return Response.json(
        await pollComposioSetup(
          env,
          slug,
          url.searchParams.get("setupId")!,
          identity.sub,
        ),
      );
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch {
    return Response.json(
      { state: "failed", toolNames: [], error: "Managed setup failed" },
      { status: 400 },
    );
  }
}
