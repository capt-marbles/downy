import { VOICE_IDLE_MS, VOICE_LEASE_MS, VOICE_MAX_MS } from "../../lib/voice";
import type { ToolSet } from "ai";

// Positive allowlist: new tools and MCP tools never acquire voice permissions
// implicitly. Even a prompt injection or misheard approval stays read-only.
const VOICE_READ_TOOLS = new Set([
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

export function voiceReadTools(names: string[]): string[] {
  return names.filter((name) => VOICE_READ_TOOLS.has(name));
}

export function voiceToolSet(tools: ToolSet): ToolSet {
  // Think merges tool overrides rather than replacing the tool set, and its
  // beforeToolCall hook is currently observational. Block executors as well
  // as hiding schemas so an out-of-allowlist model call cannot execute.
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => [
      name,
      VOICE_READ_TOOLS.has(name)
        ? definition
        : {
            ...definition,
            needsApproval: false,
            execute: async () => {
              throw new Error(
                "Voice preview is read-only. Use the chat controls for this action.",
              );
            },
          },
    ]),
  );
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
