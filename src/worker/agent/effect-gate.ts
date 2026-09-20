import type { ToolCallOptions, ToolSet } from "ai";
import { z } from "zod";

import {
  JevResponseSchema,
  withDeadline,
  type JevQuestion,
  type JevRunner,
} from "../jev/client";
import { DESTRUCTIVE_MCP_CONFIRMATION } from "./mcp-proxy";

/**
 * Pre-execution side-effect gate.
 *
 * Name allowlists (read-only workers, voice) decide which tools a turn may
 * call. They cannot see that the same tool is harmless or harmful depending
 * on its arguments: `web_scrape` of a product page reads, `web_scrape` of an
 * unsubscribe link with a token acts. Before a gated tool runs, Jev sorts the
 * exact call into one of five effect classes; code decides what to do with
 * the class. Jev never grants permission and never chooses an action. The
 * allowlists stay the hard floor, so an unavailable evaluator degrades to
 * today's behaviour rather than blocking research.
 */

export const EFFECT_CLASSES = [
  "read_only",
  "workspace_write",
  "proposal_only",
  "external_effect",
  "destructive",
] as const;
export type EffectClass = (typeof EFFECT_CLASSES)[number];
const EffectClassSchema = z.enum(EFFECT_CLASSES);

// Least to most risky. Used when the model is uncertain between two classes.
const RISK: Record<EffectClass, number> = {
  read_only: 0,
  workspace_write: 1,
  proposal_only: 2,
  external_effect: 3,
  destructive: 4,
};

const BLOCKED_EFFECTS: ReadonlySet<EffectClass> = new Set([
  "external_effect",
  "destructive",
]);

const EFFECT_CRITERIA: Record<EffectClass, string> = {
  read_only:
    "Only reads, lists, searches or fetches ordinary content; nothing outside the assistant changes",
  workspace_write:
    "Creates or changes files, notes or plans inside the assistant's own workspace only",
  proposal_only:
    "Creates a proposal or draft that a human must confirm before anything happens",
  external_effect:
    "Causes an effect outside the workspace: sends, schedules, submits, triggers, connects, pays, or acts on the user's machine or accounts",
  destructive:
    "Removes, disconnects or overwrites something that is hard to restore",
};

const GATE_QUESTIONS: Record<string, JevQuestion> = {
  effect: {
    type: "choice",
    instructions:
      "What is the worst-case effect of executing this tool call exactly as written? Judge the arguments, not just the tool name.",
    criteria: EFFECT_CRITERIA,
  },
  irreversible: {
    type: "noul",
    instructions:
      "Would the effect of this call be hard or impossible to undo?",
    criteria: {
      true: "Data, messages, connections or money would be lost or sent and cannot be recalled",
      false: "Nothing is lost, or it can be restored or repeated safely",
    },
  },
};

const STATE_NOTES = [
  "A URL containing words such as unsubscribe, confirm, verify, approve, delete, pay, checkout, or an action token can change state on the remote server even when fetched, so fetching it is an external effect.",
  "Any HTTP method other than GET is an external effect.",
  "A proposal or draft that a human must confirm before it takes effect is proposal_only.",
  "Reading, listing, grepping or searching, and fetching ordinary informational pages, are read_only.",
];

/** Chat tools whose declared purpose is to read; the gate checks their arguments. */
const READ_ORIENTED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "web_search",
  "web_scrape",
  "read",
  "list",
  "find",
  "grep",
  "read_skill",
  "list_skills",
  "list_skill_files",
  "read_peer_agent",
]);

/**
 * Composio-backed wrappers registered by name in DownyAgent. They reach the
 * user's accounts exactly as an MCP proxy does, so they are gated the same
 * way: Jev judges the action and arguments, and the decision is recorded.
 */
const CONNECTED_SERVICE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "gmail_email",
  "airtable_records",
]);

/**
 * In chat and full-access workers, gate the read-oriented tools, every MCP
 * proxy tool and the connected-service wrappers. MCP tools the name heuristic
 * already marks destructive carry an explicit confirmation field; a confirmed
 * call skips the gate.
 */
