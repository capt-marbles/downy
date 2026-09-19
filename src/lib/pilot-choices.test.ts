import { expect, it } from "vitest";
import {
  checkedPilotSpec,
  fixedPilotSpec,
  isPilotOptionsRequest,
  selectedPilot,
  savedPilotSources,
  type PilotChoice,
} from "./pilot-choices";

function pending(): PilotChoice {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    version: 1,
    createdAt: 0,
    expiresAt: 100,
    selectedAt: null,
    selectedId: null,
    spec: fixedPilotSpec(),
    composition: { state: "fallback", models: [], calls: 0, elapsedMs: 0 },
  };
}

it("saves one preference, tolerates the same retry, and rejects changing it", () => {
  const original = pending();
  const saved = selectedPilot(original, "single-page", 50);
  expect(saved.selectedId).toBe("single-page");
  expect(saved.selectedAt).toBe(50);
  expect(original.selectedId).toBeNull();
  expect(selectedPilot(saved, "single-page", 200)).toBe(saved);
  expect(() => selectedPilot(saved, "recovery", 51)).toThrow("already");
});

it("saves and updates three sources only for a selected comparison, with idempotent retries", () => {
  const urls = [
    "https://one.test/docs",
    "https://two.test/docs",
    "https://three.test/docs",
  ];
  expect(() => savedPilotSources(pending(), urls, 50, "revision")).toThrow();
  const choice = selectedPilot(pending(), "source-comparison", 50);
  const saved = savedPilotSources(choice, urls, 60, "revision");
  expect(saved.sources?.urls).toEqual(urls);
  expect(savedPilotSources(saved, urls, 70, "retry")).toBe(saved);
  expect(
    savedPilotSources(
      saved,
      [...urls.slice(0, 2), "https://changed.test"],
      80,
      "next",
    ).sources?.revision,
  ).toBe("next");
  expect(() =>
    savedPilotSources(choice, urls.slice(0, 2), 60, "revision"),
  ).toThrow();
  expect(() =>
    savedPilotSources(choice, [urls[0], urls[0], urls[2]], 60, "revision"),
  ).toThrow();
  expect(() =>
    savedPilotSources(
      choice,
      ["javascript:alert(1)", ...urls.slice(1)],
      60,
      "revision",
    ),
  ).toThrow();
  expect(() =>
    savedPilotSources(
      choice,
      ["https://user:secret@example.com", ...urls.slice(1)],
      60,
      "revision",
    ),
  ).toThrow();
});
it("rejects a pending choice at its expiry boundary", () => {
  expect(() => selectedPilot(pending(), "recovery", 100)).toThrow("expired");
});
it("rejects invented options, missing options, cycles, and model-defined actions", () => {
  const spec = fixedPilotSpec();
  expect(checkedPilotSpec(spec)).toEqual(spec);
  spec.elements.choices.children = ["single-page", "single-page", "recovery"];
  expect(() => checkedPilotSpec(spec)).toThrow();
  spec.elements.choices.children = ["single-page", "invented", "recovery"];
  expect(() => checkedPilotSpec(spec)).toThrow();
  spec.elements.choices.children = ["choices", "source-comparison", "recovery"];
  expect(() => checkedPilotSpec(spec)).toThrow();
  expect(() =>
    checkedPilotSpec({
      ...fixedPilotSpec(),
      elements: {
        ...fixedPilotSpec().elements,
        recovery: {
          type: "PilotOption",
          props: { optionId: "recovery" },
          on: { press: { action: "start_task" } },
        },
      },
    }),
  ).toThrow();
});
it("only intercepts an explicit pilot-options request in the latest user caption", () => {
  expect(
    isPilotOptionsRequest("You: Show me CUA pilot options\nDowny: Checking."),
  ).toBe(true);
  expect(isPilotOptionsRequest("You: Which C U A pilot should we try?")).toBe(
    true,
  );
  expect(
    isPilotOptionsRequest(
      "You: Show CUA pilot options\nDowny: Here.\nYou: Read my latest report",
    ),
  ).toBe(false);
  expect(
    isPilotOptionsRequest("You: Hello\nDowny: Show me CUA pilot options"),
  ).toBe(false);
  expect(isPilotOptionsRequest("You: Don't show CUA pilot options")).toBe(
    false,
  );
  expect(isPilotOptionsRequest("You: Start the CUA pilot")).toBe(false);
  expect(isPilotOptionsRequest("You: What is CUA?")).toBe(false);
});
