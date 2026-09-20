import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import ComparisonPanel from "./ComparisonPanel";
import { ComparisonRunSchema } from "../../lib/research-comparison";
vi.mock("../../lib/agents", () => ({ useCurrentAgentSlug: () => "test" }));
const id = "11111111-1111-4111-8111-111111111111";
const run = ComparisonRunSchema.parse({
  id,
  ticketId: id,
  sourceRevision: id,
  createdAt: 0,
  updatedAt: 1,
  urls: [
    "https://github.com/a",
    "https://github.com/b",
    "https://github.com/c",
  ],
  actionIds: ["a", "b", "c"],
  phase: "complete",
  error: null,
  sources: [
    {
      id: "s1",
      url: "https://github.com/a",
      capturedUrl: "https://github.com/a",
      observedAt: "today",
      text: "Source says this is only a prototype.",
      truncated: false,
      actionId: "a",
    },
  ],
  draft: {
    findings: [0, 1, 2].map(() => ({
      claim: "The tool is a prototype, according to the source.",
      citations: [
        { sourceId: "s1", quote: "Source says this is only a prototype." },
      ],
    })),
  },
  checks: [0, 1, 2].map((index) => ({
    index,
    status: "supported",
    reason: "Passed source support checks",
    quoteMatches: true,
    supportProbability: 0.95,
    supportConfidence: 0.9,
    contradictionProbability: 0.01,
    relevanceScore: 1.5,
    relevanceConfidence: 0.7,
  })),
  model: "jev-test",
  generator: "selected-model",
  reportPath: `workspace/research/comparisons/${id}/report.md`,
  auditPath: `workspace/research/comparisons/${id}/evaluation.json`,
  sample: [0, 2],
  feedback: [],
});
function render(value: typeof run | null) {
  const client = new QueryClient();
  client.setQueryData(["research-comparison", "test", id], value);
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ComparisonPanel, { ticketId: id, sourceRevision: id }),
    ),
  );
  client.clear();
  return html;
}
it("offers explicit start and explains which browser runs the pilot", () => {
  const html = render(null);
  expect(html).toContain("Start comparison with Studio");
  expect(html).toContain(
    "Sources saved. Tap Start comparison with Studio to begin research.",
  );
  expect(html).toContain("does not run CUA");
});
it("renders persisted findings, direct report links, review sample, and corrections", () => {
  const html = render(run);
  expect(html).toContain(`/agent/test/workspace/${run.reportPath}`);
  expect(html.match(/review sample/g)).toHaveLength(2);
  expect(html.match(/Save assessment/g)).toHaveLength(3);
  expect(html).toContain("not blind labeling");
  expect(html).not.toContain("Start comparison with Studio");
});
it("shows waiting status without starting work on render", () => {
  const html = render({ ...run, phase: "capturing" });
  expect(html).toContain("Waiting for three Studio captures");
  expect(html).not.toContain("Save assessment");
});
