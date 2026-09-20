import { tool } from "ai";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import type { JevRunner } from "../jev/client";
import { DESTRUCTIVE_MCP_CONFIRMATION } from "./mcp-proxy";
import {
  chatGateNames,
  decideEffect,
  decideToolCall,
  effectGateConfigFromEnv,
  gateToolSet,
  redactToolInput,
  type EffectClass,
  type EffectDecision,
} from "./effect-gate";

const config = { enabled: true, confidenceFloor: 0.6 };

function answer(
  probabilities: Partial<Record<EffectClass, number>>,
  confidence: number,
  irreversible = 0.1,
) {
  const ranked = Object.entries(probabilities);
  ranked.sort((a, b) => b[1] - a[1]);
  const choice = ranked[0][0];
  return {
    model: "jev-1.13.0",
    answers: {
      effect: { type: "choice", choice, confidence, probabilities },
      irreversible: { type: "noul", noul: irreversible },
    },
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function fixture(names: string[]) {
  return Object.fromEntries(
    names.map((name) => [
      name,
      tool({
        description: `${name} tool`,
        inputSchema: z.object({}).passthrough(),
        execute: async (input) => ({ ran: name, input }),
      }),
    ]),
  );
}
const call = { toolCallId: "c", messages: [] };

it("blocks a confident external effect and leaves the executor unrun", async () => {
  const run = vi.fn<JevRunner>(async () =>
    answer({ external_effect: 0.9, read_only: 0.1 }, 0.85),
  );
  const decisions: EffectDecision[] = [];
  const tools = gateToolSet(fixture(["web_scrape"]), {
    names: ["web_scrape"],
    run,
    config,
    onDecision: (d) => decisions.push(d),
  });
  await expect(
    tools.web_scrape.execute?.(
      { urls: [{ url: "https://example.com/unsubscribe?token=abc" }] },
      call,
    ),
  ).rejects.toThrow(/Blocked before running.*web_scrape/);
  expect(decisions).toMatchObject([
    {
      state: "blocked",
      effect: "external_effect",
      confidence: 0.85,
      uncertain: false,
    },
  ]);
});

it("allows reads and workspace writes and passes the original input through", async () => {
  const run = vi.fn<JevRunner>(async () =>
    answer({ read_only: 0.7, workspace_write: 0.3 }, 0.9),
  );
  const tools = gateToolSet(fixture(["read"]), {
    names: ["read"],
    run,
    config,
  });
  await expect(tools.read.execute?.({ path: "a.md" }, call)).resolves.toEqual({
    ran: "read",
    input: { path: "a.md" },
  });
  expect(run).toHaveBeenCalledTimes(1);
});

it("assumes the riskier of the top two classes when uncertain", () => {
  expect(
    decideEffect(
      {
        choice: "external_effect",
        confidence: 0.42,
        probabilities: { external_effect: 0.5, destructive: 0.45 },
      },
      0.6,
    ),
  ).toEqual({ effect: "destructive", uncertain: true });
  expect(
    decideEffect(
      {
        choice: "read_only",
        confidence: 0.5,
        probabilities: { read_only: 0.55, workspace_write: 0.4 },
      },
      0.6,
    ),
  ).toEqual({ effect: "workspace_write", uncertain: true });
  expect(
    decideEffect(
      {
        choice: "read_only",
        confidence: 0.3,
        probabilities: { read_only: 0.5, external_effect: 0.45 },
      },
      0.6,
    ),
  ).toEqual({ effect: "external_effect", uncertain: true });
  expect(
    decideEffect(
      {
        choice: "external_effect",
        confidence: 0.9,
        probabilities: { external_effect: 0.95 },
      },
      0.6,
    ),
  ).toEqual({ effect: "external_effect", uncertain: false });
});

it("fails open when the evaluator errors, times out, or answers off-menu", async () => {
  const cases: JevRunner[] = [
    vi.fn<JevRunner>(async () => {
      throw new Error("529 overloaded");
    }),
    vi.fn<JevRunner>(() => new Promise(() => {})),
    vi.fn<JevRunner>(async () => ({
      ...answer({ read_only: 1 }, 1),
      answers: {
        effect: {
          type: "choice",
          choice: "banana",
          confidence: 1,
          probabilities: { banana: 1 },
        },
        irreversible: { type: "noul", noul: 0 },
      },
    })),
  ];
  for (const run of cases) {
    const decision = await decideToolCall({
      run,
      config,
      deadlineMs: 20,
      toolName: "web_search",
      input: { queries: ["x"] },
    });
    expect(decision.state).toBe("unavailable");
    expect(decision.reason).toMatch(/evaluator failed/);
  }
});

it("skips the evaluator for empty arguments and confirmed destructive MCP calls", async () => {
  const run = vi.fn<JevRunner>(async () => answer({ destructive: 1 }, 1));
  const tools = gateToolSet(fixture(["list_skills", "tool_x_delete"]), {
    names: ["list_skills", "tool_x_delete"],
    run,
    config,
  });
  await expect(tools.list_skills.execute?.({}, call)).resolves.toMatchObject({
    ran: "list_skills",
  });
  await expect(
    tools.tool_x_delete.execute?.(
      { id: "1", confirm_destructive_action: DESTRUCTIVE_MCP_CONFIRMATION },
      call,
    ),
  ).resolves.toMatchObject({ ran: "tool_x_delete" });
  expect(run).not.toHaveBeenCalled();
});

it("gates only the named tools and nothing when disabled", async () => {
  const run = vi.fn<JevRunner>(async () => answer({ destructive: 1 }, 1));
  const tools = gateToolSet(fixture(["write", "web_scrape"]), {
    names: ["web_scrape"],
    run,
    config,
  });
  await expect(
    tools.write.execute?.({ path: "p" }, call),
  ).resolves.toMatchObject({ ran: "write" });
  expect(run).not.toHaveBeenCalled();
  const off = gateToolSet(fixture(["web_scrape"]), {
    names: ["web_scrape"],
    run,
    config: { enabled: false, confidenceFloor: 0.6 },
  });
  await expect(
    off.web_scrape.execute?.({ urls: [] }, call),
  ).resolves.toMatchObject({ ran: "web_scrape" });
  expect(run).not.toHaveBeenCalled();
});

it("redacts secrets and trims long content before the state leaves the worker", () => {
  expect(
    redactToolInput({
      url: "https://example.com/unsubscribe?token=abc123&page=2",
      headers: { Authorization: "Bearer sk-live-123", Accept: "text/html" },
      apiKey: "plain",
      note: "Bearer abcdef",
      hash: "a".repeat(40),
      body: "x".repeat(2_000),
      items: Array.from({ length: 50 }, (_, i) => i),
    }),
  ).toEqual({
    url: "https://example.com/unsubscribe?token=%5Bredacted%5D&page=2",
    headers: { Authorization: "[redacted]", Accept: "text/html" },
    apiKey: "[redacted]",
    note: "[redacted]",
    hash: "[redacted]",
    body: `${"x".repeat(1500)}…[truncated 500 chars]`,
    items: [...Array.from({ length: 40 }, (_, i) => i), "…[10 more items]"],
  });
});

it("sends the redacted call, tool description and notes as the Jev state", async () => {
  const run = vi.fn<JevRunner>(async () => answer({ read_only: 1 }, 1));
  const tools = gateToolSet(fixture(["web_scrape"]), {
    names: ["web_scrape"],
    run,
    config,
  });
  await tools.web_scrape.execute?.(
    { urls: [{ url: "https://a.b/?key=SECRET" }] },
    call,
  );
  expect(run.mock.calls[0][0]).toMatchObject({
    state: {
      tool: { name: "web_scrape", description: "web_scrape tool" },
      arguments: { urls: [{ url: "https://a.b/?key=%5Bredacted%5D" }] },
    },
    questions: { effect: { type: "choice" }, irreversible: { type: "noul" } },
  });
});

it("picks read-oriented and MCP proxy tools for chat, and reads config from env", () => {
  expect(
    chatGateNames(
      fixture([
        "web_scrape",
        "write",
        "tool_airtable_list",
        "schedule_task",
        "grep",
      ]),
    ),
  ).toEqual(["web_scrape", "tool_airtable_list", "grep"]);
  expect(
    effectGateConfigFromEnv({
      EFFECT_GATE_ENABLED: "true",
      EFFECT_GATE_CONFIDENCE_FLOOR: "0.7",
    }),
  ).toEqual({ enabled: true, confidenceFloor: 0.7 });
  expect(
    effectGateConfigFromEnv({
      EFFECT_GATE_ENABLED: "false",
      EFFECT_GATE_CONFIDENCE_FLOOR: "nope",
    }),
  ).toEqual({ enabled: false, confidenceFloor: 0.6 });
});
