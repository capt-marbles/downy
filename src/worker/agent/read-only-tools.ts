import type { ToolSet } from "ai";

/**
 * Tools a read-only background worker may execute: web research, workspace
 * and skill reads, and its own plan. Think auto-registers `list`/`find`/`grep`
 * off the workspace, so they are named here even though `buildSharedToolSet`
 * does not create them.
 */
const READ_ONLY_TOOL_NAMES = new Set([
  "web_search",
  "web_scrape",
  "read_peer_agent",
  "list_skills",
  "read_skill",
  "list_skill_files",
  "read",
  "list",
  "find",
  "grep",
  "todo_write",
]);

/**
 * Restrict a tool set to reads. Think merges tool overrides rather than
 * replacing them, so every other tool keeps its name with a blocked executor:
 * a hidden or hallucinated write call fails instead of reaching the workspace.
 * Callers should also pass `readOnlyActiveTools` so blocked schemas are hidden.
 */
export function readOnlyToolSet(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => [
      name,
      READ_ONLY_TOOL_NAMES.has(name)
        ? definition
        : {
            ...definition,
            needsApproval: false,
            execute: async () => {
              throw new Error(
                "This background task is read-only: it can search, scrape and read, but cannot write files, change skills or use connected services. Return your findings as the final document instead.",
              );
            },
          },
    ]),
  );
}

export function readOnlyActiveTools(tools: ToolSet): string[] {
  return Object.keys(tools).filter((name) => READ_ONLY_TOOL_NAMES.has(name));
}
