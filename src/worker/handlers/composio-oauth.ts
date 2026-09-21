import { pipelineFailure } from "../runbooks/pipeline-report";
import { PipelineReportInputSchema } from "../../lib/airtable-connect";
import { verifyAccessJwt } from "../auth/cloudflare-access";
import { getActiveAgentStub } from "../lib/active-agent";
import { getAgentStub, slugFromRequest } from "../lib/get-agent";
import { getAgent } from "../db/profile";
import { z } from "zod";

const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
const redirect = (location: string) =>
  new Response(null, {
    status: 303,
    headers: { ...headers, Location: location },
  });

export async function handleComposioOAuthRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && request.headers.get("origin") !== url.origin)
    return Response.json({ error: "Invalid origin" }, { status: 403, headers });
  const identity = await verifyAccessJwt(request, env);
  if (!identity.ok)
    return Response.json(
      { error: "Authentication required" },
      { status: 401, headers },
    );
  try {
    // User-scoped across bots and Preferences, isolated from every other user.
    const hash = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(identity.sub),
      ),
    );
    const owner = `__composio-${Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join("")}`;
    const vault = await getAgentStub(env, owner);
    const path = url.pathname;
    if (request.method === "GET" && path === "/api/composio/oauth") {
      const status = await vault.getComposioOAuthStatus();
      if (url.searchParams.has("agentSlug")) {
        const agent = await getActiveAgentStub(request, env);
        if (status.state === "connected") await agent.bindComposioOwner(owner);
        await agent.recordManagedStatus({ composio: status });
      }
      return Response.json(status, { headers });
    }
    if (path.startsWith("/api/composio/oauth/airtable"))
      return await handleAirtableOAuth(request, env, vault, owner);
    if (path.startsWith("/api/composio/oauth/slack"))
      return await handleSlackOAuth(request, env, vault, owner);
    if (request.method === "GET" && path === "/api/composio/oauth/gmail") {
      const agent = await getActiveAgentStub(request, env);
      const composio = await vault.getComposioOAuthStatus();
      const gmail = await vault.getComposioGmailStatus(true);
      const authorized = await agent.isGmailOwner(owner);
      await agent.recordManagedStatus({
        composio,
        gmail: { ...gmail, authorized },
      });
      if (authorized && gmail.state === "ready" && gmail.email)
        await agent.notifyGmailReady(gmail.email);
      return Response.json({ ...gmail, authorized }, { headers });
    }
    if (
      request.method === "POST" &&
      path === "/api/composio/oauth/gmail/select"
    ) {
      const agent = await getActiveAgentStub(request, env);
      if (!(await agent.isGmailOwner(owner)))
        return Response.json(
          { error: "Connect Gmail for this bot first." },
          { status: 403, headers },
        );
      const input = z
        .object({ accountId: z.string().min(1).max(200) })
        .strict()
        .safeParse(await request.json());
      if (!input.success)
        return Response.json(
          { error: "Choose a Gmail account." },
          { status: 400, headers },
        );
      await vault.selectComposioGmail(input.data.accountId);
      const gmail = await vault.getComposioGmailStatus();
      const composio = await vault.getComposioOAuthStatus();
      await agent.recordManagedStatus({
        composio,
        gmail: { ...gmail, authorized: true },
      });
      if (gmail.state === "ready" && gmail.email)
        await agent.notifyGmailReady(gmail.email);
      return Response.json({ ...gmail, authorized: true }, { headers });
    }
    if (
      request.method === "POST" &&
      path === "/api/composio/oauth/gmail/start"
    ) {
      const agent = await getActiveAgentStub(request, env);
      await agent.authorizeGmailOwner(owner);
      const result = await vault.startComposioGmail();
      return redirect(
        result.redirectUrl ??
          `/agent/${encodeURIComponent(slugFromRequest(request))}`,
      );
    }
    if (request.method === "POST" && path === "/api/composio/oauth/start") {
      await getActiveAgentStub(request, env);
      return redirect(
        await vault.startComposioOAuth(url.origin, slugFromRequest(request)),
      );
    }
    if (request.method === "POST" && path === "/api/composio/oauth/card") {
      const agent = await getActiveAgentStub(request, env);
      await agent.showComposioConnectCard();
      return Response.json({ state: "ready" }, { headers });
    }
    if (
      request.method === "POST" &&
      path === "/api/composio/oauth/disconnect"
    ) {
      await vault.disconnectComposioOAuth();
      return Response.json({ state: "disconnected" }, { headers });
    }
    if (request.method === "GET" && path === "/api/composio/oauth/callback") {
      const outcome = await vault.completeComposioOAuth(
        url.searchParams.get("state") ?? "",
        url.searchParams.get("code"),
        url.searchParams.has("error"),
      );
      const agent = await getAgent(env.DB, outcome.agentSlug);
      if (agent && agent.archivedAt === null) {
        const stub = await getAgentStub(env, outcome.agentSlug);
        await stub.showComposioConnectCard(outcome.state);
        return redirect(`/agent/${encodeURIComponent(outcome.agentSlug)}`);
      }
      return redirect("/settings");
    }
    return Response.json({ error: "Not found" }, { status: 404, headers });
  } catch {
    // Never serialize OAuth/provider errors or callback query parameters.
    if (url.pathname.endsWith("/callback")) return redirect("/settings");
    return Response.json(
      {
        error: url.pathname.includes("/airtable")
          ? "Could not verify Airtable. Your Composio sign-in is preserved; retry the connection card."
          : url.pathname.includes("/gmail")
            ? "Could not verify Gmail. Your authorization is preserved; retry the status check."
            : "Could not complete Composio setup. Please retry from Preferences.",
      },
      { status: 503, headers },
    );
  }
}