export function chatGateNames(tools: ToolSet): string[] {
  return Object.keys(tools).filter(
    (name) =>
      READ_ORIENTED_TOOL_NAMES.has(name) ||
      CONNECTED_SERVICE_TOOL_NAMES.has(name) ||
      name.startsWith("tool_"),
  );
}

export type EffectGateConfig = { enabled: boolean; confidenceFloor: number };

export function effectGateConfigFromEnv(
  env: Pick<
    Cloudflare.Env,
    "EFFECT_GATE_ENABLED" | "EFFECT_GATE_CONFIDENCE_FLOOR"
  >,
): EffectGateConfig {
  const floor = Number(env.EFFECT_GATE_CONFIDENCE_FLOOR);
  return {
    enabled: env.EFFECT_GATE_ENABLED !== "false",
    confidenceFloor: Number.isFinite(floor)
      ? Math.min(1, Math.max(0.5, floor))
      : 0.6,
  };
}

export type EffectDecision = {
  tool: string;
  state: "allowed" | "blocked" | "unavailable" | "skipped";
  /** Class the policy acted on (riskier of the top two when uncertain). */
  effect: EffectClass | null;
  /** Class the model ranked first. */
  choice: EffectClass | null;
  confidence: number | null;
  uncertain: boolean;
  irreversible: number | null;
  model: string | null;
  reason: string;
  elapsedMs: number;
};

export type EffectGateDeps = {
  run: JevRunner;
  config: EffectGateConfig;
  onDecision?: (decision: EffectDecision) => void;
  deadlineMs?: number;
};

const DEFAULT_DEADLINE_MS = 3_000;

// ---------------------------------------------------------------- redaction

const SECRET_KEY =
  /(token|secret|password|passwd|api[_-]?key|^key$|authorization|cookie|credential|bearer|session|signature|^sig$)/i;
const SECRET_VALUE = /^(Bearer|Basic)\s+\S+/i;
// One unbroken token-shaped word. Bounded so a long document is not mistaken
// for a credential.
const TOKEN_LIKE = /^[A-Za-z0-9_-]{20,200}$/;
const MAX_STRING = 1_500;
const MAX_ITEMS = 40;
const REDACTED = "[redacted]";

function redactUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  let changed = false;
  for (const key of Array.from(url.searchParams.keys())) {
    if (SECRET_KEY.test(key)) {
      url.searchParams.set(key, REDACTED);
      changed = true;
    }
  }
  if (url.username || url.password) {
    url.username = REDACTED;
    url.password = "";
    changed = true;
  }
  return changed ? url.toString() : value;
}

function redactString(value: string, key?: string): string {
  if (key && SECRET_KEY.test(key)) return REDACTED;
  if (SECRET_VALUE.test(value) || TOKEN_LIKE.test(value)) return REDACTED;
  const cleaned = /^https?:\/\//i.test(value) ? redactUrl(value) : value;
  return cleaned.length > MAX_STRING
    ? `${cleaned.slice(0, MAX_STRING)}…[truncated ${cleaned.length - MAX_STRING} chars]`
    : cleaned;
}

/** Strip secret-looking values and long content before anything leaves the worker. */
export function redactToolInput(value: unknown, key?: string): unknown {
  if (typeof value === "string") return redactString(value, key);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ITEMS)
      .map((item) => redactToolInput(item));
    return value.length > MAX_ITEMS
      ? [...items, `…[${value.length - MAX_ITEMS} more items]`]
      : items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactToolInput(v, k)]),
    );
  }
  return value;
}

// ---------------------------------------------------------------- classification

type EffectClassification = {
  choice: EffectClass;
  confidence: number;
  probabilities: Partial<Record<EffectClass, number>>;
  irreversible: number;
  model: string;
};

