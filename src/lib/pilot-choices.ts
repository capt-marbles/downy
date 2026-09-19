import { defineCatalog, type Spec } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

export const PilotOptionIdSchema = z.enum([
  "single-page",
  "source-comparison",
  "recovery",
]);
export type PilotOptionId = z.infer<typeof PilotOptionIdSchema>;
export const PilotSourceUrlsSchema = z
  .array(
    z
      .string()
      .max(2048)
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password
        );
      }, "Use a web URL without embedded credentials"),
  )
  .length(3)
  .refine(
    (urls) => new Set(urls).size === 3,
    "Add three different source URLs",
  );
export const PILOT_OPTIONS = [
  {
    id: "single-page",
    title: "Read one public page",
    summary:
      "Use CUA to read a known public documentation page and produce a short, sourced brief.",
    effort: "10–15 minutes",
    needs: "An isolated browser with CUA set up, plus one agreed public URL.",
    success:
      "Save a brief with the page title, source URL and three findings supported by the captured page.",
  },
  {
    id: "source-comparison",
    title: "Compare three sources",
    summary:
      "Compare three agreed public sources about AI tools for game development, with a clear account of what each supports.",
    effort: "20–30 minutes",
    needs: "CUA browser setup and three agreed public source URLs.",
    success:
      "Save a comparison linking every finding to a source, with disagreements and missing evidence called out.",
  },
  {
    id: "recovery",
    title: "Recover from a broken link",
    summary:
      "Test research reliability on a local mock site with pagination and a deliberately broken link.",
    effort: "15–25 minutes",
    needs: "CUA browser setup and a disposable local research fixture.",
    success:
      "Reach the correct source through an alternate route and save evidence of the recovery without leaving the test site.",
  },
] as const;
export const pilotCatalog = defineCatalog(schema, {
  components: {
    Choices: {
      props: z.object({ layout: z.enum(["grid", "list"]) }),
      slots: ["default"],
    },
    PilotOption: { props: z.object({ optionId: PilotOptionIdSchema }) },
  },
  actions: {},
});
const PilotSpecSchema = z
  .object({
    root: z.string(),
    elements: z.record(
      z.string(),
      z.discriminatedUnion("type", [
        z
          .object({
            type: z.literal("Choices"),
            props: z.object({ layout: z.enum(["grid", "list"]) }).strict(),
            children: z.array(z.string()).length(3),
          })
          .strict(),
        z
          .object({
            type: z.literal("PilotOption"),
            props: z.object({ optionId: PilotOptionIdSchema }).strict(),
            children: z.array(z.string()).length(0),
          })
          .strict(),
      ]),
    ),
  })
  .strict();
export const PilotChoiceSchema = z.object({
  id: z.uuid(),
  version: z.literal(1),
  createdAt: z.number(),
  expiresAt: z.number(),
  selectedId: PilotOptionIdSchema.nullable(),
  selectedAt: z.number().nullable(),
  sources: z
    .object({
      urls: PilotSourceUrlsSchema,
      revision: z.uuid(),
      savedAt: z.number(),
    })
    .nullable()
    .optional(),
  spec: PilotSpecSchema,
  composition: z.object({
    state: z.enum(["jev", "fallback"]),
    models: z.array(z.string()),
    calls: z.number(),
    elapsedMs: z.number(),
  }),
});
export type PilotChoice = z.infer<typeof PilotChoiceSchema>;
export const PilotChoicePartSchema = z.object({
  type: z.literal("data-pilot-choice"),
  data: z.object({ ticketId: z.uuid() }),
});

