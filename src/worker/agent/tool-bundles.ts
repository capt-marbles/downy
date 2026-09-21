import type { ToolSet } from "ai";

/**
 * Parent-only tools that belong to the lab: Campaign Room, Buildroom, local
 * hands and the Grok shortcut. They stay registered so nothing else changes,
 * but unless the agent's "Lab tools" setting is on their schemas are hidden
 * and their executors refuse, so a turn carries only the GTM inventory.
 * Everything not listed here is the default GTM bundle.
 */
export const LAB_TOOL_NAMES: ReadonlySet<string> = new Set([
  "create_buildroom_job",
  "list_buildroom_jobs",
  "write_campaign_artifact",
  "read_campaign_artifact",
  "list_campaign_schedule_presets",
  "schedule_campaign_room_preset",
  "list_buildroom_workflow_templates",
  "create_buildroom_workflow_template",
  "start_buildroom_workflow",
  "get_buildroom_workflow",
  "advance_buildroom_workflow",
  "record_buildroom_gate_decision",
  "confirm_local_hands_action",
  "list_local_hands_actions",
  "request_local_hands_action",
  "request_grok_research",
]);

const LAB_TOOLS_OFF_MESSAGE =
  "This lab tool is turned off for this agent, so nothing ran. Campaign Room, Buildroom and local hands are enabled per agent under Settings → Lab tools.";

/**
 * Hide and block the lab tools unless enabled. Think merges tool overrides
 * rather than replacing them, so a hidden tool keeps its name with a refusing
 * executor; callers also drop `hidden` from `activeTools` so the schema is
 * not advertised.
 */
export function bundleToolSet(
  tools: ToolSet,
  labEnabled: boolean,
): { tools: ToolSet; hidden: string[] } {
  if (labEnabled) return { tools, hidden: [] };
  const hidden: string[] = [];
  const bundled = Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      if (!LAB_TOOL_NAMES.has(name)) return [name, definition];
      hidden.push(name);
      return [
        name,
        {
          ...definition,
          needsApproval: false,
          execute: async () => {
            throw new Error(LAB_TOOLS_OFF_MESSAGE);
          },
        },
      ];
    }),
  );
  return { tools: bundled, hidden };
}

export function withoutHidden(names: string[], hidden: string[]): string[] {
  if (!hidden.length) return names;
  const drop = new Set(hidden);
  return names.filter((name) => !drop.has(name));
}
