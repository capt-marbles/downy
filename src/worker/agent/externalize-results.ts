import type { ToolCallOptions, ToolSet } from "ai";
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
            const stub: ExternalizedResult = {
              externalized: true,
              tool: name,
              path,
              chars: text.length,
              preview: text.slice(0, PREVIEW_CHARS),
              note: `Full result (${text.length} chars) saved to ${path}. This preview is the first ${PREVIEW_CHARS} characters. Read the file only if the preview does not answer the question; do not paste it back into chat.`,
            };
            return stub;
          },
        },
      ];
    }),
  );
}
