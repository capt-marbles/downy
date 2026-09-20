import { tool } from "ai";
import { z } from "zod";

import type { DownyAgent } from "../DownyAgent";
import { buildHeaderTransport, isCredentialsRejection } from "../mcp-reconnect";

const transportSchema = z
  .enum(["auto", "streamable-http", "sse"])
  .optional()
  .describe(
    "Transport. 'auto' (default) tries Streamable HTTP, then SSE. A 405 on 'auto' usually means the server rejected the SSE GET — retry with 'streamable-http'.",
  );

const connectInputSchema = z.object({
  name: z.string().min(1).describe("Label, e.g. 'sentry', 'dataforseo'."),
  url: z.string().url().describe("Hosted MCP endpoint URL."),
  transport: transportSchema,
});

const CLOUDFLARE_MCP_SERVERS = {
  api: "https://mcp.cloudflare.com/mcp",
  docs: "https://docs.mcp.cloudflare.com/mcp",
  bindings: "https://bindings.mcp.cloudflare.com/mcp",
  builds: "https://builds.mcp.cloudflare.com/mcp",
  observability: "https://observability.mcp.cloudflare.com/mcp",
  radar: "https://radar.mcp.cloudflare.com/mcp",
  containers: "https://containers.mcp.cloudflare.com/mcp",
  browser: "https://browser.mcp.cloudflare.com/mcp",
  logs: "https://logs.mcp.cloudflare.com/mcp",
  ai_gateway: "https://ai-gateway.mcp.cloudflare.com/mcp",
  autorag: "https://autorag.mcp.cloudflare.com/mcp",
  auditlogs: "https://auditlogs.mcp.cloudflare.com/mcp",
  dns_analytics: "https://dns-analytics.mcp.cloudflare.com/mcp",
  dex: "https://dex.mcp.cloudflare.com/mcp",
  casb: "https://casb.mcp.cloudflare.com/mcp",
  graphql: "https://graphql.mcp.cloudflare.com/mcp",
  agents_docs: "https://agents.cloudflare.com/mcp",
} as const;

const cloudflareServerSchema = z.enum([
  "api",
  "docs",
  "bindings",
  "builds",
  "observability",
  "radar",
  "containers",
  "browser",
  "logs",
  "ai_gateway",
  "autorag",
  "auditlogs",
  "dns_analytics",
  "dex",
  "casb",
  "graphql",
  "agents_docs",
]);

const connectCloudflareInputSchema = z.object({
  server: cloudflareServerSchema
    .default("api")
    .describe(
      "Cloudflare managed MCP server to attach. Use 'api' for the full Cloudflare API codemode server.",
    ),
  name: z
    .string()
    .optional()
    .describe("Optional display name. Defaults to cloudflare-<server>."),
  url: z
    .string()
    .url()
    .optional()
    .describe(
      "Override URL for testing or self-hosted Cloudflare MCP servers.",
    ),
  transport: transportSchema,
});

function resultError(result: { state: string }): string | undefined {
  if (!("error" in result)) return undefined;
  return typeof result.error === "string" ? result.error : undefined;
}

function mcpServerIdBase(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `mcp_${slug || "server"}`;
}

function mcpServerIdFor(agent: DownyAgent, name: string): string {
  const base = mcpServerIdBase(name);
  const used = new Set([
    ...agent.mcp.listServers().map((s) => s.id),
    ...Object.keys(agent.mcp.mcpConnections),
  ]);
  if (!used.has(base)) return base;

  for (let i = 2; i <= 50; i += 1) {
    const candidate = `${base}_${String(i)}`;
    if (!used.has(candidate)) return candidate;
  }

  return `${base}_${Math.random().toString(36).slice(2, 8)}`;
}

// Why this connect tool doesn't just call `addMcpServer`:
// In agents@0.11.x, `addMcpServer` auto-derives a `callbackUrl` from the inbound
// request URL and unconditionally installs an OAuth `authProvider` whenever
// that callbackUrl exists. The MCP SDK then converts ANY 401 during the
// handshake into `state: AUTHENTICATING`, leaving header-auth servers stuck
// in an OAuth flow that they don't actually need (DataForSEO, Linear, etc.).
//
// When the user supplies static `headers`, we want a header-auth path with no
// OAuth interference. So for that case we go directly through the lower-level
// MCPClientManager (`mcp.registerServer` + `mcp.connectToServer`) — which
// happily accepts a transport without an `authProvider`. No callback URL, no
// OAuth provider, no AUTHENTICATING-purgatory: a 401 lands as FAILED with the
// real error string, and a 200 lands as CONNECTED → READY after discovery.
//
// When no headers are supplied, we fall back to `addMcpServer` so OAuth-only
// servers (like Sentry's hosted MCP) still work.

