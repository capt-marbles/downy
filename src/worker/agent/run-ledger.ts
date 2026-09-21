import type { ToolCallOptions, ToolSet } from "ai";
import { redactToolInput } from "./effect-gate";

/**
 * Per-run ledger: every tool call and every settled staged action, with
 * elapsed time and any metered cost the tool reported. A run is one chat
 * turn, one voice lookup, one background or scheduled task. The ledger is
 * what turns "keep spend under five cents a lead" from an instruction into
 * a number, and it separates a tool that failed from a model that says it
 * did. Rows carry no tool arguments or results, only a bounded summary.
 */
export type RunKind = "chat" | "voice" | "background" | "scheduled";

export type RunEvent = {
  agentSlug: string;
  runId: string;
  runKind: RunKind;
  event: "tool_call" | "staged_action";
  name: string;
  state: "ok" | "failed" | "succeeded" | "unknown" | "cancelled";
  costUsd: number | null;
  replayed: boolean;
  elapsedMs: number;
  summary: string | null;
};

const SUMMARY_MAX = 500;
const ROW_CAP = 5000;
const WINDOW_HOURS = 24;
const TOP_TOOLS = 5;

/**
 * Find a metered cost in a tool result. Treg answers carry `cost_usd` and
 * `replayed` at the top level; through the MCP proxy they arrive as text
 * content holding that JSON. The search is depth-limited and never throws.
 */
export function extractCost(result: unknown): {
  costUsd: number | null;
  replayed: boolean;
} {
  const found = { costUsd: null as number | null, replayed: false };
  const visit = (value: unknown, depth: number): void => {
    if (depth > 4 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 20)) visit(item, depth + 1);
      return;
    }
    const record = toRecord(value);
    if (typeof record.cost_usd === "number" && Number.isFinite(record.cost_usd))
      found.costUsd = (found.costUsd ?? 0) + record.cost_usd;
    if (record.replayed === true) found.replayed = true;
    if (record.type === "text" && typeof record.text === "string") {
      const text = record.text.trim();
      if (text.startsWith("{") || text.startsWith("[")) {
        try {
          visit(JSON.parse(text), depth + 1);
        } catch {
          /* not JSON */
        }
      }
      return;
    }
    for (const [key, child] of Object.entries(record))
      if (key !== "cost_usd" && key !== "replayed") visit(child, depth + 1);
  };
  visit(result, 0);
  return found;
}

