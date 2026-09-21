/**
 * The services Downy knows how to connect, and how. Each entry is one
 * connection flow the setup runbook can finish, or an honest statement that
 * it cannot. Anything not listed here has no connection flow yet: the runbook
 * may still discover documentation for it, but it must say so plainly rather
 * than ask the operator to choose between candidates it cannot act on.
 *
 * Two flows exist today:
 * - composio-managed: Composio owns OAuth; Downy shows a secure card in chat,
 *   stores a per-bot grant, and exposes one narrow tool.
 * - mcp: the bot attaches an MCP server with connect_mcp_server (OAuth in the
 *   browser); its tools arrive as tool_<server>_<name> proxies.
 */
import { serviceChannels } from "../agent/tool-channels";

type ServiceFlow = "composio-managed" | "mcp" | "not-connectable";

type ServiceSpec = {
  id: string;
  label: string;
  match: RegExp;
  flow: ServiceFlow;
  /** `planned` means the flow exists in design but not in code yet. */
  status: "available" | "planned";
  operations: readonly string[];
  mcp?: { url: string; transport: "auto" | "streamable-http" | "sse" };
  /** One or two plain sentences the model can relay verbatim. */
  note: string;
};

export const SERVICES: readonly ServiceSpec[] = [
  {
    id: "gmail",
    label: "Gmail",
    match: /\b(gmail|google mail)\b/i,
    flow: "composio-managed",
    status: "available",
    operations: ["search", "read", "create_draft"],
    note: "Connects through the secure Gmail card in chat. Search, read and create drafts for the operator to send; Downy never sends mail.",
  },
  {
    id: "airtable",
    label: "Airtable",
    match: /\bairtable\b/i,
    flow: "composio-managed",
    status: "available",
    operations: [
      "list_bases",
      "get_schema",
      "list_records",
      "pipeline_report",
      "create_records (via a confirmed card)",
    ],
    note: "Connects through the secure Airtable card in chat. Reads and pipeline reports directly; new records only through an airtable_create_records card the operator confirms. Updates and deletes are not available.",
  },
  {
    id: "slack",
    label: "Slack",
    match: /\bslack(bot)?\b/i,
    flow: "composio-managed",
    status: "available",
    operations: ["list_channels", "post_message (via a confirmed card)"],
    note: "Connects through the secure Slack card in chat and installs Downy as a Slack app. Lists channels directly; posts only through a slack_post_message card the operator confirms. Downy never reads messages, and the app must be invited to a channel before it can post there.",
  },
  {
    id: "treg",
    label: "Treg",
    match: /\btreg\b/i,
    flow: "mcp",
    status: "available",
    mcp: { url: "https://treg.to/mcp/", transport: "auto" },
    operations: ["catalog_search", "catalog_get", "call", "balance"],
    note: "A paid tool catalog for data lookups: people search, work email, company enrichment. Connects as an MCP server with OAuth in the browser. Calls spend a prepaid balance and never post or send.",
  },
  {
    id: "taskfuel",
    label: "TaskFuel",
    match: /\btask ?fuel\b/i,
    flow: "not-connectable",
    status: "planned",
    operations: [],
    note: "A paid-API gateway with a command-line client and no MCP endpoint, so it cannot be connected from Downy today.",
  },
];

export function resolveService(query: string): ServiceSpec | null {
  return SERVICES.find((service) => service.match.test(query)) ?? null;
}

/** Channels a service can be used from, derived from its tools' voice access. */
function serviceUsableFrom(
  service: Pick<ServiceSpec, "id" | "flow" | "status">,
): string[] {
  if (service.flow === "not-connectable" || service.status === "planned")
    return [];
  return serviceChannels(service.id);
}

/** Short, code-owned truth for the system prompt about what can be connected. */
export function renderConnectionsSection(): string {
  const lines = SERVICES.map((service) => {
    const how =
      service.flow === "not-connectable"
        ? "cannot be connected"
        : service.status === "planned"
          ? "not connectable yet"
          : service.flow === "mcp"
            ? `connect with connect_mcp_server (${service.mcp?.url ?? "MCP"})`
            : "secure card in chat via find_tool_setup";
    const channels = serviceUsableFrom(service);
    const usable = channels.length
      ? ` Usable from ${channels.join(" and ")}.`
      : "";
    return `- **${service.label}**: ${how}.${usable} ${service.note}`;
  });
  return [
    "## Connections",
    "",
    "Only these services have a connection flow. For anything else, say plainly that it cannot be connected from chat yet; do not ask the user to choose between setup candidates you cannot act on.",
    "",
    ...lines,
    "",
    "Unattended runs work through standing approvals. To schedule a task that writes to a connected service (create Airtable records, post to Slack), propose it with stage_action kind schedule_task and include grants naming the exact base and table or channel; the operator's tap on that card approves those actions for every run, so no per-run confirmation is needed. In the run, a proposal that matches a grant executes immediately and leaves a receipt naming the approval. A scheduled task without grants can only read and write the workspace. Never use the plain schedule_task tool for a task that needs connected writes.",
  ].join("\n");
}
