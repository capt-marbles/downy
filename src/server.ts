import { handleComposioOAuthRequest } from "./worker/handlers/composio-oauth";
import { handleResearchComparisonRequest } from "./worker/handlers/research-comparison";
import { handleCloudComputerRequest } from "./worker/handlers/cloud-computer";
import { handleResearchViewRequest } from "./worker/handlers/research-view";
import { handlePilotChoicesRequest } from "./worker/handlers/pilot-choices";
import { handleCorpusRequest } from "./worker/handlers/corpus";
import { handleVoiceRequest } from "./worker/handlers/voice";
import { reconcileCorpus } from "./worker/corpus/runner";
import { handleComposioRequest } from "./worker/handlers/composio";
import { handleCredentialsRequest } from "./worker/handlers/credentials";
import tanstackEntry from "@tanstack/react-start/server-entry";
import { routeAgentRequest } from "agents";

import { handleAdminRequest } from "./worker/handlers/admin";
import { verifyAccessJwt } from "./worker/auth/cloudflare-access";
import { handleAgentsRequest } from "./worker/handlers/agents";
import { handleBuildroomRequest } from "./worker/handlers/buildroom";
import { handleBootstrapRequest } from "./worker/handlers/bootstrap";
import { handleCampaignRoomRequest } from "./worker/handlers/campaign-room";
import { handleFilesRequest } from "./worker/handlers/files";
import { handleBackgroundTasksRequest } from "./worker/handlers/background-tasks";
import { handleMcpServersRequest } from "./worker/handlers/mcp-servers";
import { handleLocalHandsRequest } from "./worker/handlers/local-hands";
import { handleMessagesRequest } from "./worker/handlers/messages";
import { handleModelStatusRequest } from "./worker/handlers/model-status";
import { handleProfileRequest } from "./worker/handlers/profile";
import { handleScheduledTasksRequest } from "./worker/handlers/scheduled-tasks";
import { handleSkillsRequest } from "./worker/handlers/skills";
import { handleSystemStatusRequest } from "./worker/handlers/system";
import { handleTranscribeRequest } from "./worker/handlers/transcribe";
import { runDueScheduledTasks } from "./worker/scheduled-tasks/runner";
import { getAgent, listAgents } from "./worker/db/profile";

export * from "@tanstack/react-start/server-entry";
export { DownyAgent } from "./worker/agent/DownyAgent";
export { ChildAgent } from "./worker/agent/ChildAgent";
export { BoatComputer } from "./worker/boat-computer/BoatComputer";
export { CloudComputer } from "./worker/cloud-computer/CloudComputer";
export { WorkspaceProxy } from "@cloudflare/computer";
export { VoiceCall } from "./worker/voice/VoiceCall";

function isApiOrSocketRequest(url: URL, request: Request): boolean {
  if (url.pathname.startsWith("/api/")) return true;
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket")
    return true;
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

function isLocalDevHost(url: URL): boolean {
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname.endsWith(".localhost")
  );
}

const AGENT_PAGE_RE = /^\/agent\/([^/]+)(?:\/|$)/;

async function redirectInvalidAgentPage(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (isApiOrSocketRequest(url, request)) return null;

  const match = AGENT_PAGE_RE.exec(url.pathname);
  if (!match) return null;

  let slug: string | null = null;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    // Invalid percent-encoding is not a valid agent route.
  }

  const agent = slug ? await getAgent(env.DB, slug) : null;
  if (agent && agent.archivedAt === null) return null;

  const fallback = (await listAgents(env.DB))[0]?.slug;
  const pathname = fallback ? `/agent/${encodeURIComponent(fallback)}` : "/";
  return Response.redirect(new URL(pathname, request.url).toString(), 302);
}

