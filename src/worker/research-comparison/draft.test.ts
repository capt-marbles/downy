import { expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { draftComparison } from "./draft";
const quote = "The source says this feature is experimental.";
const findings = [0, 1, 2].map(() => ({
  claim: quote,
  citations: [{ sourceId: "s1", quote }],
}));
it("uses the supplied model without tools and validates its JSON output", async () => {
  const generate = vi.fn(async () => ({
    content: [{ type: "text" as const, text: JSON.stringify({ findings }) }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: {
      inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 30, text: 30, reasoning: 0 },
    },
    warnings: [],
    response: { id: "r", timestamp: new Date(), modelId: "subscription-test" },
  }));
  const model = new MockLanguageModelV3({ doGenerate: generate });
  const result = await draftComparison(model, []);
  expect(result.generator).toBe("subscription-test");
  expect(result.draft.findings).toHaveLength(3);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0]).toBeDefined();
});
it("rejects malformed generated claims without a repair loop", async () => {
  const generate = vi.fn(async () => ({
    content: [{ type: "text" as const, text: '{"findings":[]}' }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: {
      inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 30, text: 30, reasoning: 0 },
    },
    warnings: [],
  }));
  await expect(
    draftComparison(new MockLanguageModelV3({ doGenerate: generate }), []),
  ).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(1);
});

it("reports an output-budget stop instead of accepting even valid partial JSON", async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ findings }) }],
      finishReason: { unified: "length", raw: "length" },
      usage: {
        inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5000, text: 100, reasoning: 4900 },
      },
      warnings: [],
    }),
  });
  await expect(draftComparison(model, [])).rejects.toThrow("output limit");
});
