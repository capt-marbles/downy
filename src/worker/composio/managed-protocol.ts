import { z } from "zod";
export type MetaName =
  | "COMPOSIO_SEARCH_TOOLS"
  | "COMPOSIO_MANAGE_CONNECTIONS"
  | "COMPOSIO_MULTI_EXECUTE_TOOL"
  | "COMPOSIO_REMOTE_WORKBENCH";
export type ManagedCall = (
  name: MetaName,
  args: Record<string, unknown>,
) => Promise<unknown>;
export const ConnectionSearchSchema = z.object({
  toolkit_connection_statuses: z.array(
    z.object({
      toolkit: z.string(),
      has_active_connection: z.boolean(),
      accounts: z
        .array(
          z.object({
            id: z.string().min(1),
            status: z.string(),
            alias: z.string().nullish(),
            is_default: z.boolean().optional(),
            user_info: z
              .object({
                email: z.string().nullish(),
                emailAddress: z.string().nullish(),
              })
              .nullish(),
          }),
        )
        .optional(),
      connection_details: z
        .object({ connected_account_id: z.string().nullish() })
        .nullish()
        .transform((value) => value ?? {}),
    }),
  ),
  session: z.object({ id: z.string() }),
});
type ToolkitStatus = z.infer<
  typeof ConnectionSearchSchema
>["toolkit_connection_statuses"][number];
export function activeAccounts(gmail: ToolkitStatus, serviceName = "Gmail") {
  if (!gmail.has_active_connection) return [];
  if (gmail.accounts) {
    const accounts = gmail.accounts
      .filter((account) => account.status.toLowerCase() === "active")
      .map((account) => ({
        id: account.id,
        isDefault: account.is_default === true,
        label: (
          account.user_info?.emailAddress ??
          account.user_info?.email ??
          account.alias ??
          `${serviceName} account ${account.id.slice(-8)}`
        ).slice(0, 200),
      }));
    return accounts.map(({ id, label, isDefault }) => ({
      id,
      label:
        accounts.filter((account) => account.label === label).length > 1
          ? `${label} (${isDefault ? "Composio default" : `connection ${id.slice(-6)}`})`
          : label,
    }));
  }
  const id = gmail.connection_details.connected_account_id;
  return id ? [{ id, label: `${serviceName} account ${id.slice(-8)}` }] : [];
}
/** Decode only the documented MCP action envelope. Never forward vendor errors,
 * instructions, credentials, or setup payloads into the conversation. */
export function metaData(value: unknown): unknown {
  const result = z
    .object({
      isError: z.boolean().optional(),
      structuredContent: z.unknown().optional(),
      content: z
        .array(z.object({ type: z.string(), text: z.string().optional() }))
        .optional(),
    })
    .parse(value);
  if (result.isError) {
    console.warn("Managed connection diagnostic", { stage: "mcp-tool-error" });
    throw new Error("Composio request failed");
  }
  const payload: unknown =
    result.structuredContent ??
    JSON.parse(
      result.content?.find((part) => part.type === "text")?.text ?? "null",
    );
  const schema = z.object({ successful: z.boolean(), data: z.unknown() });
  const wrapper = schema.safeParse(payload);
  if (!wrapper.success) {
    const nested = z.object({ data: schema }).safeParse(payload);
    console.warn("Managed connection diagnostic", {
      stage: nested.success ? "nested-envelope" : "unknown-envelope",
    });
    throw new Error("Unexpected Composio response");
  }
  if (!wrapper.data.successful) {
    console.warn("Managed connection diagnostic", {
      stage: "provider-failure",
    });
    throw new Error("Composio request failed");
  }
  return wrapper.data.data;
}
export function managedAuthorizationUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    ![
      "connect.composio.dev",
      "backend.composio.dev",
      "platform.composio.dev",
      "app.composio.dev",
    ].includes(url.hostname)
  )
    throw new Error("Unexpected authorization host");
  return url.toString();
}
