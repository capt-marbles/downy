import { defineCatalog, type Spec } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

export const ResearchViewModeSchema = z.enum(["all", "cua", "reports"]);
export type ResearchViewMode = z.infer<typeof ResearchViewModeSchema>;
export const RESEARCH_VIEW_LABELS: Record<ResearchViewMode, string> = {
  all: "Everything",
  cua: "CUA & browsers",
  reports: "Reports first",
};

export const researchCatalog = defineCatalog(schema, {
  components: {
    Shelf: {
      props: z.object({ layout: z.enum(["grid", "list"]) }),
      slots: ["default"],
    },
    Section: {
      props: z.object({
        title: z.enum([
          "Reports & briefs",
          "Browser captures",
          "More research",
        ]),
      }),
      slots: ["default"],
    },
    Document: { props: z.object({ recordId: z.string() }) },
  },
  actions: {},
});

const ResearchRecordSchema = z.object({
  id: z.string(),
  path: z.string(),
  title: z.string(),
  excerpt: z.string(),
  kind: z.enum(["Report", "Pilot brief", "Browser capture", "Research"]),
  size: z.number(),
  updatedAt: z.number(),
});
export type ResearchRecord = z.infer<typeof ResearchRecordSchema>;

// This deliberately accepts only our read-only subset, including persisted
// snapshots. No event bindings, arbitrary URLs, dynamic state or model props.
const ResearchSpecSchema = z
  .object({
    root: z.string(),
    elements: z.record(
      z.string(),
      z.discriminatedUnion("type", [
        z
          .object({
            type: z.literal("Shelf"),
            props: z.object({ layout: z.enum(["grid", "list"]) }).strict(),
            children: z.array(z.string()),
          })
          .strict(),
        z
          .object({
            type: z.literal("Section"),
            props: z
              .object({
                title: z.enum([
                  "Reports & briefs",
                  "Browser captures",
                  "More research",
                ]),
              })
              .strict(),
            children: z.array(z.string()),
          })
          .strict(),
        z
          .object({
            type: z.literal("Document"),
            props: z.object({ recordId: z.string() }).strict(),
            children: z.array(z.string()).max(0),
          })
          .strict(),
      ]),
    ),
  })
  .strict();
export const ResearchSnapshotSchema = z.object({
  version: z.literal(1),
  mode: ResearchViewModeSchema,
  generatedAt: z.number(),
  checkedAt: z.number(),
  records: z.array(ResearchRecordSchema),
  spec: ResearchSpecSchema,
  composition: z.object({
    state: z.enum(["jev", "fallback", "empty"]),
    reason: z.string().nullable(),
    models: z.array(z.string()),
    calls: z.number(),
    inputTokens: z.number(),
    elapsedMs: z.number(),
  }),
  omitted: z.number(),
});
export type ResearchSnapshot = z.infer<typeof ResearchSnapshotSchema>;

export function researchFileHref(slug: string, path: string): string {
  return `/agent/${encodeURIComponent(slug)}/workspace/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function fixedResearchSpec(
  records: ResearchRecord[],
): ResearchSnapshot["spec"] {
  return {
    root: "shelf",
    elements: {
      shelf: {
        type: "Shelf",
        props: { layout: "list" },
        children: records.map((record) => record.id),
      },
      ...Object.fromEntries(
        records.map((record) => [
          record.id,
          {
            type: "Document" as const,
            props: { recordId: record.id },
            children: [],
          },
        ]),
      ),
    },
  };
}

export function checkedResearchSpec(
  value: Spec,
  records: ResearchRecord[],
): ResearchSnapshot["spec"] {
  // Composer emits optional state/slots. Only copy the literal subset we use.
  const spec = ResearchSpecSchema.parse({
    root: value.root,
    elements: Object.fromEntries(
      Object.entries(value.elements).map(([id, element]) => {
        if (element.on || element.visible || element.repeat || element.slots)
          throw new Error("Unexpected interactive spec");
        return [
          id,
          {
            type: element.type,
            props: element.props,
            children: element.children ?? [],
          },
        ];
      }),
    ),
  });
  const seen = new Set<string>();
  const found: string[] = [];
  const visit = (id: string, depth: number) => {
    if (seen.has(id) || depth > 3) throw new Error("Invalid research tree");
    seen.add(id);
    const element = spec.elements[id];
    if (!element || (depth === 0 && element.type !== "Shelf"))
      throw new Error("Invalid research root");
    if (element.type === "Document") found.push(element.props.recordId);
    for (const child of element.children) visit(child, depth + 1);
  };
  visit(spec.root, 0);
  if (
    seen.size !== Object.keys(spec.elements).length ||
    found.length !== records.length ||
    new Set(found).size !== records.length ||
    records.some((record) => !found.includes(record.id))
  )
    throw new Error("Research view omitted or invented a record");
  return spec;
}
