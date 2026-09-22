/**
 * One table for which tools each channel may call and how the effect gate
 * treats them. The voice allowlist, the gate's name sets and the service
 * registry's channel lists are all derived from here, so they cannot drift.
 *
 * `voice: true` means the tool's schema is advertised and its executor may
 * run in a voice turn. Anything absent is hidden and blocked in voice. New
 * tools and MCP tools never gain voice access implicitly.
 *
 * `gate` marks tools whose arguments the Jev effect gate classifies before
 * they run: "read" for tools whose declared purpose is to read, "connected"
 * for Composio-backed wrappers that reach the user's accounts.
 */
type ToolChannelSpec = { voice: boolean; gate?: "read" | "connected" };

const TOOL_CHANNELS: Readonly<Record<string, ToolChannelSpec>> = {
  // Research and workspace reads
  web_search: { voice: true, gate: "read" },
  web_scrape: { voice: true, gate: "read" },
  read_peer_agent: { voice: true, gate: "read" },
  read: { voice: true, gate: "read" },
  list: { voice: true, gate: "read" },
  find: { voice: true, gate: "read" },
  grep: { voice: true, gate: "read" },
  read_skill: { voice: true, gate: "read" },
  list_skills: { voice: true, gate: "read" },
  list_skill_files: { voice: true, gate: "read" },
  read_user_profile: { voice: true },
  // Connected services (Composio wrappers). Gmail's wrapper searches, reads
  // and creates drafts; a draft is never sent, so voice may create one. The
  // voice policy re-validates every call against the strict action schema.
  gmail_email: { voice: true, gate: "connected" },
  airtable_records: { voice: true, gate: "connected" },
  slack_channels: { voice: true, gate: "connected" },
  // Runbook judgment and proposals
  qualify_leads: { voice: true },
  prioritize_leads: { voice: true },
  check_outreach_draft: { voice: true },
  stage_action: { voice: true },
  list_staged_actions: { voice: true },
  create_bot: { voice: true },
  // Status reads
  list_mcp_servers: { voice: true },
  list_scheduled_tasks: { voice: true },
  read_campaign_artifact: { voice: true },
  list_buildroom_jobs: { voice: true },
  get_buildroom_workflow: { voice: true },
};

/**
 * MCP proxy tools are named `tool_<server>_<tool>` by the registry's server
 * id. Only these servers' listed tools may run in voice; `call` is further
 * limited to the read endpoints below by the voice policy.
 */
const VOICE_MCP_TOOLS: Readonly<Record<string, readonly string[]>> = {
  treg: ["catalog_search", "catalog_get", "balance", "call"],
};

/** Treg endpoints voice may call: metered reads that never post or send. */
export const TREG_VOICE_ENDPOINTS: ReadonlySet<string> = new Set([
  "treg.people.search",
  "treg.people.email.find",
  "treg.companies.enrich",
  "exa.people.search",
]);

/** Which tools belong to each registry service, for channel derivation. */
const SERVICE_TOOLS: Readonly<Record<string, readonly string[]>> = {
  gmail: ["gmail_email"],
  airtable: ["airtable_records"],
  slack: ["slack_channels"],
  treg: VOICE_MCP_TOOLS.treg.map((name) => `tool_treg_${name}`),
};

export function isVoiceTool(name: string): boolean {
  if (TOOL_CHANNELS[name]?.voice) return true;
  const match = /^tool_([a-z0-9_]+?)_([a-z0-9_]+)$/.exec(name);
  if (!match) return false;
  return VOICE_MCP_TOOLS[match[1]]?.includes(match[2]) ?? false;
}

export function readOrientedToolNames(): ReadonlySet<string> {
  return new Set(
    Object.entries(TOOL_CHANNELS)
      .filter(([, spec]) => spec.gate === "read")
      .map(([name]) => name),
  );
}

export function connectedServiceToolNames(): ReadonlySet<string> {
  return new Set(
    Object.entries(TOOL_CHANNELS)
      .filter(([, spec]) => spec.gate === "connected")
      .map(([name]) => name),
  );
}

/**
 * Channels a connected service is usable from. Every connectable service is
 * usable from chat; it is usable from voice when any of its tools is.
 */
export function serviceChannels(serviceId: string): string[] {
  const tools = SERVICE_TOOLS[serviceId];
  if (!tools) return ["chat"];
  return tools.some((name) => isVoiceTool(name)) ? ["chat", "voice"] : ["chat"];
}
