import {
  experimental_composeSpec,
  type Experimental_CompositionEvaluator,
} from "@json-render/core";
import {
  checkedPilotSpec,
  fixedPilotSpec,
  PILOT_OPTIONS,
  pilotCatalog,
  type PilotChoice,
} from "../../lib/pilot-choices";

export async function composePilotChoices(
  id: string,
  evaluate: Experimental_CompositionEvaluator,
  models: string[],
): Promise<PilotChoice> {
  const start = Date.now();
  const result: PilotChoice = {
    id,
    version: 1,
    createdAt: start,
    expiresAt: start + 86400_000,
    selectedId: null,
    selectedAt: null,
    spec: fixedPilotSpec(),
    composition: { state: "fallback", models, calls: 0, elapsedMs: 0 },
  };
  try {
    for await (const event of experimental_composeSpec({
      catalog: pilotCatalog,
      candidates: [
        ...(["grid", "list"] as const).map((layout) => ({
          id: layout,
          resource: "root",
          description: `${layout === "grid" ? "Cards in columns when space allows" : "A vertical list of cards"} in a phone-friendly chat.`,
          element: { type: "Choices", props: { layout } },
        })),
        ...PILOT_OPTIONS.map((option) => ({
          id: option.id,
          root: false,
          description: `Required option: ${option.title}. ${option.summary} Estimated run after setup: ${option.effort}.`,
          element: { type: "PilotOption", props: { optionId: option.id } },
        })),
      ],
      prompt:
        "Present all three CUA research pilot options, easiest first, so the user can choose. Every option is required exactly once. Choose a readable chat layout. Arranging options does not select or approve one.",
      evaluate: async (request) => {
        result.composition.calls++;
        return evaluate(request);
      },
      maxSteps: 2,
      maxElements: 4,
      maxDepth: 2,
      signal: AbortSignal.timeout(12_000),
    })) {
      if (
        event.type === "complete" &&
        event.stopReason === "finish" &&
        event.spec
      ) {
        result.spec = checkedPilotSpec(event.spec);
        result.composition.state = "jev";
      }
    }
  } catch {
    result.spec = fixedPilotSpec();
    result.composition.state = "fallback";
  }
  result.composition.elapsedMs = Date.now() - start;
  return result;
}
