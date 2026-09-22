import { expect, it, vi } from "vitest";
import { createSafeGrepTool, globToRegExp } from "./safe-grep";

const file = {
  path: "workspace/tool-output/2026-09-22/airtable_records-d0b1d314.json",
  name: "airtable_records-d0b1d314.json",
  type: "file" as const,
  mimeType: "application/json",
  size: 120,
  createdAt: 0,
  updatedAt: 0,
};
const content = '{\n "Fit Score": 82,\n "Tier": "A"\n}\n';

it("reads an exact path directly instead of asking the database to glob it", async () => {
  const glob = vi.fn(async () => {
    throw new Error("LIKE or GLOB pattern too complex: SQLITE_ERROR");
  });
  const stat = vi.fn(async (path: string) =>
    path === file.path ? file : null,
  );
  const readFile = vi.fn(async (path: string) =>
    path === file.path ? content : null,
  );
  const grep = createSafeGrepTool({ glob, stat, readFile });
  const options = { toolCallId: "g", messages: [] };
  const result = await grep.execute?.(
    { query: "Fit Score", include: `/${file.path}`, fixedString: true },
    options,
  );
  expect(result).toMatchObject({ totalMatches: 1, filesSearched: 1 });
  expect(glob).not.toHaveBeenCalled();
});

it("matches a rejected glob in code over the full file list", async () => {
  const other = { ...file, path: "workspace/notes/a.md", name: "a.md" };
  const glob = vi.fn(async (pattern: string) => {
    if (pattern === "**/*") return [file, other];
    throw new Error("LIKE or GLOB pattern too complex: SQLITE_ERROR");
  });
  const grep = createSafeGrepTool({
    glob,
    stat: async () => null,
    readFile: async (path) => (path === file.path ? content : "nothing"),
  });
  const result = await grep.execute?.(
    { query: "Tier", include: "workspace/tool-output/**/*.json" },
    { toolCallId: "g", messages: [] },
  );
  expect(result).toMatchObject({ filesSearched: 1, totalMatches: 1 });
  expect(globToRegExp("workspace/**/*.json").test(file.path)).toBe(true);
  expect(globToRegExp("workspace/*.json").test(file.path)).toBe(false);
  expect(globToRegExp("/workspace/notes/?.md").test(other.path)).toBe(true);
});
