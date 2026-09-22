import type { Workspace } from "@cloudflare/shell";
import { createGrepTool } from "@cloudflare/think/tools/workspace";

/**
 * The stock grep resolves `include` through the workspace's SQL glob, which
 * rejects a long exact path ("LIKE or GLOB pattern too complex"). The model
 * greps the file an externalized result was saved to, so that path is the
 * common case. An exact path is read directly; a glob that the database
 * rejects is matched in code over the full file list instead.
 */
const GLOB_CHARS = /[*?[\]{}]/;
type Info = Awaited<ReturnType<Workspace["glob"]>>[number];

export function createSafeGrepTool(
  workspace: Pick<Workspace, "glob" | "stat" | "readFile">,
) {
  return createGrepTool({
    ops: {
      glob: async (pattern) => {
        if (!GLOB_CHARS.test(pattern)) {
          const exact = await statFile(workspace, pattern);
          if (exact) return [exact];
        }
        try {
          return await workspace.glob(pattern);
        } catch (error) {
          if (!/pattern too complex/i.test(String(error))) throw error;
          const matcher = globToRegExp(pattern);
          return (await workspace.glob("**/*")).filter((entry) =>
            matcher.test(entry.path),
          );
        }
      },
      readFile: (path) => workspace.readFile(path),
    },
  });
}

async function statFile(
  workspace: Pick<Workspace, "stat">,
  pattern: string,
): Promise<Info | null> {
  for (const path of [pattern, pattern.replace(/^\/+/, "")]) {
    try {
      const info = await workspace.stat(path);
      if (info?.type === "file") return info;
    } catch {
      // Not a file at that spelling; try the next one or the real glob.
    }
  }
  return null;
}

export function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/^\/+/, "")
    .split("**")
    .map((segment) =>
      segment
        .split("*")
        .map((part) =>
          part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\?/g, "[^/]"),
        )
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${source}$`);
}
