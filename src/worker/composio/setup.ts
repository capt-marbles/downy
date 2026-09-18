import { z } from "zod";
import { composio, ToolkitSchema, ToolListSchema } from "./client";
import { createCredentialRequest } from "../credentials/requests";
import { getAgentStub } from "../lib/get-agent";
import { readSecret } from "../credentials/crypto";

export const SetupInputSchema = z.object({
  toolkit: z.string().regex(/^[a-z0-9_-]+$/),
  allowedTools: z.array(z.string().min(1)).min(1).max(12),
});
type Connection = {
  id: string;
  agent_slug: string;
  user_id: string;
  toolkit: string;
  auth_config_id: string;
  account_id: string | null;
  server_id: string | null;
  allowed_tools_json: string;
  status: string;
  expires_at: number;
};

export async function startComposioSetup(
  env: Cloudflare.Env,
  agentSlug: string,
  userId: string,
  input: z.infer<typeof SetupInputSchema>,
) {
  const tools = ToolListSchema.parse(
    await composio(
      env.COMPOSIO_API_KEY,
      `/tools?toolkit_slug=${encodeURIComponent(input.toolkit)}&limit=1000`,
    ),
  ).items;
  if (input.allowedTools.some((slug) => !tools.some((t) => t.slug === slug)))
    throw new Error("Select only tools from this toolkit");
  const toolkit = ToolkitSchema.parse(
    await composio(
      env.COMPOSIO_API_KEY,
      `/toolkits/${encodeURIComponent(input.toolkit)}`,
    ),
  );
  const oauth = toolkit.composio_managed_auth_schemes.some(
    (s) => s.toUpperCase() === "OAUTH2",
  );
  const scheme = oauth ? "OAUTH2" : "API_KEY";
  const previous = await env.DB.prepare(
    "SELECT auth_config_id FROM composio_connections WHERE toolkit = ? AND allowed_tools_json = ? AND user_id = ? LIMIT 1",
  )
    .bind(input.toolkit, JSON.stringify(input.allowedTools), userId)
    .first<{ auth_config_id: string }>();
  const created = previous
    ? null
    : await composio(env.COMPOSIO_API_KEY, "/auth_configs", {
        toolkit: { slug: input.toolkit },
        auth_config: {
          type: "use_composio_managed_auth",
          auth_scheme: scheme,
          restrict_to_following_tools: input.allowedTools,
        },
      });
  const authConfigId =
    previous?.auth_config_id ??
    z.object({ id: z.string() }).parse(created?.auth_config).id;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO composio_connections (id, agent_slug, user_id, toolkit, auth_config_id, allowed_tools_json, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
  )
    .bind(
      id,
      agentSlug,
      userId,
      input.toolkit,
      authConfigId,
      JSON.stringify(input.allowedTools),
      Date.now(),
      Date.now() + 15 * 60_000,
    )
    .run();
  if (oauth) {
    // Composio owns the provider callback. Do not set callback_url to Downy:
    // Cloudflare Access would intercept it before the OAuth exchange finishes.
    const link = z
      .object({
        redirect_url: z.string().url(),
        connected_account_id: z.string(),
      })
      .parse(
        await composio(env.COMPOSIO_API_KEY, "/connected_accounts/link", {
          auth_config_id: authConfigId,
          user_id: userId,
        }),
      );
    await env.DB.prepare(
      "UPDATE composio_connections SET account_id = ? WHERE id = ?",
    )
      .bind(link.connected_account_id, id)
      .run();
    return {
      kind: "oauth" as const,
      setupId: id,
      redirectUrl: link.redirect_url,
    };
  }
  const auth = toolkit.auth_config_details.find(
    (detail) => detail.mode.toUpperCase() === "API_KEY",
  );
  const fields = auth?.fields?.connected_account_initiation?.required;
  if (!fields?.length)
    throw new Error(
      "Toolkit requires a setup flow not supported by the API-key card",
    );
  const ticket = await createCredentialRequest(
    env.DB,
    agentSlug,
    {
      purpose: `Connect ${toolkit.name}`,
      serverName: toolkit.name,
      url: "https://backend.composio.dev",
      fields: fields.map((field) => ({
        headerName: field.name,
        label: field.displayName ?? field.name,
        scheme: "raw" as const,
      })),
    },
    { provider: "composio", setupId: id },
  );
  return { kind: "credential-request" as const, setupId: id, ...ticket };
}

