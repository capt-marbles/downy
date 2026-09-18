import { headerSecretValues } from "./mcp-reconnect";
import type { DownyAgent } from "./DownyAgent";
import { connectWithStaticHeaders } from "./tools/mcp-servers";
import { connectWithTriage, type McpTransport } from "./mcp-triage";
import { runJev } from "../jev/client";
import { createCredentialRequest } from "../credentials/requests";

export async function connectMcpWithTriage(
  agent: DownyAgent,
  env: Cloudflare.Env,
  params: {
    name: string;
    url: string;
    transport?: McpTransport;
    headers?: Record<string, string>;
  },
) {
  const headerNames = Object.keys(params.headers ?? {});
  const result = await connectWithTriage({
    initial: {
      url: params.url,
      transport: params.transport ?? "auto",
      oauth: !params.headers,
    },
    headerNames,
    secretValues: headerSecretValues(params.headers ?? {}),
    confidenceFloor: Number(env.MCP_TRIAGE_CONFIDENCE_FLOOR),
    run: (request) => runJev(env.AI, request),
    requestCredential: () =>
      createCredentialRequest(env.DB, agent.name, {
        purpose: `Reconnect ${params.name}`,
        serverName: params.name,
        url: params.url,
        transport: params.transport ?? "auto",
        fields: headerNames.length
          ? headerNames.map((headerName) => ({
              headerName,
              label: headerName,
              scheme: params.headers?.[headerName].startsWith("Bearer ")
                ? ("bearer" as const)
                : params.headers?.[headerName].startsWith("Basic ")
                  ? ("basic" as const)
                  : ("raw" as const),
            }))
          : [
              {
                headerName: "Authorization",
                label: "Access token",
                scheme: "bearer",
              },
            ],
      }),
    connect: async (attempt, signal) => {
      const connected = attempt.oauth
        ? await agent.addMcpServer(params.name, attempt.url, {
            transport: { type: attempt.transport },
          })
        : await connectWithStaticHeaders(agent, {
            name: params.name,
            url: attempt.url,
            type: attempt.transport,
            headers: params.headers ?? {},
          });
      if (signal.aborted) {
        await agent.mcp.removeServer(connected.id).catch(() => undefined);
        throw new Error("Connection deadline exceeded");
      }
      let state = connected.state;
      if (state === "connecting" || state === "connected") {
        await agent.mcp.waitForConnections({ timeout: 1500 });
        state = agent.getMcpServers().servers[connected.id]?.state ?? "failed";
      }
      if (signal.aborted) {
        await agent.mcp.removeServer(connected.id).catch(() => undefined);
        throw new Error("Connection deadline exceeded");
      }
      if (!["ready", "connected", "authenticating"].includes(state))
        await agent.mcp.removeServer(connected.id).catch(() => undefined);
      return {
        id: connected.id,
        state,
        error: state === "failed" ? "MCP connection failed" : null,
        toolNames: agent.mcp
          .listTools()
          .filter((t) => t.serverId === connected.id)
          .map((t) => t.name),
      };
    },
    probe: async (attempt, signal) => {
      const response = await fetch(attempt.url, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(attempt.oauth ? {} : params.headers),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "downy-probe", version: "1" },
          },
        }),
      });
      const reader = response.body?.getReader();
      let text = "";
      if (reader) {
        const chunk = await reader.read();
        text = new TextDecoder().decode(chunk.value).slice(0, 4000);
        await reader.cancel();
      }
      return {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type"),
        bodyPreview: text,
      };
    },
  });
  if (
    result.id &&
    ["ready", "connected", "authenticating"].includes(result.state)
  )
    await agent.persistMcpServer({
      id: result.id,
      name: params.name,
      url: result.attempted.url,
      transport: result.attempted.transport,
      ...(result.attempted.oauth ? {} : { headers: params.headers }),
    });
  await env.DB.prepare(
    `INSERT INTO mcp_connect_diagnostics (id, agent_slug, server_name, url, attempted_transport, http_status, jev_class, jev_confidence, jev_model_version, ladder_steps_json, final_state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      agent.name,
      params.name,
      result.steps[0]?.url ?? "",
      params.transport ?? "auto",
      result.probe.status,
      result.classification,
      result.confidence,
      result.model,
      JSON.stringify(result.steps),
      result.state,
      Date.now(),
    )
    .run();
  return result;
}
