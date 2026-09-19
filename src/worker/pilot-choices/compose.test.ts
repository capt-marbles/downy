import { expect, it, vi } from "vitest";
import type { Experimental_CompositionEvaluator } from "@json-render/core";
import { fixedPilotSpec, checkedPilotSpec } from "../../lib/pilot-choices";
import { composePilotChoices } from "./compose";
const id = "11111111-1111-4111-8111-111111111111";
const choose: Experimental_CompositionEvaluator = async ({ questions }) => ({
  answers: Object.fromEntries(
    Object.entries(questions).map(([key, question]) => [
      key,
      {
        choice:
          key === "root"
            ? "grid"
            : key.startsWith("order_")
              ? key.split("_").at(-1)!
              : Object.keys(question.criteria).find((option) =>
                  option.startsWith("use:"),
                ) || "omit",
      },
    ]),
  ),
});
it("composes all three real options without making a selection", async () => {
  const evaluate = vi.fn(choose);
  const choice = await composePilotChoices(id, evaluate, ["jev-test"]);
  expect(choice.composition.state).toBe("jev");
  expect(choice.composition.models).toEqual(["jev-test"]);
  expect(evaluate).toHaveBeenCalledTimes(2);
  expect(checkedPilotSpec(choice.spec)).toEqual(choice.spec);
  expect(choice.selectedId).toBeNull();
  expect(choice.expiresAt - choice.createdAt).toBe(86400_000);
});
it("keeps every option visible when Jev omits options", async () => {
  const choice = await composePilotChoices(
    id,
    async () => ({ answers: { root: { choice: "grid" } } }),
    [],
  );
  expect(choice.composition.state).toBe("fallback");
  expect(choice.spec).toEqual(fixedPilotSpec());
});
it("falls back without exposing provider errors", async () => {
  const choice = await composePilotChoices(id, async () => {
    throw new Error("private-provider-detail");
  }, []);
  expect(choice.composition.state).toBe("fallback");
  expect(choice.spec).toEqual(fixedPilotSpec());
  expect(JSON.stringify(choice)).not.toContain("private-provider-detail");
});