async function classifyToolCallEffect(args: {
  run: JevRunner;
  toolName: string;
  description?: string;
  input: unknown;
  deadlineMs?: number;
}): Promise<EffectClassification> {
  const state = {
    tool: {
      name: args.toolName,
      description: (args.description ?? "").slice(0, 400),
    },
    arguments: redactToolInput(args.input),
    notes: STATE_NOTES,
  };
  const response = JevResponseSchema.parse(
    await withDeadline(
      args.run({ state, questions: GATE_QUESTIONS }),
      args.deadlineMs ?? DEFAULT_DEADLINE_MS,
    ),
  );
  const effect = response.answers.effect;
  const irreversible = response.answers.irreversible;
  if (effect?.type !== "choice" || irreversible?.type !== "noul")
    throw new Error("Effect gate: missing answers");
  const choice = EffectClassSchema.safeParse(effect.choice);
  if (!choice.success) throw new Error("Effect gate: unoffered effect class");
  const probabilities: Partial<Record<EffectClass, number>> = {};
  for (const cls of EFFECT_CLASSES) {
    const p = effect.probabilities[cls];
    if (typeof p === "number") probabilities[cls] = p;
  }
  return {
    choice: choice.data,
    confidence: effect.confidence,
    probabilities,
    irreversible: irreversible.noul,
    model: response.model,
  };
}

/**
 * Confident answers are taken as given. Below the floor, assume the riskier
 * of the two most probable classes: uncertainty between "read" and
 * "workspace write" still runs, uncertainty between "external" and
 * "destructive" still blocks, and uncertainty that straddles the line blocks.
 */
export function decideEffect(
  classification: Pick<
    EffectClassification,
    "choice" | "confidence" | "probabilities"
  >,
  confidenceFloor: number,
): { effect: EffectClass; uncertain: boolean } {
  if (classification.confidence >= confidenceFloor)
    return { effect: classification.choice, uncertain: false };
  const ranked = EFFECT_CLASSES.map(
    (cls) => [cls, classification.probabilities[cls] ?? 0] as const,
  );
  ranked.sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 2).map(([cls]) => cls);
  if (!top.includes(classification.choice)) top[0] = classification.choice;
  const effect = top.reduce((riskiest, cls) =>
    RISK[cls] > RISK[riskiest] ? cls : riskiest,
  );
  return { effect, uncertain: true };
}

function isBlockedEffect(effect: EffectClass): boolean {
  return BLOCKED_EFFECTS.has(effect);
}

function hasEmptyInput(input: unknown): boolean {
  if (input == null) return true;
  if (typeof input === "object" && !Array.isArray(input))
    return Object.keys(input).length === 0;
  return false;
}

function isConfirmedDestructiveCall(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  return (
    "confirm_destructive_action" in input &&
    input.confirm_destructive_action === DESTRUCTIVE_MCP_CONFIRMATION
  );
}

function blockedMessage(tool: string, decision: EffectDecision): string {
  const what =
    decision.effect === "destructive"
      ? "remove, disconnect or overwrite something that is hard to restore"
      : "act outside the workspace (send, submit, schedule, trigger or connect)";
  const certainty = decision.uncertain
    ? "The classification was uncertain, so the riskier reading applies."
    : `Confidence ${decision.confidence?.toFixed(2) ?? "n/a"}.`;
  return `Blocked before running: this ${tool} call appears to ${what} given its arguments. ${certainty} This path only executes reads, workspace changes and proposals. Nothing ran. Choose a different input, or tell the user to take the action through the chat controls.`;
}

/**
 * Wrap the executors of the named tools with the gate. Unnamed tools, tools
 * without an executor, empty-argument calls and explicitly confirmed
 * destructive MCP calls pass straight through.
 */
export function gateToolSet(
  tools: ToolSet,
  options: EffectGateDeps & { names: Iterable<string> },
): ToolSet {
  if (!options.config.enabled) return tools;
  const gated = new Set(options.names);
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute;
      if (!gated.has(name) || !execute) return [name, definition];
      return [
        name,
        {
          ...definition,
          execute: async (
            input: unknown,
            callOptions: ToolCallOptions,
          ): Promise<unknown> => {
            const decision = await decideToolCall({
              ...options,
              toolName: name,
              description: definition.description,
              input,
            });
            if (decision.state === "blocked")
              throw new Error(blockedMessage(name, decision));
            const result: unknown = await execute(input, callOptions);
            return result;
          },
        },
      ];
    }),
  );
}

