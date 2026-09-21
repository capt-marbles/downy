import { tool } from "ai";
import { expect, it } from "vitest";
import { z } from "zod";
import {
  externalizedPath,
  externalizeToolResults,
  shouldExternalize,
} from "./externalize-results";

function fixture(saved: Map<string, string>, failWrites = false) {
  const big = {
    rows: Array.from({ length: 800 }, (_, i) => ({ i, text: "x".repeat(20) })),
  };
  const tools = {
    web_scrape: tool({ inputSchema: z.object({}), execute: async () => big }),
    tool_treg_call: tool({
      inputSchema: z.object({}),
      execute: async () => ({ cost_usd: 0.004, ...big }),
    }),
    read: tool({ inputSchema: z.object({}), execute: async () => big }),
    web_search: tool({
      inputSchema: z.object({}),
      execute: async () => ({ hits: [1, 2] }),
    }),
    text: tool({
      inputSchema: z.object({}),
      execute: async () => "y".repeat(20_000),
    }),
  };
  return externalizeToolResults(tools, {
    getWorkspace: () => ({
      async writeFile(path: string, content: string) {
        if (failWrites) throw new Error("R2 down");
        saved.set(path, content);
      },
    }),
    now: () => Date.UTC(2026, 8, 21),
    id: () => "abcdef12-0000",
  });
}

it("replaces oversized results with a saved-file stub and leaves small and read results alone", async () => {
  const saved = new Map<string, string>();
  const tools = fixture(saved);
  const options = { toolCallId: "t", messages: [] };
  const stub: unknown = await tools.web_scrape.execute?.({}, options);
  const parsed = z
    .object({
      externalized: z.literal(true),
      tool: z.string(),
      path: z.string(),
      chars: z.number(),
      preview: z.string(),
    })
    .parse(stub);
  expect(parsed.tool).toBe("web_scrape");
  expect(parsed.path).toBe(
    "workspace/tool-output/2026-09-21/web_scrape-abcdef12.json",
  );
  expect(parsed.preview).toHaveLength(2000);
  expect(
    saved.get("workspace/tool-output/2026-09-21/web_scrape-abcdef12.json"),
  ).toContain('"rows"');
  const text: unknown = await tools.text.execute?.({}, options);
  expect(text).toMatchObject({ externalized: true, chars: 20_000 });
  expect(await tools.web_search.execute?.({}, options)).toEqual({
    hits: [1, 2],
  });
  const read: unknown = await tools.read.execute?.({}, options);
  expect(read).not.toHaveProperty("externalized");
  expect(shouldExternalize("read")).toBe(false);
  expect(shouldExternalize("tool_treg_call")).toBe(true);
});

it("fails open when the save fails and keeps a stable path shape", async () => {
  const saved = new Map<string, string>();
  const tools = fixture(saved, true);
  const result: unknown = await tools.web_scrape.execute?.(
    {},
    { toolCallId: "t", messages: [] },
  );
  expect(result).toHaveProperty("rows");
  expect(result).not.toHaveProperty("externalized");
  expect(saved.size).toBe(0);
  expect(
    externalizedPath("tool_treg_call", Date.UTC(2026, 0, 2), "12345678-x"),
  ).toBe("workspace/tool-output/2026-01-02/tool_treg_call-12345678.json");
  expect(externalizedPath("weird name!", 0, "id")).toBe(
    "workspace/tool-output/1970-01-01/weird_name_-id.json",
  );
});
