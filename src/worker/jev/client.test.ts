import { expect, it, vi } from "vitest";
import { runJev } from "./client";
import { evaluateCriteria } from "../campaign-room/criteria";
import { CAMPAIGN_ROOM_TEMPLATES } from "../campaign-room/templates";

const answer = {
  model: "jev-1.13.0",
  answers: {
    criterion_0: { type: "noul", noul: 0.05 },
    quality: {
      type: "score",
      score: 0.02,
      legend: { "0": "Incomplete", "1": "Needs revision", "2": "Clear" },
      probabilities: { "0": 0.99, "1": 0.01, "2": 0 },
      confidence: 0.97,
    },
  },
  usage: { input_tokens: 356, output_tokens: 37 },
};
const request = { state: "Artifact is missing", questions: {} };
function binding(response: unknown) {
  return { run: vi.fn(async () => response) };
}

it("blocks missing content using the real Workers AI completed envelope", async () => {
  const ai = binding({
    state: "Completed",
    result: answer,
    gatewayMetadata: { keySource: "Unified" },
  });
  const result = await evaluateCriteria({
    stage: CAMPAIGN_ROOM_TEMPLATES[0].stages[1],
    artifact: null,
    config: {
      enabled: true,
      passThreshold: 0.7,
      confidenceFloor: 0.6,
      disabledTemplates: [],
    },
    run: (input) => runJev(ai, input),
  });
  expect(result.state).toBe("blocked");
  expect(result.model).toBe("jev-1.13.0");
  expect(result.failingCriteria[0].probability).toBe(0.05);
});

it("accepts direct model answers", async () => {
  await expect(runJev(binding(answer), request)).resolves.toEqual(answer);
});

it.each(["Running", "Failed"])(
  "rejects a %s envelope even if it contains an answer",
  async (state) => {
    await expect(
      runJev(binding({ state, result: answer }), request),
    ).rejects.toThrow();
  },
);

it("rejects malformed completed answers", async () => {
  await expect(
    runJev(binding({ state: "Completed", result: {} }), request),
  ).rejects.toThrow();
});
