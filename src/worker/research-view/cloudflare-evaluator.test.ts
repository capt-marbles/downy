import { expect, it, vi } from "vitest";
import { createCloudflareEvaluator } from "./cloudflare-evaluator";
const questions = {
  root: {
    type: "choice" as const,
    instructions: "Pick layout",
    criteria: { grid: "Cards", list: "List" },
  },
};
const answer = {
  model: "jev-test",
  answers: {
    root: {
      type: "choice",
      choice: "grid",
      confidence: 0.8,
      probabilities: { grid: 0.8, list: 0.2 },
    },
  },
  usage: { input_tokens: 32, output_tokens: 2 },
};
it("adapts a real Workers AI envelope and preserves model attribution", async () => {
  const ai = {
    run: vi.fn().mockResolvedValue({ state: "Completed", result: answer }),
  };
  const record = vi.fn();
  const evaluate = createCloudflareEvaluator(ai, record);
  expect(
    await evaluate({
      state: { title: "Research" },
      questions,
      signal: new AbortController().signal,
    }),
  ).toEqual({
    answers: { root: { choice: "grid", confidence: 0.8 } },
    usage: { inputTokens: 32 },
  });
  expect(ai.run).toHaveBeenCalledWith("typesafe/jev", {
    state: { title: "Research" },
    questions,
  });
  expect(record).toHaveBeenCalledWith({ model: "jev-test", inputTokens: 32 });
});
it.each([{}, { root: { ...answer.answers.root, choice: "invented" } }])(
  "rejects missing and out-of-catalog answers",
  async (answers) => {
    const evaluate = createCloudflareEvaluator(
      { run: vi.fn().mockResolvedValue({ ...answer, answers }) },
      vi.fn(),
    );
    await expect(
      evaluate({ state: {}, questions, signal: new AbortController().signal }),
    ).rejects.toThrow();
  },
);
it("stops waiting when cancelled without issuing another inference", async () => {
  const ai = { run: vi.fn(() => new Promise(() => {})) };
  const record = vi.fn();
  const controller = new AbortController();
  const pending = createCloudflareEvaluator(
    ai,
    record,
  )({ state: {}, questions, signal: controller.signal });
  controller.abort(new Error("Time budget"));
  await expect(pending).rejects.toThrow("Time budget");
  expect(ai.run).toHaveBeenCalledTimes(1);
  expect(record).not.toHaveBeenCalled();
});
it("does not start inference for an already cancelled view", async () => {
  const ai = { run: vi.fn() };
  await expect(
    createCloudflareEvaluator(
      ai,
      vi.fn(),
    )({ state: {}, questions, signal: AbortSignal.abort() }),
  ).rejects.toThrow();
  expect(ai.run).not.toHaveBeenCalled();
});