// Called only after Access identity and same-origin POST checks above.
async function handleAirtableOAuth(
  request: Request,
  env: Cloudflare.Env,
  vault: Awaited<ReturnType<typeof getAgentStub>>,
  owner: string,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (
    path === "/api/composio/oauth/airtable/check" &&
    request.method === "POST"
  ) {
    const agent = await getActiveAgentStub(request, env);
    if (!(await agent.isAirtableOwner(owner)))
      return Response.json(
        { error: "Connect Airtable for this bot first." },
        { status: 403, headers },
      );
    const input = z
      .object({
        baseId: z
          .string()
          .regex(/^app[a-zA-Z0-9]+$/)
          .max(100),
      })
      .strict()
      .safeParse(await request.json());
    if (!input.success)
      return Response.json(
        { error: "A valid base ID is required." },
        { status: 400, headers },
      );
    return Response.json(
      await vault.checkComposioAirtableSchema(input.data.baseId),
      { headers },
    );
  }
  if (
    path === "/api/composio/oauth/airtable/pipeline-report" &&
    request.method === "POST"
  ) {
    const agent = await getActiveAgentStub(request, env);
    if (!(await agent.isAirtableOwner(owner)))
      return Response.json(
        { error: "Connect Airtable for this bot first." },
        { status: 403, headers },
      );
    const input = PipelineReportInputSchema.safeParse(await request.json());
    if (!input.success)
      return Response.json(
        { error: "Select the base, table and stage field from the schema." },
        { status: 400, headers },
      );
    try {
      return Response.json(await agent.runPipelineReport(input.data), {
        headers,
      });
    } catch (error) {
      return Response.json(pipelineFailure(error), { status: 502, headers });
    }
  }
  if (path === "/api/composio/oauth/airtable" && request.method === "GET") {
    const agent = await getActiveAgentStub(request, env);
    const composio = await vault.getComposioOAuthStatus();
    const airtable = await vault.getComposioAirtableStatus(true);
    const authorized = await agent.isAirtableOwner(owner);
    await agent.recordManagedStatus({
      composio,
      airtable: { ...airtable, authorized },
    });
    if (authorized && airtable.state === "ready" && airtable.identity)
      await agent.notifyAirtableReady(airtable.identity);
    return Response.json({ ...airtable, authorized }, { headers });
  }
  if (
    path === "/api/composio/oauth/airtable/start" &&
    request.method === "POST"
  ) {
    const agent = await getActiveAgentStub(request, env);
    await agent.authorizeAirtableOwner(owner);
    const result = await vault.startComposioAirtable();
    return redirect(
      result.redirectUrl ??
        `/agent/${encodeURIComponent(slugFromRequest(request))}`,
    );
  }
  if (
    path === "/api/composio/oauth/airtable/select" &&
    request.method === "POST"
  ) {
    const agent = await getActiveAgentStub(request, env);
    if (!(await agent.isAirtableOwner(owner)))
      return Response.json(
        { error: "Connect Airtable for this bot first." },
        { status: 403, headers },
      );
    const input = z
      .object({ accountId: z.string().min(1).max(200) })
      .strict()
      .safeParse(await request.json());
    if (!input.success)
      return Response.json(
        { error: "Choose an Airtable account." },
        { status: 400, headers },
      );
    await vault.selectComposioAirtable(input.data.accountId);
    const airtable = await vault.getComposioAirtableStatus();
    const composio = await vault.getComposioOAuthStatus();
    await agent.recordManagedStatus({
      composio,
      airtable: { ...airtable, authorized: true },
    });
    if (airtable.state === "ready" && airtable.identity)
      await agent.notifyAirtableReady(airtable.identity);
    return Response.json({ ...airtable, authorized: true }, { headers });
  }
  return Response.json({ error: "Not found" }, { status: 404, headers });
}

