import { AirtableActionSchema } from "../../lib/airtable-connect";
import { VOICE_IDLE_MS, VOICE_LEASE_MS, VOICE_MAX_MS } from "../../lib/voice";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { normalizeWorkspacePath } from "../agent/child-workspace-rpc";

// Positive allowlist: new tools and MCP tools never acquire voice permissions
// implicitly. Spoken approval never grants external actions. The only write
// exceptions are a constrained new Markdown report and explicit creation of an empty bot.
const VOICE_READ_TOOLS = new Set([
  "create_bot",
  "airtable_records",
  "read",
  "list",
  "find",
  "grep",
  "read_user_profile",
  "read_campaign_artifact",
  "list_buildroom_jobs",
  "get_buildroom_workflow",
  "list_scheduled_tasks",
]);

export function voiceReadTools(
  names: string[],
  reportsEnabled = false,
): string[] {
  return names.filter(
    (name) =>
      VOICE_READ_TOOLS.has(name) || (reportsEnabled && name === "write"),
  );
}

// Both the advertised schemas and executable guards use the fully resolved
// authorized inventory. Do not pass only Think's base tools here.
export function voiceTurnTools(
  availableTools: ToolSet,
  saveReport?: (path: string, content: string) => Promise<void>,
) {
  return {
    activeTools: voiceReadTools(Object.keys(availableTools), !!saveReport),
    tools: voiceToolSet(availableTools, saveReport),
  };
}

export function voiceToolSet(
  tools: ToolSet,
  saveReport?: (path: string, content: string) => Promise<void>,
): ToolSet {
  // Think merges tool overrides rather than replacing the tool set, and its
  // beforeToolCall hook is currently observational. Block executors as well
  // as hiding schemas so an out-of-allowlist model call cannot execute.
  const restricted = Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => [
      name,
      VOICE_READ_TOOLS.has(name)
        ? definition
        : {
            ...definition,
            needsApproval: false,
            execute: async () => {
              throw new Error(
                "Voice only permits reads, new workspace reports, and explicitly requested empty bots. This action did not run. Use the chat controls for other actions.",
              );
            },
          },
    ]),
  );
  const airtable = tools.airtable_records;
  if (airtable?.execute) {
    const execute = airtable.execute;
    restricted.airtable_records = tool({
      description: airtable.description,
      inputSchema: AirtableActionSchema,
      execute: async (input, options) => {
        // Keep this operation allowlist even if chat later gains Airtable writes.
        // Hidden/malformed calls must fail before the original executor runs.
        if (
          !["list_bases", "get_schema", "list_records"].includes(input.action)
        )
          throw new Error("Voice only permits Airtable reads.");
        const result: unknown = await execute(
          AirtableActionSchema.parse(input),
          options,
        );
        return result;
      },
    });
  }
  if (saveReport && tools.write)
    restricted.write = tool({
      description:
        "Save a NEW Markdown report requested by the caller under workspace/research/, workspace/reports/ or workspace/drafts/. Read the sources first; include their paths/URLs and evidence limits. Use a simple filename ending .md, without subdirectories. Existing files cannot be overwritten. Returns saved:true only after verification. Other writes and background workers are unavailable in voice.",
      inputSchema: z.object({
        path: z.string().max(200),
        content: z.string().min(1).max(100_000),
      }),
      execute: async ({ path, content }) => {
        const normalized = normalizeWorkspacePath(path);
        if (
          !/^workspace\/(?:research|reports|drafts)\/[a-zA-Z0-9_-]+\.md$/.test(
            normalized,
          )
        )
          throw new Error(
            "Voice can only save new Markdown reports in the approved workspace folders.",
          );
        await saveReport(normalized, content);
        return {
          saved: true,
          path: normalized,
          bytesWritten: new TextEncoder().encode(content).byteLength,
        };
      },
    });
  return restricted;
}

export function voiceDeadline(state: {
  startedAt: number;
  heartbeatAt: number;
  activityAt: number;
  expiresAt: number;
}): number {
  return Math.min(
    state.startedAt + VOICE_MAX_MS,
    state.expiresAt,
    state.heartbeatAt + VOICE_LEASE_MS,
    state.activityAt + VOICE_IDLE_MS,
  );
}