const CREDENTIALS_REJECTED_MESSAGE =
  "Server returned 401 — credentials rejected. Verify the auth header value (correct token, not expired, required scopes) and retry. For Bearer tokens: confirm the token was issued for this server. For Basic: ensure the value is base64(login:password).";

export async function connectWithStaticHeaders(
  agent: DownyAgent,
  params: {
    name: string;
    url: string;
    type: "auto" | "streamable-http" | "sse";
    headers: Record<string, string>;
  },
): Promise<{ id: string; state: string; error: string | null }> {
  const { name, url, type, headers } = params;
  const normalizedUrl = new URL(url).href;
  const existing = agent.mcp
    .listServers()
    .find(
      (s) => s.name === name && new URL(s.server_url).href === normalizedUrl,
    );
  const existingConn = existing ? agent.mcp.mcpConnections[existing.id] : null;
  const id = existing?.id ?? mcpServerIdFor(agent, name);
  if (existing || existingConn) {
    await agent.mcp.removeServer(id).catch(() => undefined);
  }
  await agent.mcp.registerServer(id, {
    url,
    name,
    // Intentionally NO authProvider — see top-of-section comment.
    transport: buildHeaderTransport(type, headers),
  });
  const result = await agent.mcp.connectToServer(id);
  if (result.state === "connected") {
    const discovery = await agent.mcp.discoverIfConnected(id);
    if (discovery && !discovery.success) {
      return {
        id,
        state: "failed",
        error: `Discovery failed: ${discovery.error ?? "unknown"}`,
      };
    }
    return { id, state: "ready", error: null };
  }
  const errorString = resultError(result);
  if (
    isCredentialsRejection({
      state: result.state,
      error: errorString,
    })
  ) {
    // Cleanly remove the zombie connection so downstream `waitForSettled`,
    // `getMcpServers()` snapshots, and the next restore pass don't see a
    // ghost in AUTHENTICATING state. We also intentionally don't persist
    // (gated by caller), so no harm leaving it gone.
    await agent.mcp.removeServer(id).catch(() => undefined);
    return { id, state: "failed", error: CREDENTIALS_REJECTED_MESSAGE };
  }
  if (result.state === "failed") {
    return {
      id,
      state: "failed",
      error: errorString ?? "Unknown connection error",
    };
  }
  return { id, state: result.state, error: null };
}

export function createConnectMcpServerTool(args: { agent: DownyAgent }) {
  return tool({
    description:
      "Connect a hosted MCP endpoint. Returns state, discovered tool names, diagnostics, and failure guidance when needed. Credentials come only from the secure credential card, never from the model or chat. Flag unverified endpoint URLs as guesses.",
    inputSchema: connectInputSchema,
    execute: async (input) => {
      const host = new URL(input.url).hostname;
      if (host === "composio.dev" || host.endsWith(".composio.dev")) {
        await args.agent.showComposioConnectCard();
        return {
          state: "managed",
          managedConnections: await args.agent.managedConnectionStatus(),
          nextAction:
            "Composio uses the managed connection card. Do not probe alternative URLs or request credentials. To connect Gmail, use find_tool_setup with query Gmail and wait for the card.",
        };
      }
      return args.agent.connectMcpEndpoint(input);
    },
  });
}

export function createConnectCloudflareMcpServerTool(args: {
  agent: DownyAgent;
}) {
  return tool({
    description:
      "Connect a Cloudflare managed MCP server. Returns connection state and discovered tools. Use request_credential for token authentication; never ask the user to type a key into chat.",
    inputSchema: connectCloudflareInputSchema,
    execute: ({ server, name, url, transport }) =>
      args.agent.connectMcpEndpoint({
        name: name ?? `cloudflare-${server}`,
        url: url ?? CLOUDFLARE_MCP_SERVERS[server],
        transport: transport ?? "streamable-http",
      }),
  });
}

export function createListMcpServersTool(args: { agent: DownyAgent }) {
  return tool({
    description:
      "List attached MCP servers and managed Composio/Gmail connection status. Managed OAuth connections are separate from MCP server rows; an empty servers list does not mean managed connections are disconnected.",
    inputSchema: z.object({}),
    execute: async () => {
      const state = args.agent.getMcpServers();
      const servers = Object.entries(state.servers).map(([id, s]) => ({
        id,
        name: s.name,
        url: s.server_url,
        state: s.state,
        error: s.error,
        toolNames: state.tools
          .filter((t) => t.serverId === id)
          .map((t) => t.name),
      }));
      return {
        servers,
        managedConnections: await args.agent.managedConnectionStatus(),
      };
    },
  });
}

export function createDisconnectMcpServerTool(args: { agent: DownyAgent }) {
  return tool({
    description: "Detach an MCP server by id.",
    inputSchema: z.object({ id: z.string().min(1) }),
    execute: async ({ id }) => {
      await args.agent.disconnectMcpServer(id);
      return { removed: true, id };
    },
  });
}
