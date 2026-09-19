import { z } from "zod";

// Requests describe reads, never browser scripts, selectors, or arbitrary clicks.
export const BrowserReadInputSchema = z
  .object({
    url: z.url().max(2000),
  })
  .strict();

export const XSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(1000),
    maxResults: z.number().int().min(1).max(20).default(10),
    // Retain compatibility with the existing research shortcut; these fields
    // cannot change the local adapter's read-only operations.
    mode: z.string().max(100).optional(),
    outputArtifact: z.string().max(100).optional(),
    context: z.unknown().optional(),
  })
  .strict();

export const BrowserResearchSchema = z.object({
  provider: z.literal("aside"),
  operation: z.enum(["x_search", "read_page"]),
  query: z.string().max(1000).optional(),
  observedAt: z.iso.datetime(),
  account: z.string().max(100).nullable(),
  pageUrl: z.url().max(4000),
  title: z.string().max(1000),
  summary: z.string().max(2000),
  sources: z
    .array(
      z.object({
        url: z.url().max(4000),
        text: z.string().max(24_000),
        links: z.array(z.url().max(4000)).max(40),
        truncated: z.boolean(),
      }),
    )
    .max(20),
  researchLimits: z.string().max(2000),
});
type BrowserResearch = z.infer<typeof BrowserResearchSchema>;

export function browserResearchPath(actionId: string): string {
  if (!/^hands-[0-9]+-[a-f0-9-]+$/.test(actionId))
    throw new Error("Invalid browser action id");
  return `workspace/research/browser/${actionId}.md`;
}

export function browserResearchMarkdown(result: BrowserResearch): string {
  return [
    "# Browser research",
    `Observed: ${result.observedAt} · Account: ${result.account ?? "public page"}`,
    `Source page: ${result.pageUrl}`,
    result.researchLimits,
    ...result.sources.map(
      (source, index) =>
        `## Source ${index + 1}\n\n${source.url}\n\n${source.truncated ? "Partial text — follow-up read needed.\n\n" : ""}${source.text
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}`,
    ),
    result.sources.length
      ? ""
      : "X explicitly reported no results for this query.",
  ].join("\n\n");
}
