import { verifyAccessJwt } from "../auth/cloudflare-access";
import { slugFromRequest } from "../lib/get-agent";
import { getActiveAgentStub } from "../lib/active-agent";
import { composio, ToolListSchema } from "../composio/client";
import { readSecret } from "../credentials/crypto";
import { GMAIL_PILOT_TOOLS } from "../../lib/composio";
import {
  pollComposioSetup,
  SetupInputSchema,
  startComposioSetup,
} from "../composio/setup";
const headers = { "Cache-Control": "private, no-store" };
export async function handleComposioRequest(
  request: Request,
  env: Cloudflare.Env,
) {
  try {
    const url = new URL(request.url);
    if (
      request.method === "POST" &&
      request.headers.get("origin") !== url.origin
    )
      return Response.json(
        { error: "Invalid origin" },
        { status: 403, headers },
      );
    const identity = await verifyAccessJwt(request, env);
    if (!identity.ok)
      return Response.json(
        { error: "Authentication required" },
        { status: 401, headers },
      );
    const slug = slugFromRequest(request);
    const agent = await getActiveAgentStub(request, env);
    if (request.method === "POST" && url.searchParams.has("card")) {
      await agent.showGmailConnectCard();
      return Response.json({ state: "ready" }, { headers });
    }
    let configured = false;
    try {
      await readSecret(env.COMPOSIO_API_KEY);
      await readSecret(env.CREDENTIAL_KEY);
      configured = true;
    } catch {
      /* Never expose binding diagnostics. */
    }
    if (request.method === "GET" && url.searchParams.has("gmail")) {
      const connection = await env.DB.prepare(
        "SELECT id FROM composio_connections WHERE agent_slug = ? AND user_id = ? AND toolkit = 'gmail' ORDER BY created_at DESC LIMIT 1",
      )
        .bind(slug, identity.sub)
        .first<{ id: string }>();
      if (!configured || !connection)
        return Response.json(
          {
            configured,
            setupId: null,
            state: "not_connected",
            toolNames: [],
            error: null,
          },
          { headers },
        );
      const outcome = await pollComposioSetup(
        env,
        slug,
        connection.id,
        identity.sub,
      );
      const redirectUrl =
        outcome.state === "pending"
          ? await agent.getComposioLink(connection.id, identity.sub)
          : null;
      return Response.json(
        {
          configured,
          setupId: connection.id,
          ...outcome,
          ...(redirectUrl ? { redirectUrl } : {}),
        },
        { headers },
      );
    }
    if (!configured)
      return Response.json(
        {
          state: "failed",
          toolNames: [],
          error: "Composio administrator setup is required",
        },
        { status: 503, headers },
      );
    if (request.method === "GET" && url.searchParams.has("toolkit")) {
      const toolkit = url.searchParams.get("toolkit")!;
      const list = ToolListSchema.parse(
        await composio(
          env.COMPOSIO_API_KEY,
          `/tools?toolkit_slug=${encodeURIComponent(toolkit)}&limit=1000`,
        ),
      );
      if (toolkit === "gmail")
        list.items = list.items.filter((tool) =>
          GMAIL_PILOT_TOOLS.some((allowed) => allowed === tool.slug),
        );
      return Response.json(list, { headers });
    }
    if (request.method === "POST") {
      // Repeated taps resume the existing authorization rather than creating accounts.
      const input = SetupInputSchema.parse(await request.json());
      if (input.toolkit === "gmail") {
        const pending = await env.DB.prepare(
          "SELECT id FROM composio_connections WHERE agent_slug = ? AND user_id = ? AND toolkit = 'gmail' AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
        )
          .bind(slug, identity.sub, Date.now())
          .first<{ id: string }>();
        const link = pending
          ? await agent.getComposioLink(pending.id, identity.sub)
          : null;
        if (link && pending)
          return Response.json(
            { kind: "oauth", setupId: pending.id, redirectUrl: link },
            { headers },
          );
      }
      return Response.json(
        await startComposioSetup(env, slug, identity.sub, input),
        { headers },
      );
    }
    if (request.method === "GET" && url.searchParams.has("setupId"))
      return Response.json(
        await pollComposioSetup(
          env,
          slug,
          url.searchParams.get("setupId")!,
          identity.sub,
        ),
        { headers },
      );
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers },
    );
  } catch {
    return Response.json(
      {
        state: "failed",
        toolNames: [],
        error: "Managed setup failed. Retry or check the connection settings.",
      },
      { status: 400, headers },
    );
  }
}
