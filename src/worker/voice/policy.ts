import { AirtableActionSchema } from "../../lib/airtable-connect";

const VOICE_PAGE_MAX = 25;
import { GmailActionSchema } from "../../lib/gmail-connect";
import { VOICE_IDLE_MS, VOICE_LEASE_MS, VOICE_MAX_MS } from "../../lib/voice";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { normalizeWorkspacePath } from "../agent/child-workspace-rpc";
import { isVoiceTool, TREG_VOICE_ENDPOINTS } from "../agent/tool-channels";

// Positive allowlist from the shared channel table: new tools and MCP tools
// never acquire voice permissions implicitly. Spoken approval never grants
// external actions. The only write exceptions are a constrained new Markdown
// report, explicit creation of an empty bot, dispatch of a read-only research
// worker, and staging a proposal card that only a tap in chat can confirm.

const TregVoiceCallSchema = z
  .object({
    endpoint_id: z.string().min(1).max(200),
    params: z.record(z.string(), z.unknown()).optional(),
    idempotency_key: z.string().max(200).optional(),
  })
  .strict();

type VoiceResearchDispatch = (
  brief: string,
) => Promise<{ taskId: string; status: "dispatched" }>;

export function voiceReadTools(
  names: string[],
  reportsEnabled = false,
  researchEnabled = false,
): string[] {
  return names.filter(
    (name) =>
      isVoiceTool(name) ||
      (reportsEnabled && name === "write") ||
      (researchEnabled && name === "spawn_background_task"),
  );
}

// Both the advertised schemas and executable guards use the fully resolved
// authorized inventory. Do not pass only Think's base tools here.
export function voiceTurnTools(
  availableTools: ToolSet,
  saveReport?: (path: string, content: string) => Promise<void>,
  dispatchResearch?: VoiceResearchDispatch,
) {
  return {
    activeTools: voiceReadTools(
      Object.keys(availableTools),
      !!saveReport,
      !!dispatchResearch,
    ),
    tools: voiceToolSet(availableTools, saveReport, dispatchResearch),
  };
}

export function voiceToolSet(
  tools: ToolSet,
  saveReport?: (path: string, content: string) => Promise<void>,
  dispatchResearch?: VoiceResearchDispatch,
): ToolSet {
  // Think merges tool overrides rather than replacing the tool set, and its
  // beforeToolCall hook is currently observational. Block executors as well
  // as hiding schemas so an out-of-allowlist model call cannot execute.
  const restricted = Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => [
      name,
      isVoiceTool(name)
        ? definition
        : {
            ...definition,
            needsApproval: false,
            execute: async () => {
              throw new Error(
                "Voice only permits reads, metered read lookups, new workspace reports, read-only research workers, proposal cards, and explicitly requested empty bots. This action did not run. Use the chat controls for other actions.",
              );
            },
          },
    ]),
  );
  const gmail = tools.gmail_email;
  if (gmail?.execute) {
    const execute = gmail.execute;
    // Search, read and create_draft only, re-parsed strictly here so a hidden
    // send/forward/delete action can never reach the executor from voice even
    // if the chat wrapper is widened later. A draft is saved, never sent.
    restricted.gmail_email = tool({
      description: gmail.description,
      inputSchema: GmailActionSchema,
      execute: async (input, options) => {
        const action = GmailActionSchema.parse(input);
        if (!["search", "read", "create_draft"].includes(action.action))
          throw new Error(
            "Voice only permits Gmail search, read and draft creation.",
          );
        const result: unknown = await execute(action, options);
        return result;
      },
    });
  }
  const tregCall = tools.tool_treg_call;
  if (tregCall?.execute) {
    const execute = tregCall.execute;
    // Treg's `call` reaches any catalog endpoint, including ones that post or
    // generate. Voice pins it to the runbook's read endpoints and to `params`
    // only: no raw body, method, headers or query, whatever the gate decides.
    restricted.tool_treg_call = tool({
      description: `${tregCall.description ?? "Treg call"}\n\nVoice: only these read endpoints, with params only: ${[...TREG_VOICE_ENDPOINTS].join(", ")}.`,
      inputSchema: TregVoiceCallSchema,
      execute: async (input, options) => {
        const call = TregVoiceCallSchema.parse(input);
        if (!TREG_VOICE_ENDPOINTS.has(call.endpoint_id))
          throw new Error(
            "Voice only permits Treg read endpoints: people search, work email lookup and company enrichment. This call did not run.",
          );
        const result: unknown = await execute(call, options);
        return result;
      },
    });
  }
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
          ![
            "list_bases",
            "get_schema",
            "list_records",
            "pipeline_report",
          ].includes(input.action)
        )
          throw new Error("Voice only permits Airtable reads.");
        // A call cannot digest a large page; keep reads small so the result
        // returns inline instead of being offloaded.
        const parsed = AirtableActionSchema.parse(input);
        const bounded =
          parsed.action === "list_records"
            ? { ...parsed, limit: Math.min(parsed.limit, VOICE_PAGE_MAX) }
            : parsed;
        const result: unknown = await execute(bounded, options);
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
  if (dispatchResearch && tools.spawn_background_task)
    // The chat tool's kind/brief schema is replaced: voice cannot choose the
    // worker's access level, and the worker never inherits MCP or writes.
    restricted.spawn_background_task = tool({
      description:
        "Start a READ-ONLY background research worker for multi-source work the caller does not need to wait for. The worker can search and scrape the web and read workspace files; it cannot write files, use connected services or take actions. Its findings are saved as a new workspace note and linked in chat when it finishes, and the caller is told when that happens, including in a later call. The brief must be self-contained: goal, sources or topics, and the desired output shape. Returns { taskId, status:'dispatched' }; dispatched is not finished.",
      inputSchema: z.object({ brief: z.string().min(10).max(4000) }),
      execute: async ({ brief }) => dispatchResearch(brief),
    });
  return restricted;
}

export function voiceDeadline(
  state: {
    startedAt: number;
    heartbeatAt: number;
    activityAt: number;
    expiresAt: number;
  },
  maxMs = VOICE_MAX_MS,
): number {
  return Math.min(
    state.startedAt + maxMs,
    state.expiresAt,
    state.heartbeatAt + VOICE_LEASE_MS,
    state.activityAt + VOICE_IDLE_MS,
  );
}