async function handleSlackOAuth(
  request: Request,
  env: Cloudflare.Env,
  vault: Awaited<ReturnType<typeof getAgentStub>>,
  owner: string,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/api/composio/oauth/slack" && request.method === "GET") {
    const agent = await getActiveAgentStub(request, env);
    const composio = await vault.getComposioOAuthStatus();
    const slack = await vault.getComposioSlackStatus(true);
    const authorized = await agent.isSlackOwner(owner);
    await agent.recordManagedStatus({
      composio,
      slack: { ...slack, authorized },
    });
    if (authorized && slack.state === "ready" && slack.identity)
      await agent.notifySlackReady(slack.identity);
    return Response.json({ ...slack, authorized }, { headers });
  }
  if (path === "/api/composio/oauth/slack/start" && request.method === "POST") {
    const agent = await getActiveAgentStub(request, env);
    await agent.authorizeSlackOwner(owner);
    const result = await vault.startComposioSlack();
    return redirect(
      result.redirectUrl ??
        `/agent/${encodeURIComponent(slugFromRequest(request))}`,
    );
  }
  if (
    path === "/api/composio/oauth/slack/select" &&
    request.method === "POST"
  ) {
    const agent = await getActiveAgentStub(request, env);
    if (!(await agent.isSlackOwner(owner)))
      return Response.json(
        { error: "Connect Slack for this bot first." },
        { status: 403, headers },
      );
    const input = z
      .object({ accountId: z.string().min(1).max(200) })
      .strict()
      .safeParse(await request.json());
    if (!input.success)
      return Response.json(
        { error: "Choose a Slack workspace connection." },
        { status: 400, headers },
      );
    await vault.selectComposioSlack(input.data.accountId);
    const slack = await vault.getComposioSlackStatus();
    const composio = await vault.getComposioOAuthStatus();
    await agent.recordManagedStatus({
      composio,
      slack: { ...slack, authorized: true },
    });
    if (slack.state === "ready" && slack.identity)
      await agent.notifySlackReady(slack.identity);
    return Response.json({ ...slack, authorized: true }, { headers });
  }
  return Response.json({ error: "Not found" }, { status: 404, headers });
}