function toRecord(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

export function recordRunEvent(db: D1Database, event: RunEvent): void {
  void db
    .prepare(
      `INSERT INTO run_events (id, agent_slug, run_id, run_kind, event, name, state, cost_usd, replayed, elapsed_ms, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      event.agentSlug,
      event.runId,
      event.runKind,
      event.event,
      event.name,
      event.state,
      event.costUsd,
      event.replayed ? 1 : 0,
      event.elapsedMs,
      event.summary?.slice(0, SUMMARY_MAX) ?? null,
      Date.now(),
    )
    .run()
    .catch((err: unknown) => {
      console.warn("[run-ledger] failed to record event", err);
    });
}

export type LedgerDeps = {
  agentSlug: string;
  runId: () => string;
  runKind: () => RunKind;
  record: (event: RunEvent) => void;
};

/**
 * Wrap every executor so each call lands in the ledger with its outcome,
 * elapsed time and metered cost. Applied outermost, so a call the gate or a
 * channel policy refuses is recorded as failed with that reason. Errors are
 * rethrown unchanged.
 */
export function ledgerToolSet(tools: ToolSet, deps: LedgerDeps): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute;
      if (!execute) return [name, definition];
      return [
        name,
        {
          ...definition,
          execute: async (
            input: unknown,
            options: ToolCallOptions,
          ): Promise<unknown> => {
            const started = Date.now();
            const base = {
              agentSlug: deps.agentSlug,
              runId: deps.runId(),
              runKind: deps.runKind(),
              event: "tool_call" as const,
              name,
            };
            try {
              const result: unknown = await execute(input, options);
              const cost = extractCost(result);
              const failure = failedResult(result);
              deps.record({
                ...base,
                state: failure ? "failed" : "ok",
                costUsd: cost.costUsd,
                replayed: cost.replayed,
                elapsedMs: Date.now() - started,
                summary: failure ? withInput(failure, input) : null,
              });
              return result;
            } catch (error) {
              deps.record({
                ...base,
                state: "failed",
                costUsd: null,
                replayed: false,
                elapsedMs: Date.now() - started,
                summary: withInput(
                  error instanceof Error ? error.message : String(error),
                  input,
                ),
              });
              throw error;
            }
          },
        },
      ];
    }),
  );
}

// A failure is only diagnosable with its arguments. Keep a short, redacted
// rendering (keys, tokens and secrets masked by the gate's redactor) on
// failed rows only; successful rows never carry inputs.
function withInput(message: string, input: unknown): string {
  let rendered = "";
  try {
    rendered = JSON.stringify(redactToolInput(input)) ?? "";
  } catch {
    rendered = "";
  }
  const head = message.slice(0, 300);
  return rendered ? `${head} | input: ${rendered.slice(0, 180)}` : head;
}

// Connected-service wrappers return `{ state: "failed", error }` instead of
// throwing so the model can read the reason; the ledger still counts it.
function failedResult(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result))
    return null;
  const record = toRecord(result);
  if (record.state !== "failed") return null;
  return typeof record.error === "string" ? record.error : "failed";
}

export type RunLedgerStats = {
  windowHours: number;
  sampled: number;
  runs: number;
  toolCalls: number;
  failedCalls: number;
  replayedCalls: number;
  spendUsd: number;
  byKind: {
    kind: RunKind;
    runs: number;
    toolCalls: number;
    spendUsd: number;
  }[];
  byTool: { name: string; calls: number; failed: number; spendUsd: number }[];
  stagedActions: {
    succeeded: number;
    failed: number;
    unknown: number;
    cancelled: number;
  };
};

type Row = {
  run_id: string;
  run_kind: string;
  event: string;
  name: string;
  state: string;
  cost_usd: number | null;
  replayed: number;
};

const KINDS: RunKind[] = ["chat", "voice", "background", "scheduled"];

function summarizeRunEvents(rows: readonly Row[]): RunLedgerStats {
  const tools = rows.filter((row) => row.event === "tool_call");
  const staged = rows.filter((row) => row.event === "staged_action");
  const runIds = new Set(rows.map((row) => row.run_id));
  const byTool = new Map<
    string,
    { calls: number; failed: number; spendUsd: number }
  >();
  for (const row of tools) {
    const entry = byTool.get(row.name) ?? { calls: 0, failed: 0, spendUsd: 0 };
    entry.calls += 1;
    if (row.state === "failed") entry.failed += 1;
    entry.spendUsd += row.cost_usd ?? 0;
    byTool.set(row.name, entry);
  }
  const count = (state: string) =>
    staged.filter((row) => row.state === state).length;
  return {
    windowHours: WINDOW_HOURS,
    sampled: rows.length,
    runs: runIds.size,
    toolCalls: tools.length,
    failedCalls: tools.filter((row) => row.state === "failed").length,
    replayedCalls: tools.filter((row) => row.replayed !== 0).length,
    spendUsd: round(tools.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0)),
    byKind: KINDS.map((kind) => {
      const own = rows.filter((row) => row.run_kind === kind);
      return {
        kind,
        runs: new Set(own.map((row) => row.run_id)).size,
        toolCalls: own.filter((row) => row.event === "tool_call").length,
        spendUsd: round(own.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0)),
      };
    }).filter((entry) => entry.runs > 0),
    byTool: [...byTool.entries()]
      .map(([name, entry]) => ({
        name,
        ...entry,
        spendUsd: round(entry.spendUsd),
      }))
      // eslint-disable-next-line unicorn/no-array-sort -- fresh array; project targets ES2022
      .sort(
        (a, b) =>
          b.spendUsd - a.spendUsd ||
          b.calls - a.calls ||
          a.name.localeCompare(b.name),
      )
      .slice(0, TOP_TOOLS),
    stagedActions: {
      succeeded: count("succeeded"),
      failed: count("failed"),
      unknown: count("unknown"),
      cancelled: count("cancelled"),
    },
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export async function readRunLedgerStats(
  db: D1Database,
  agentSlug: string,
  now = Date.now(),
): Promise<RunLedgerStats> {
  const since = now - WINDOW_HOURS * 3_600_000;
  const result = await db
    .prepare(
      `SELECT run_id, run_kind, event, name, state, cost_usd, replayed FROM run_events WHERE agent_slug = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ${ROW_CAP}`,
    )
    .bind(agentSlug, since)
    .all<Row>();
  return summarizeRunEvents(result.results ?? []);
}