const exactRoutes = new Map([
  ["/api/composio", handleComposioRequest],
  ["/api/research-view", handleResearchViewRequest],
  ["/api/research-comparison", handleResearchComparisonRequest],
  ["/api/pilot-choices", handlePilotChoicesRequest],
]);

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);

    // Cloudflare Access gate. Single chokepoint for every request — REST
    // handlers, the agent WebSocket, and TanStack SSR all flow through here.
    // Bypassed for `vite dev` on localhost. `import.meta.env.DEV` is a
    // Vite build-time constant (true in dev, false in prod), so the bypass
    // branch is dead-code-eliminated from the deployed bundle — no env var
    // to forget to unset.
    const localNoAuth = import.meta.env.DEV && isLocalDevHost(url);
    if (!localNoAuth) {
      const access = await verifyAccessJwt(request, env);
      if (url.pathname === "/unauthenticated") {
        // Bounce back to / once the user has actually signed in — otherwise
        // refreshing the unauth page strands them there even after Access
        // hands them a valid JWT.
        if (access.ok) {
          return Response.redirect(new URL("/", request.url).toString(), 302);
        }
      } else if (!access.ok) {
        if (isApiOrSocketRequest(url, request)) {
          return Response.json(
            { error: "unauthenticated", reason: access.reason },
            { status: 401 },
          );
        }
        // Redirect (not internal rewrite) so the browser's URL becomes
        // /unauthenticated. With a rewrite, SSR returns the unauth body but
        // window.location is still the original path — the client router
        // then hydrates the original route and the unauth page flashes away.
        return Response.redirect(
          new URL("/unauthenticated", request.url).toString(),
          302,
        );
      }
    }

    const agentPageRedirect = await redirectInvalidAgentPage(request, env);
    if (agentPageRedirect) return agentPageRedirect;

    if (url.pathname.startsWith("/api/boat-computer"))
      return handleCloudComputerRequest(request, env, "boat-computer");
    if (url.pathname.startsWith("/api/cloud-computer"))
      return handleCloudComputerRequest(request, env);

    if (url.pathname === "/api/voice") return handleVoiceRequest(request, env);
    const exactHandler = exactRoutes.get(url.pathname);
    if (exactHandler) return exactHandler(request, env);

    if (
      url.pathname === "/api/admin/reset-state" ||
      url.pathname.startsWith("/api/admin/")
    ) {
      return handleAdminRequest(request, env);
    }

    if (
      url.pathname === "/api/agents" ||
      url.pathname.startsWith("/api/agents/")
    ) {
      return handleAgentsRequest(request, env);
    }

    if (url.pathname.startsWith("/api/profile/")) {
      return handleProfileRequest(request, env);
    }

    if (url.pathname.startsWith("/api/bootstrap/")) {
      return handleBootstrapRequest(request, env);
    }

    if (url.pathname.startsWith("/api/files/")) {
      return handleFilesRequest(request, env);
    }

    if (url.pathname.startsWith("/api/messages/")) {
      return handleMessagesRequest(request, env);
    }

    if (url.pathname === "/api/transcribe") {
      return handleTranscribeRequest(request, env);
    }

    if (url.pathname === "/api/background-tasks") {
      return handleBackgroundTasksRequest(request, env);
    }

    if (
      url.pathname === "/api/scheduled-tasks" ||
      url.pathname.startsWith("/api/scheduled-tasks/")
    ) {
      return handleScheduledTasksRequest(request, env);
    }

    if (
      url.pathname === "/api/campaign-room" ||
      url.pathname.startsWith("/api/campaign-room/")
    ) {
      return handleCampaignRoomRequest(request, env);
    }

    if (
      url.pathname === "/api/buildroom" ||
      url.pathname.startsWith("/api/buildroom/")
    ) {
      return handleBuildroomRequest(request, env);
    }

    if (url.pathname.startsWith("/api/corpus"))
      return handleCorpusRequest(request, env);
    if (/^\/api\/composio\/oauth(?:\/|$)/.test(url.pathname))
      return handleComposioOAuthRequest(request, env);

    if (url.pathname.startsWith("/api/credentials/"))
      return handleCredentialsRequest(request, env);

    if (
      url.pathname === "/api/local-hands" ||
      url.pathname.startsWith("/api/local-hands/")
    ) {
      return handleLocalHandsRequest(request, env);
    }

    if (
      url.pathname === "/api/mcp-servers" ||
      url.pathname.startsWith("/api/mcp-servers/")
    ) {
      return handleMcpServersRequest(request, env);
    }

    if (url.pathname === "/api/skills") {
      return handleSkillsRequest(request, env);
    }

    if (url.pathname === "/api/system-status") {
      return handleSystemStatusRequest(request, env);
    }

    if (url.pathname === "/api/model-status") {
      return handleModelStatusRequest(request, env);
    }

    // Internal OAuth vaults have no browser/chat surface. Only the verified
    // Access-user handler above can select one and call it through Worker RPC.
    if (
      decodeURIComponent(url.pathname).startsWith(
        "/agents/downy-agent/__composio-",
      )
    )
      return new Response("Not found", { status: 404 });
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return tanstackEntry.fetch(request);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runDueScheduledTasks(env));
    ctx.waitUntil(reconcileCorpus(env));
  },
};
