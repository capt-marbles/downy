import { expect, it, vi } from "vitest";
import {
  checkedResearchSpec,
  fixedResearchSpec,
} from "../../lib/research-view";
import { composeResearchView, researchPath, researchRecord } from "./compose";
import type { Experimental_CompositionEvaluator } from "@json-render/core";
const records = [0, 1].map((index) =>
  researchRecord(
    `workspace/research/report${index}.md`,
    `# Report ${index}\n\nA saved result.`,
    { size: 50, updatedAt: 100 },
    index,
  ),
);
const audit = { models: ["jev-test"], calls: 2, inputTokens: 123 };
const choose: Experimental_CompositionEvaluator = async ({ questions }) => ({
  answers: Object.fromEntries(
    Object.entries(questions).map(([key, question]) => [
      key,
      {
        choice:
          key === "root"
            ? "grid"
            : key.startsWith("order_")
              ? key.endsWith("1")
                ? "2"
                : "1"
              : Object.keys(question.criteria).find((option) =>
                  option.startsWith("use:file"),
                ) || "omit",
      },
    ]),
  ),
});
it("uses the real composer to arrange every verified card with at most two evaluations", async () => {
  const evaluate = vi.fn(choose);
  const snapshot = await composeResearchView(records, "all", evaluate, audit);
  expect(snapshot.composition.state).toBe("jev");
  expect(evaluate).toHaveBeenCalledTimes(2);
  expect(snapshot.spec.elements[snapshot.spec.root].children).toEqual([
    "node_2",
    "node_1",
  ]);
  expect(snapshot.records).toEqual(records);
  expect(JSON.stringify(evaluate.mock.calls)).not.toContain("A saved result.");
  expect(JSON.stringify(evaluate.mock.calls)).not.toContain(
    "workspace/research/",
  );
});
it("falls back to all verified files when Jev omits a required document", async () => {
  // eslint-disable-next-line unicorn/consistent-function-scoping -- Keep this failing evaluator fixture with its regression test.
  const omit: Experimental_CompositionEvaluator = async () => ({
    answers: {
      root: { choice: "grid" },
      ...Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [
          `select_${i}`,
          { choice: "omit" },
        ]),
      ),
    },
  });
  const snapshot = await composeResearchView(records, "all", omit, audit);
  expect(snapshot.composition.state).toBe("fallback");
  expect(snapshot.spec).toEqual(fixedResearchSpec(records));
  expect(snapshot.composition.reason).toContain("all verified files");
});
it("keeps all records visible if the evaluator fails without leaking its error", async () => {
  const snapshot = await composeResearchView(
    records,
    "reports",
    async () => {
      throw new Error("provider-private-value");
    },
    audit,
  );
  expect(snapshot.spec).toEqual(fixedResearchSpec(records));
  expect(snapshot.composition.state).toBe("fallback");
  expect(JSON.stringify(snapshot)).not.toContain("provider-private-value");
});
it("does not run inference on an empty workspace", async () => {
  const evaluate = vi.fn(choose);
  expect(
    (await composeResearchView([], "all", evaluate, audit)).composition.state,
  ).toBe("empty");
  expect(evaluate).not.toHaveBeenCalled();
});
it("rejects invented document IDs, missing files, and cycles", () => {
  const spec = fixedResearchSpec(records);
  spec.elements.file0 = {
    type: "Document",
    props: { recordId: "invented" },
    children: [],
  };
  expect(() => checkedResearchSpec(spec, records)).toThrow();
  expect(() =>
    checkedResearchSpec(fixedResearchSpec(records.slice(0, 1)), records),
  ).toThrow();
  const cycle = fixedResearchSpec(records);
  cycle.elements.shelf.children.push("shelf");
  expect(() => checkedResearchSpec(cycle, records)).toThrow();
});
it("rejects unsafe paths and excludes unrelated workspace content", () => {
  expect(() => researchPath("workspace/research/../private.md")).toThrow();
  expect(researchPath("workspace/corpus/private.md")).toBeNull();
  expect(researchPath("/workspace/research/report.md")).toBe(
    "workspace/research/report.md",
  );
});
it("previews source text rather than repeating the capture disclaimer", () => {
  const record = researchRecord(
    "workspace/research/browser/capture.md",
    "# Browser research\n\nSource page: https://x.com/search?q=CUA\n\nBounded browser capture, not exhaustive coverage or independent verification of claims.\n\n## Source 1\n\nhttps://x.com/example/status/1\n\n> Cua\n> This source describes a new browser research system for game developers.",
    { size: 300, updatedAt: 1 },
    0,
  );
  expect(record.title).toBe("CUA");
  expect(record.excerpt).toContain("new browser research system");
  expect(record.excerpt).not.toContain("Bounded browser capture");
});
