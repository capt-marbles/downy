import type { EffectGateContext } from "./effect-gate";

/**
 * What the Jev effect gate has cost and decided for one agent recently, read
 * from the decisions it already records. Shown next to the turn inventory so
 * the gate's share of a voice turn's latency is visible, not guessed.
 */
export type EffectGateContextStats = {
  context: EffectGateContext;
  decisions: number;
  allowed: number;
  blocked: number;
  unavailable: number;
  uncertain: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  lastAt: number;
  /** Most-blocked tools in the window, most frequent first (at most three). */
  blockedTools: { tool: string; count: number }[];
};

export type EffectGateStats = {
  windowHours: number;
  /** Rows considered; the read is capped so a busy agent stays cheap. */
  sampled: number;
  contexts: EffectGateContextStats[];
};

const EFFECT_GATE_STATS_WINDOW_HOURS = 24;
const ROW_CAP = 2000;
const CONTEXT_ORDER: EffectGateContext[] = [
  "chat",
  "voice",
  "background",
  "background-read-only",
];

type Row = {
  context: string;
  state: string;
  tool_name: string;
  uncertain: number;
  elapsed_ms: number;
  created_at: number;
};

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index];
}

export function summarizeEffectDecisions(
  rows: readonly Row[],
  windowHours = EFFECT_GATE_STATS_WINDOW_HOURS,
): EffectGateStats {
  const byContext = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byContext.get(row.context) ?? [];
    list.push(row);
    byContext.set(row.context, list);
  }
  const contexts = CONTEXT_ORDER.filter((context) =>
    byContext.has(context),
  ).map((context): EffectGateContextStats => {
    const list = byContext.get(context) ?? [];
    // eslint-disable-next-line unicorn/no-array-sort -- fresh array; project targets ES2022
    const elapsed = list.map((row) => row.elapsed_ms).sort((a, b) => a - b);
    const blockedCounts = new Map<string, number>();
    for (const row of list)
      if (row.state === "blocked")
        blockedCounts.set(
          row.tool_name,
          (blockedCounts.get(row.tool_name) ?? 0) + 1,
        );
    return {
      context,
      decisions: list.length,
      allowed: list.filter((row) => row.state === "allowed").length,
      blocked: list.filter((row) => row.state === "blocked").length,
      unavailable: list.filter((row) => row.state === "unavailable").length,
      uncertain: list.filter((row) => row.uncertain !== 0).length,
      p50Ms: percentile(elapsed, 0.5),
      p95Ms: percentile(elapsed, 0.95),
      maxMs: elapsed.at(-1) ?? 0,
      lastAt: Math.max(...list.map((row) => row.created_at)),
      blockedTools: [...blockedCounts.entries()]
        .map(([tool, count]) => ({ tool, count }))
        // eslint-disable-next-line unicorn/no-array-sort -- fresh array; project targets ES2022
        .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool))
        .slice(0, 3),
    };
  });
  return { windowHours, sampled: rows.length, contexts };
}

export async function readEffectGateStats(
  db: D1Database,
  agentSlug: string,
  now = Date.now(),
): Promise<EffectGateStats> {
  const since = now - EFFECT_GATE_STATS_WINDOW_HOURS * 3_600_000;
  const result = await db
    .prepare(
      `SELECT context, state, tool_name, uncertain, elapsed_ms, created_at FROM tool_effect_decisions WHERE agent_slug = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ${ROW_CAP}`,
    )
    .bind(agentSlug, since)
    .all<Row>();
  return summarizeEffectDecisions(result.results ?? []);
}