export async function submitComposioKey(
  env: Cloudflare.Env,
  agentSlug: string,
  setupId: string,
  values: Record<string, string>,
) {
  const connection = await env.DB.prepare(
    "SELECT * FROM composio_connections WHERE id = ? AND agent_slug = ?",
  )
    .bind(setupId, agentSlug)
    .first<Connection>();
  if (!connection || connection.expires_at <= Date.now())
    throw new Error("Setup expired");
  const account = z.object({ id: z.string() }).parse(
    await composio(env.COMPOSIO_API_KEY, "/connected_accounts", {
      auth_config: { id: connection.auth_config_id },
      connection: {
        user_id: connection.user_id,
        state: { authScheme: "API_KEY", val: values },
      },
    }),
  );
  await env.DB.prepare(
    "UPDATE composio_connections SET account_id = ? WHERE id = ?",
  )
    .bind(account.id, setupId)
    .run();
  return pollComposioSetup(env, agentSlug, setupId, connection.user_id);
}

export async function pollComposioSetup(
  env: Cloudflare.Env,
  agentSlug: string,
  setupId: string,
  userId: string,
) {
  const connection = await env.DB.prepare(
    "SELECT * FROM composio_connections WHERE id = ? AND agent_slug = ? AND user_id = ?",
  )
    .bind(setupId, agentSlug, userId)
    .first<Connection>();
  if (!connection || connection.expires_at <= Date.now())
    throw new Error("Setup expired");
  if (!connection.account_id)
    return { state: "pending", toolNames: [] as string[], error: null };
  const account = await composio(
    env.COMPOSIO_API_KEY,
    `/connected_accounts/${encodeURIComponent(connection.account_id)}`,
  );
  if (account.status !== "ACTIVE")
    return {
      state: account.status === "FAILED" ? "failed" : "pending",
      toolNames: [] as string[],
      error: account.status === "FAILED" ? "Authorization failed" : null,
    };
  // Guard concurrent UI polls; only one may create/register the MCP surface.
  const claim = await env.DB.prepare(
    "UPDATE composio_connections SET status = 'connecting' WHERE id = ? AND status = 'pending'",
  )
    .bind(setupId)
    .run();
  if (claim.meta.changes !== 1)
    return {
      state:
        connection.status === "ready"
          ? "ready"
          : connection.status === "failed"
            ? "failed"
            : "pending",
      toolNames:
        connection.status === "ready"
          ? z.array(z.string()).parse(JSON.parse(connection.allowed_tools_json))
          : [],
      error: null,
    };
  try {
    const allowedTools = z
      .array(z.string())
      .min(1)
      .parse(JSON.parse(connection.allowed_tools_json));
    const server = z.object({ id: z.string() }).parse(
      await composio(env.COMPOSIO_API_KEY, "/mcp/servers", {
        name: `Downy ${connection.toolkit}`.slice(0, 30),
        auth_config_ids: [connection.auth_config_id],
        allowed_tools: allowedTools,
        managed_auth_via_composio: true,
      }),
    );
    await env.DB.prepare(
      "UPDATE composio_connections SET server_id = ? WHERE id = ?",
    )
      .bind(server.id, setupId)
      .run();
    const agent = await getAgentStub(env, agentSlug);
    const result = await agent.connectCredential(
      {
        serverName: `Composio ${connection.toolkit}`,
        url: `https://backend.composio.dev/v3/mcp/${encodeURIComponent(server.id)}?user_id=${encodeURIComponent(userId)}`,
        transport: "streamable-http",
      },
      { "x-api-key": await readSecret(env.COMPOSIO_API_KEY) },
    );
    await env.DB.prepare(
      "UPDATE composio_connections SET status = ? WHERE id = ?",
    )
      .bind(result.state === "ready" ? "ready" : "failed", setupId)
      .run();
    return result;
  } catch {
    await env.DB.prepare(
      "UPDATE composio_connections SET status = 'failed' WHERE id = ?",
    )
      .bind(setupId)
      .run();
    return {
      state: "failed",
      toolNames: [],
      error: "Managed connection failed",
    };
  }
}