export function fixedPilotSpec(): PilotChoice["spec"] {
  return {
    root: "choices",
    elements: {
      choices: {
        type: "Choices",
        props: { layout: "list" },
        children: PILOT_OPTIONS.map((option) => option.id),
      },
      ...Object.fromEntries(
        PILOT_OPTIONS.map((option) => [
          option.id,
          {
            type: "PilotOption" as const,
            props: { optionId: option.id },
            children: [],
          },
        ]),
      ),
    },
  };
}
export function checkedPilotSpec(value: Spec): PilotChoice["spec"] {
  const spec = PilotSpecSchema.parse({
    root: value.root,
    elements: Object.fromEntries(
      Object.entries(value.elements).map(([id, el]) => {
        if (el.on || el.visible || el.repeat || el.slots)
          throw new Error("Unexpected choice behavior");
        return [
          id,
          { type: el.type, props: el.props, children: el.children ?? [] },
        ];
      }),
    ),
  });
  const root = spec.elements[spec.root];
  if (root?.type !== "Choices" || Object.keys(spec.elements).length !== 4)
    throw new Error("Invalid choice tree");
  const ids = root.children.map((child) => {
    const element = spec.elements[child];
    if (element?.type !== "PilotOption")
      throw new Error("Invalid choice child");
    return element.props.optionId;
  });
  if (new Set(ids).size !== 3) throw new Error("Missing or duplicate pilot");
  return spec;
}

export function selectedPilot(
  choice: PilotChoice,
  optionId: PilotOptionId,
  now: number,
): PilotChoice {
  PilotOptionIdSchema.parse(optionId);
  if (choice.selectedId) {
    if (choice.selectedId === optionId) return choice;
    throw new Error("A pilot has already been selected");
  }
  if (choice.expiresAt <= now)
    throw new Error("These pilot options have expired");
  return { ...choice, selectedId: optionId, selectedAt: now };
}
export function isPilotOptionsRequest(transcript: string): boolean {
  const turns = transcript.split(/(?:^|\n)You:\s*/);
  if (turns.length < 2) return false;
  const latest = turns.at(-1)!.split(/\nDowny:/)[0];
  return (
    /\bc[\s.-]*u[\s.-]*a\b/i.test(latest) &&
    /\bpilots?\b/i.test(latest) &&
    /\b(options|choices|choose|which|pick|try)\b/i.test(latest) &&
    !/\b(don't|do not|cancel|stop)\b/i.test(latest)
  );
}

export function pilotVoiceSelection(transcript: string): PilotOptionId | null {
  const turns = transcript.split(/(?:^|\n)You:\s*/);
  const latest =
    turns.length > 1
      ? turns
          .at(-1)!
          .split(/\nDowny:/)[0]
          .trim()
      : "";
  if (
    !/\bc[\s.-]*u[\s.-]*a\b/i.test(transcript) ||
    /\?|\b(don['’]t|do not|not|cancel|stop|maybe|unsure|or)\b/i.test(latest) ||
    !/^(?:(?:okay|ok|yes)[,.]?\s+)?(?:i (?:think|want|choose|pick|select)|i['’]d like|i would like|let['’]?s (?:choose|pick|go with)|choose|pick|select|the (?:first|second|third)|option (?:one|two|three|[123]))\b/i.test(
      latest,
    )
  )
    return null;
  const matches: PilotOptionId[] = [];
  if (
    /\b(?:read(?:ing)? (?:one|a) (?:public (?:documentation )?)?page|single[ -]page|first (?:one|option)|option (?:one|1))\b/i.test(
      latest,
    )
  )
    matches.push("single-page");
  if (
    /\b(?:compar(?:e|ing) three sources|three[ -]source comparison|second (?:one|option)|option (?:two|2))\b/i.test(
      latest,
    )
  )
    matches.push("source-comparison");
  if (
    /\b(?:recover(?:y|ing)?|broken link|third (?:one|option)|option (?:three|3))\b/i.test(
      latest,
    )
  )
    matches.push("recovery");
  return matches.length === 1 ? matches[0] : null;
}

export function savedPilotSources(
  choice: PilotChoice,
  urls: string[],
  now: number,
  revision: string,
): PilotChoice {
  const checked = PilotSourceUrlsSchema.parse(urls);
  if (choice.selectedId !== "source-comparison")
    throw new Error("Select the source comparison first");
  if (JSON.stringify(choice.sources?.urls) === JSON.stringify(checked))
    return choice;
  return { ...choice, sources: { urls: checked, revision, savedAt: now } };
}
