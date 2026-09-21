import type { ToolSet } from "ai";

/**
 * What one turn handed the model: how many tool schemas, how many were
 * advertised, and how large the system prompt was. Recorded per channel so
 * a change to bundles or prompts can be shown to help rather than assumed.
 * Token counts are estimates from characters; provider usage stays the
 * source of truth for billing.
 */
export type TurnInventory = {
  channel: "chat" | "voice";
  bundle: "gtm" | "gtm+lab" | "voice";
  toolDefinitions: number;
  activeTools: number;
  hiddenTools: number;
  systemChars: number;
  toolDescriptionChars: number;
  estimatedPromptTokens: number;
  recordedAt: number;
};

export type TurnInventoryRecord = {
  chat: TurnInventory | null;
  voice: TurnInventory | null;
};

export const TURN_INVENTORY_KEY = "downy:turn-inventory";

const CHARS_PER_TOKEN = 4;

export function measureTurnInventory(args: {
  channel: TurnInventory["channel"];
  bundle: TurnInventory["bundle"];
  system: string;
  tools: ToolSet;
  activeTools: string[];
  hidden: string[];
  now?: number;
}): TurnInventory {
  const active = new Set(args.activeTools);
  const toolDescriptionChars = Object.entries(args.tools)
    .filter(([name]) => active.has(name))
    .reduce((sum, [, tool]) => sum + (tool.description?.length ?? 0), 0);
  return {
    channel: args.channel,
    bundle: args.bundle,
    toolDefinitions: Object.keys(args.tools).length,
    activeTools: active.size,
    hiddenTools: args.hidden.length,
    systemChars: args.system.length,
    toolDescriptionChars,
    estimatedPromptTokens: Math.round(
      (args.system.length + toolDescriptionChars) / CHARS_PER_TOKEN,
    ),
    recordedAt: args.now ?? Date.now(),
  };
}
