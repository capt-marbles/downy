import { readAiProvider, readVoiceAiProvider } from "./get-model";
import type { AiProvider } from "../../lib/ai-providers";
import type { TurnInventoryRecord } from "./turn-inventory";

export type ModelTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  turnCount: number;
};

export type ModelStatus = {
  provider: AiProvider;
  providerLabel: string;
  model: string;
  contextWindowTokens: number | null;
  compactionThresholdTokens: number;
  lastTurn: ModelTurnDiagnostic | null;
  voiceProvider: AiProvider;
  /** Last measured turn per channel: tool schemas and prompt size. */
  inventory: TurnInventoryRecord;
  session: ModelTokenUsage & {
    estimatedCostUsd: number | null;
    costNote: string;
  };
};

export type ModelTurnDiagnostic = {
  requestId: string;
  status: "completed" | "error" | "aborted";
  completedAt: number;
  durationMs: number | null;
  chunks: number;
  assistantTextLength: number;
  assistantReasoningLength: number;
  finishReason: string | null;
  toolCalls: number;
  toolResults: number;
  warning: string | null;
  error: string | null;
};

export const MODEL_USAGE_KEY = "downy:model-usage";
export const MODEL_TURN_DIAGNOSTIC_KEY = "downy:model-last-turn";
export const COMPACTION_THRESHOLD_TOKENS = 150_000;

export const EMPTY_MODEL_USAGE: ModelTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  turnCount: 0,
};

const OPENAI_INPUT_PER_MILLION = 1.25;
const OPENAI_OUTPUT_PER_MILLION = 10;
const KIMI_INPUT_PER_MILLION = 0.56;
const KIMI_OUTPUT_PER_MILLION = 2.24;

export function parseUsage(
  value: unknown,
): Omit<ModelTokenUsage, "turnCount"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = numberField(value, [
    "inputTokens",
    "promptTokens",
    "input_tokens",
    "prompt_tokens",
  ]);
  const output = numberField(value, [
    "outputTokens",
    "completionTokens",
    "output_tokens",
    "completion_tokens",
  ]);
  const total = numberField(value, ["totalTokens", "total_tokens"]);
  if (input == null && output == null && total == null) return null;
  const inputTokens = input ?? 0;
  const outputTokens = output ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: total ?? inputTokens + outputTokens,
  };
}

function numberField(value: object, names: string[]): number | null {
  for (const [key, raw] of Object.entries(value)) {
    if (!names.includes(key)) continue;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return null;
}

export async function buildModelStatus(args: {
  db: D1Database;
  env: Env;
  lastTurn: ModelTurnDiagnostic | null | undefined;
  usage: ModelTokenUsage | null | undefined;
  inventory?: TurnInventoryRecord | null;
}): Promise<ModelStatus> {
  const [provider, voiceProvider] = await Promise.all([
    readAiProvider(args.db),
    readVoiceAiProvider(args.db),
  ]);
  const usage = args.usage ?? EMPTY_MODEL_USAGE;
  const pricing = estimateCost(provider, args.env, usage);
  return {
    provider,
    providerLabel: providerLabel(provider),
    model: modelName(provider, args.env),
    contextWindowTokens: contextWindow(provider),
    compactionThresholdTokens: COMPACTION_THRESHOLD_TOKENS,
    lastTurn: args.lastTurn ?? null,
    voiceProvider,
    inventory: args.inventory ?? { chat: null, voice: null },
    session: {
      ...usage,
      estimatedCostUsd: pricing.cost,
      costNote: pricing.note,
    },
  };
}

function providerLabel(provider: AiProvider): string {
  switch (provider) {
    case "boat-computer":
      return "ChatGPT subscription (Boat pilot)";
    case "cloud-computer":
      return "ChatGPT subscription (Cloudflare Computer)";
    case "kimi":
      return "Workers AI";
    case "openrouter":
      return "OpenRouter";
    case "pi-local":
      return "OpenAI subscription (local)";
    case "pi-prod":
      return "OpenAI subscription (VPC)";
  }
  return provider satisfies never;
}

function modelName(provider: AiProvider, env: Env): string {
  switch (provider) {
    case "boat-computer":
    case "cloud-computer":
      return env.DOWNY_CODEX_MODEL;
    case "kimi":
      return env.MODEL_ID;
    case "openrouter":
      return env.OPENROUTER_MODEL_ID || "OpenRouter model unset";
    case "pi-local":
    case "pi-prod":
      return "gpt-5.5";
  }
  return provider satisfies never;
}

function contextWindow(provider: AiProvider): number | null {
  switch (provider) {
    case "boat-computer":
    case "cloud-computer":
      return null;
    case "kimi":
      return 128_000;
    case "openrouter":
      return null;
    case "pi-local":
    case "pi-prod":
      return 200_000;
  }
  return provider satisfies never;
}

function estimateCost(
  provider: AiProvider,
  env: Env,
  usage: ModelTokenUsage,
): { cost: number | null; note: string } {
  switch (provider) {
    case "boat-computer":
      return {
        cost: null,
        note: "Uses your ChatGPT Codex allowance. Boat compute is billed separately; no automatic API fallback.",
      };
    case "cloud-computer":
      return {
        cost: null,
        note: "Uses your ChatGPT Codex allowance. Cloudflare compute is billed separately; no automatic API fallback.",
      };
    case "kimi":
      return {
        cost: price(usage, KIMI_INPUT_PER_MILLION, KIMI_OUTPUT_PER_MILLION),
        note: "Estimated from bundled Workers AI model pricing; verify against Cloudflare billing.",
      };
    case "openrouter":
      return {
        cost: null,
        note: env.OPENROUTER_MODEL_ID
          ? "Token usage captured. Cost needs OpenRouter model pricing metadata for the selected model."
          : "OpenRouter model is not configured.",
      };
    case "pi-local":
    case "pi-prod":
      return {
        cost: price(usage, OPENAI_INPUT_PER_MILLION, OPENAI_OUTPUT_PER_MILLION),
        note: "Estimated API-equivalent cost; ChatGPT subscription usage is not billed per token here.",
      };
  }
  return provider satisfies never;
}

function price(
  usage: ModelTokenUsage,
  inputPerMillion: number,
  outputPerMillion: number,
): number {
  return (
    (usage.inputTokens / 1_000_000) * inputPerMillion +
    (usage.outputTokens / 1_000_000) * outputPerMillion
  );
}
