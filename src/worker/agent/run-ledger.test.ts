import { tool } from "ai";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { testDb } from "../../test/d1";
import {
  extractCost,
  ledgerToolSet,
  readRunLedgerStats,
  recordRunEvent,
  type RunEvent,
} from "./run-ledger";

it("finds metered cost directly, inside MCP text content, and nested, never throwing", () => {
  expect(extractCost({ cost_usd: 0.004, replayed: true, data: [] })).toEqual({
    costUsd: 0.004,
    replayed: true,
  });
  expect(
    extractCost({
      content: [
        {
          type: "text",
          text: JSON.stringify({ cost_usd: 0.002, results: [] }),
        },
        { type: "text", text: "not json" },
      ],
    }),
  ).toEqual({ costUsd: 0.002, replayed: false });
  expect(extractCost({ result: { billing: { cost_usd: 0.01 } } })).toEqual({
    costUsd: 0.01,
    replayed: false,
  });
  expect(extractCost({ cost_usd: "0.01" })).toEqual({
    costUsd: null,
    replayed: false,
  });
  expect(extractCost("plain")).toEqual({ costUsd: null, replayed: false });
  expect(extractCost(null)).toEqual({ costUsd: null, replayed: false });
});

it("records each call's outcome, cost and elapsed time and rethrows failures", async () => {
  const events: RunEvent[] = [];
  const tools = ledgerToolSet(
    {
      tool_treg_call: tool({
        inputSchema: z.object({}),
        execute: async () => ({ cost_usd: 0.003, people: [] }),
      }),
      gmail_email: tool({
        inputSchema: z.object({}),
        execute: async () => ({
          state: "failed",
          error: "Gmail action did not return a verified result.",
        }),
      }),
      write: tool({
        inputSchema: z.object({}),
        execute: async (): Promise<unknown> => {
          throw new Error("Voice only permits reads.");
        },
      }),
      schemaOnly: tool({ inputSchema: z.object({}) }),
    },
    {
      agentSlug: "sales",
      runId: () => "run-1",
      runKind: () => "voice",
      record: (event) => events.push(event),
    },
  );
  const options = { toolCallId: "t", messages: [] };
  expect(await tools.tool_treg_call.execute?.({}, options)).toMatchObject({
    cost_usd: 0.003,
  });
  await tools.gmail_email.execute?.(
    { action: "search", query: "in:drafts to:lead@example.com" },
    options,
  );
  await expect(tools.write.execute?.({}, options)).rejects.toThrow(
    "Voice only permits reads.",
  );
  expect(tools.schemaOnly.execute).toBeUndefined();
  expect(events).toMatchObject([
    {
      name: "tool_treg_call",
      state: "ok",
      costUsd: 0.003,
      replayed: false,
      runId: "run-1",
      runKind: "voice",
    },
    {
      name: "gmail_email",
      state: "failed",
      costUsd: null,
    },
    { name: "write", state: "failed" },
  ]);
  // Every row carries a short redacted rendering of the arguments.
  expect(events[0].summary).toMatch(/^input: /);
  expect(events[1].summary).toContain(
    "Gmail action did not return a verified result.",
  );
  expect(events[1].summary).toContain("input:");
  expect(events[2].summary).toContain("Voice only permits reads.");
  for (const event of events) expect(event.elapsedMs).toBeGreaterThanOrEqual(0);
});

it("summarizes spend, failures and staged outcomes per agent inside the window", async () => {
  const db = testDb(["0018_run_ledger.sql"]);
  vi.useFakeTimers();
  const NOW = 1_700_000_000_000;
  vi.setSystemTime(NOW);
  const base = {
    agentSlug: "sales",
    replayed: false,
    elapsedMs: 10,
    summary: null,
  };
  const rows: RunEvent[] = [
    {
      ...base,
      runId: "v1",
      runKind: "voice",
      event: "tool_call",
      name: "tool_treg_call",
      state: "ok",
      costUsd: 0.004,
    },
    {
      ...base,
      runId: "v1",
      runKind: "voice",
      event: "tool_call",
      name: "tool_treg_call",
      state: "ok",
      costUsd: 0.006,
      replayed: true,
    },
    {
      ...base,
      runId: "v1",
      runKind: "voice",
      event: "tool_call",
      name: "web_search",
      state: "ok",
      costUsd: null,
    },
    {
      ...base,
      runId: "c1",
      runKind: "chat",
      event: "tool_call",
      name: "gmail_email",
      state: "failed",
      costUsd: null,
    },
    {
      ...base,
      runId: "b1",
      runKind: "scheduled",
      event: "tool_call",
      name: "tool_treg_call",
      state: "ok",
      costUsd: 0.02,
    },
    {
      ...base,
      runId: "s1",
      runKind: "voice",
      event: "staged_action",
      name: "slack_post_message",
      state: "succeeded",
      costUsd: null,
    },
    {
      ...base,
      runId: "s2",
      runKind: "chat",
      event: "staged_action",
      name: "gmail_draft",
      state: "unknown",
      costUsd: null,
    },
    {
      ...base,
      agentSlug: "other",
      runId: "x",
      runKind: "chat",
      event: "tool_call",
      name: "tool_treg_call",
      state: "ok",
      costUsd: 5,
    },
  ];
  for (const row of rows) recordRunEvent(db, row);
  await vi.advanceTimersByTimeAsync(0);
  // An old row is outside the window.
  await db
    .prepare(
      `INSERT INTO run_events (id, agent_slug, run_id, run_kind, event, name, state, cost_usd, replayed, elapsed_ms, summary, created_at) VALUES ('old', 'sales', 'old', 'chat', 'tool_call', 'tool_treg_call', 'ok', 9, 0, 1, NULL, ?)`,
    )
    .bind(NOW - 25 * 3_600_000)
    .run();
  const stats = await readRunLedgerStats(db, "sales", NOW);
  vi.useRealTimers();
  expect(stats).toMatchObject({
    windowHours: 24,
    sampled: 7,
    runs: 5,
    toolCalls: 5,
    failedCalls: 1,
    replayedCalls: 1,
    spendUsd: 0.03,
    stagedActions: { succeeded: 1, failed: 0, unknown: 1, cancelled: 0 },
  });
  expect(stats.byTool[0]).toEqual({
    name: "tool_treg_call",
    calls: 3,
    failed: 0,
    spendUsd: 0.03,
  });
  expect(stats.byKind.map((entry) => [entry.kind, entry.spendUsd])).toEqual([
    ["chat", 0],
    ["voice", 0.01],
    ["scheduled", 0.02],
  ]);
});
