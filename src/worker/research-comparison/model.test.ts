/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Minimal Workers AI binding fixture. */
import { expect, it, vi } from "vitest";
import { comparisonAiBinding } from "./model";
it("disables Kimi draft reasoning without changing the shared binding or Jev", async () => {
  const run = vi.fn(async () => ({ response: "{}" }));
  const ai = { run } as unknown as Ai;
  const wrapped = comparisonAiBinding(ai);
  const input = { messages: [{ role: "user", content: "Write a draft" }] };
  await wrapped.run("@cf/moonshotai/kimi-k2.6", input);
  expect(run).toHaveBeenLastCalledWith("@cf/moonshotai/kimi-k2.6", {
    ...input,
    chat_template_kwargs: { thinking: false },
  });
  expect(input).not.toHaveProperty("chat_template_kwargs");
  await ai.run("@cf/moonshotai/kimi-k2.6", input);
  expect(run).toHaveBeenLastCalledWith("@cf/moonshotai/kimi-k2.6", input);
  await wrapped.run("typesafe/jev", { state: "test", questions: {} });
  expect(run).toHaveBeenLastCalledWith("typesafe/jev", {
    state: "test",
    questions: {},
  });
});
