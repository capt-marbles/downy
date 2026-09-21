import { expect, it } from "vitest";
import { testDb } from "../../test/d1";
import {
  readEffectGateStats,
  summarizeEffectDecisions,
} from "./effect-gate-stats";

const NOW = 1_000_000_000_000;
const HOUR = 3_600_000;

async function insert(
  db: D1Database,
  row: {
    agent?: string;
    context: string;
    state: string;
    tool: string;
    uncertain?: boolean;
    elapsed: number;
    at: number;
  },
) {
  await db
    .prepare(
      `INSERT INTO tool_effect_decisions (id, agent_slug, context, tool_name, state, effect, jev_class, jev_confidence, uncertain, jev_irreversible, jev_model_version, reason, elapsed_ms, created_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, 'test', ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      row.agent ?? "sales",
      row.context,
      row.tool,
      row.state,
      row.uncertain ? 1 : 0,
      row.elapsed,
      row.at,
    )
    .run();
}

it("summarizes decisions per context with percentiles, blocks and the window applied", async () => {
  const db = testDb(["0015_tool_effect_decisions.sql"]);
  const voice = [120, 300, 450, 600, 900, 1_400, 2_100, 5_000];
  for (const [i, elapsed] of voice.entries())
    await insert(db, {
      context: "voice",
      state: i === 7 ? "blocked" : "allowed",
      tool: i === 7 ? "tool_treg_call" : "web_search",
      uncertain: i === 6,
      elapsed,
      at: NOW - i * 1000,
    });
  await insert(db, {
    context: "chat",
    state: "blocked",
    tool: "web_scrape",
    elapsed: 700,
    at: NOW - 5,
  });
  await insert(db, {
    context: "chat",
    state: "blocked",
    tool: "web_scrape",
    elapsed: 800,
    at: NOW - 4,
  });
  await insert(db, {
    context: "chat",
    state: "blocked",
    tool: "gmail_email",
    elapsed: 900,
    at: NOW - 3,
  });
  await insert(db, {
    context: "chat",
    state: "unavailable",
    tool: "read",
    elapsed: 3_000,
    at: NOW - 2,
  });
  // Outside the window and for another agent: ignored.
  await insert(db, {
    context: "voice",
    state: "allowed",
    tool: "read",
    elapsed: 9_000,
    at: NOW - 25 * HOUR,
  });
  await insert(db, {
    agent: "other",
    context: "voice",
    state: "allowed",
    tool: "read",
    elapsed: 9_000,
    at: NOW,
  });

  const stats = await readEffectGateStats(db, "sales", NOW);
  expect(stats.windowHours).toBe(24);
  expect(stats.sampled).toBe(12);
  expect(stats.contexts.map((entry) => entry.context)).toEqual([
    "chat",
    "voice",
  ]);
  const [chat, voiceStats] = stats.contexts;
  expect(voiceStats).toMatchObject({
    decisions: 8,
    allowed: 7,
    blocked: 1,
    unavailable: 0,
    uncertain: 1,
    p50Ms: 600,
    p95Ms: 5_000,
    maxMs: 5_000,
    lastAt: NOW,
    blockedTools: [{ tool: "tool_treg_call", count: 1 }],
  });
  expect(chat).toMatchObject({
    decisions: 4,
    blocked: 3,
    unavailable: 1,
    blockedTools: [
      { tool: "web_scrape", count: 2 },
      { tool: "gmail_email", count: 1 },
    ],
  });
});

it("returns an empty summary with no rows and keeps context order stable", () => {
  expect(summarizeEffectDecisions([])).toEqual({
    windowHours: 24,
    sampled: 0,
    contexts: [],
  });
  const rows = ["background-read-only", "background", "voice", "chat"].map(
    (context, i) => ({
      context,
      state: "allowed",
      tool_name: "read",
      uncertain: 0,
      elapsed_ms: 10 * (i + 1),
      created_at: i,
    }),
  );
  expect(
    summarizeEffectDecisions(rows).contexts.map((entry) => entry.context),
  ).toEqual(["chat", "voice", "background", "background-read-only"]);
});