export async function decideToolCall(
  args: EffectGateDeps & {
    toolName: string;
    description?: string;
    input: unknown;
  },
): Promise<EffectDecision> {
  const started = Date.now();
  const base = {
    tool: args.toolName,
    effect: null,
    choice: null,
    confidence: null,
    uncertain: false,
    irreversible: null,
    model: null,
  };
  let decision: EffectDecision;
  if (hasEmptyInput(args.input)) {
    decision = {
      ...base,
      state: "skipped",
      reason: "no arguments",
      elapsedMs: 0,
    };
  } else if (isConfirmedDestructiveCall(args.input)) {
    decision = {
      ...base,
      state: "skipped",
      reason: "destructive MCP action explicitly confirmed by the user",
      elapsedMs: 0,
    };
  } else {
    try {
      const classification = await classifyToolCallEffect({
        run: args.run,
        toolName: args.toolName,
        description: args.description,
        input: args.input,
        deadlineMs: args.deadlineMs,
      });
      const { effect, uncertain } = decideEffect(
        classification,
        args.config.confidenceFloor,
      );
      const blocked = isBlockedEffect(effect);
      decision = {
        tool: args.toolName,
        state: blocked ? "blocked" : "allowed",
        effect,
        choice: classification.choice,
        confidence: classification.confidence,
        uncertain,
        irreversible: classification.irreversible,
        model: classification.model,
        reason: blocked
          ? `classified ${effect}${uncertain ? " (uncertain, riskier reading)" : ""}`
          : `classified ${effect}`,
        elapsedMs: Date.now() - started,
      };
    } catch (err) {
      // Fail open: the name allowlists remain the hard floor. Record it so an
      // outage is visible rather than silently widening what runs.
      decision = {
        ...base,
        state: "unavailable",
        reason: `evaluator failed: ${err instanceof Error ? err.message : String(err)}`,
        elapsedMs: Date.now() - started,
      };
    }
  }
  if (decision.state !== "skipped")
    console.log("[effect-gate]", {
      tool: decision.tool,
      state: decision.state,
      effect: decision.effect,
      confidence: decision.confidence,
      elapsedMs: decision.elapsedMs,
    });
  try {
    args.onDecision?.(decision);
  } catch (err) {
    console.warn("[effect-gate] onDecision failed", err);
  }
  return decision;
}

/**
 * Apply the gate to a voice turn's `{ tools, activeTools }` pair. Voice gates
 * the same names as chat: the allowlist already limits voice to reads plus a
 * few declared-purpose tools (`stage_action`, `create_bot`,
 * `spawn_background_task`, new-file `write`) whose own guardrails must not be
 * second-guessed by a probability.
 */
export function gateVoiceTurn<
  T extends { tools: ToolSet; activeTools: string[] },
>(turn: T, deps: EffectGateDeps): T {
  const names = chatGateNames(turn.tools).filter((name) =>
    turn.activeTools.includes(name),
  );
  return { ...turn, tools: gateToolSet(turn.tools, { ...deps, names }) };
}

export type EffectGateContext =
  | "chat"
  | "voice"
  | "background"
  | "background-read-only";

/** Persist one decision for inspection; never awaited by the tool call. */
export function recordEffectDecision(
  db: D1Database,
  agentSlug: string,
  context: EffectGateContext,
  decision: EffectDecision,
): void {
  if (decision.state === "skipped") return;
  void db
    .prepare(
      `INSERT INTO tool_effect_decisions (id, agent_slug, context, tool_name, state, effect, jev_class, jev_confidence, uncertain, jev_irreversible, jev_model_version, reason, elapsed_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      agentSlug,
      context,
      decision.tool,
      decision.state,
      decision.effect,
      decision.choice,
      decision.confidence,
      decision.uncertain ? 1 : 0,
      decision.irreversible,
      decision.model,
      decision.reason.slice(0, 500),
      decision.elapsedMs,
      Date.now(),
    )
    .run()
    .catch((err: unknown) => {
      console.warn("[effect-gate] failed to record decision", err);
    });
}
