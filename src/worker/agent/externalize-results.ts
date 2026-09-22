import type { ToolCallOptions, ToolSet } from "ai";
import { z } from "zod";
import type { Workspace } from "@cloudflare/shell";

/**
 * Large tool results are saved to the workspace and replaced in the
 * transcript by a stub with a preview and the file path. A 30k-character
 * scrape or record dump otherwise rides along in every later turn's prompt.
 * The model reads the file only when the preview is not enough.
 *
 * Fail-open: if the save fails, the original result is returned unchanged.
 * Only the executor's return value is replaced; nothing is dropped.
 */
const EXTERNALIZE_THRESHOLD_CHARS = 16_000;
const PREVIEW_CHARS = 2_000;
const TOOL_OUTPUT_DIR = "workspace/tool-output";

/** Tools whose results are never externalized: the model asked for exactly them. */
const NEVER_EXTERNALIZE: ReadonlySet<string> = new Set([
  "read",
  "list",
  "find",
  "grep",
  "read_skill",
  "list_skills",
  "list_skill_files",
  "read_user_profile",
  "read_peer_agent",
  "read_campaign_artifact",
]);

type ExternalizedResult = {
  externalized: true;
  tool: string;
  path: string;
  chars: number;
  preview: string;
  note: string;
};

export function shouldExternalize(name: string): boolean {
  return !NEVER_EXTERNALIZE.has(name);
}

// Airtable record pages are the common large result. A JSON head shows one
// or two records with their long text; a table of every record with short
// cells answers "which are the strongest" without a second read.
const PREVIEW_ROWS = 40;
const PREVIEW_CELL = 60;
const RecordPage = z.object({
  data: z.object({
    records: z.array(
      z.object({ id: z.string(), fields: z.record(z.string(), z.unknown()) }),
    ),
    offset: z.string().optional(),
  }),
});
function cell(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : Array.isArray(value)
          ? value
              .filter((v) => ["string", "number"].includes(typeof v))
              .map(String)
              .join("; ")
          : value === null || value === undefined
            ? ""
            : "[…]";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CELL
    ? `${flat.slice(0, PREVIEW_CELL - 1)}…`
    : flat;
}
export function compactPreview(result: unknown): string | null {
  const page = RecordPage.safeParse(result);
  if (!page.success) return null;
  const { records, offset } = page.data.data;
  const names = [
    ...new Set(records.flatMap((record) => Object.keys(record.fields))),
  ];
  const lines = [
    `${records.length} record(s)${offset ? "; more pages (offset present)" : ""}. Fields: ${names.join(", ")}.`,
    `id | ${names.join(" | ")}`,
    ...records
      .slice(0, PREVIEW_ROWS)
      .map(
        (record) =>
          `${record.id} | ${names.map((name) => cell(record.fields[name])).join(" | ")}`,
      ),
  ];
  if (records.length > PREVIEW_ROWS)
    lines.push(`… ${records.length - PREVIEW_ROWS} more in the file.`);
  return lines.join("\n");
}

function serializeResult(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (result === undefined || result === null) return null;
  try {
    return JSON.stringify(result, null, 1);
  } catch {
    return null;
  }
}

export function externalizedPath(
  name: string,
  now: number,
  id: string,
): string {
  const day = new Date(now).toISOString().slice(0, 10);
  const safe = name.replace(/[^a-z0-9_]+/gi, "_").slice(0, 48);
  return `${TOOL_OUTPUT_DIR}/${day}/${safe}-${id.slice(0, 8)}.json`;
}

export function externalizeToolResults(
  tools: ToolSet,
  deps: {
    getWorkspace: () => Pick<Workspace, "writeFile">;
    thresholdChars?: number;
    now?: () => number;
    id?: () => string;
  },
): ToolSet {
  const threshold = deps.thresholdChars ?? EXTERNALIZE_THRESHOLD_CHARS;
  const now = deps.now ?? Date.now;
  const id = deps.id ?? (() => crypto.randomUUID());
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute;
      if (!execute || !shouldExternalize(name)) return [name, definition];
      return [
        name,
        {
          ...definition,
          execute: async (
            input: unknown,
            options: ToolCallOptions,
          ): Promise<unknown> => {
            const result: unknown = await execute(input, options);
            const text = serializeResult(result);
            if (text === null || text.length <= threshold) return result;
            const path = externalizedPath(name, now(), id());
            try {
              await deps.getWorkspace().writeFile(path, text);
            } catch (error) {
              console.warn("[externalize] save failed; returning inline", {
                tool: name,
                chars: text.length,
                error: error instanceof Error ? error.message : String(error),
              });
              return result;
            }
            const compact = compactPreview(result);
            const stub: ExternalizedResult = {
              externalized: true,
              tool: name,
              path,
              chars: text.length,
              preview: compact ?? text.slice(0, PREVIEW_CHARS),
              note: `Full result (${text.length} chars) saved to ${path}. ${compact ? "This preview is a table of every record with cells shortened." : `This preview is the first ${PREVIEW_CHARS} characters.`} Answer from the preview when it is enough. To search the file, call grep with include set to that exact path and one plain term per call (fixedString true); to read it, call read with offset and limit. Do not paste it back into chat.`,
            };
            return stub;
          },
        },
      ];
    }),
  );
}
