import { afterEach, expect, it, vi } from "vitest";
import { syncCorpus } from "./sync";
import { readPush } from "./webhook";
import type { CorpusManifest } from "./types";
const repo = {
  key: "gameye",
  projectId: "group/site",
  ref: "main",
  include: ["src/content/**"],
  extensions: [".md", ".mdx"],
};
function workspace(manifest?: CorpusManifest) {
  const files = new Map<string, string>();
  if (manifest)
    files.set(
      "workspace/corpus/gameye/.manifest.json",
      JSON.stringify(manifest),
    );
  return {
    files,
    readFile: async (path: string) => files.get(path) ?? null,
    writeFile: async (path: string, value: string) => {
      files.set(path, value);
    },
    exists: async (path: string) => files.has(path),
    rm: async (path: string) => {
      files.delete(path);
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
it("fetches only new or changed blobs and removes deleted files", async () => {
  const ws = workspace({
    commit: "old",
    files: {
      "src/content/same.md": { blobId: "same" },
      "src/content/change.md": { blobId: "old" },
      "src/content/deleted.md": { blobId: "deleted" },
    },
  });
  ws.files.set("workspace/corpus/gameye/src/content/deleted.md", "old");
  const rawCalls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/commits/")) return Response.json({ id: "new-commit" });
      if (url.includes("/tree?"))
        return Response.json([
          { path: "src/content/same.md", id: "same", type: "blob" },
          { path: "src/content/change.md", id: "changed", type: "blob" },
        ]);
      rawCalls.push(url);
      return new Response("---\ntitle: Source\n---\nClean prose");
    }),
  );
  const result = await syncCorpus({
    repo,
    workspace: ws,
    token: "token",
    baseUrl: "https://gitlab.test",
  });
  expect(rawCalls).toHaveLength(1);
  expect(rawCalls[0]).toContain("src%2Fcontent%2Fchange.md/raw?ref=new-commit");
  expect(ws.files.has("workspace/corpus/gameye/src/content/deleted.md")).toBe(
    false,
  );
  expect(result.done).toBe(true);
});
it("rejects malicious repo paths before writing source files", async () => {
  const ws = workspace();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/commits/")
        ? Response.json({ id: "sha" })
        : Response.json([
            { id: "bad", path: "src/content/../../../secret.md", type: "blob" },
          ]),
    ),
  );
  await expect(
    syncCorpus({
      repo,
      workspace: ws,
      token: "token",
      baseUrl: "https://gitlab.test",
    }),
  ).rejects.toThrow("dot segments");
  expect(ws.files.size).toBe(0);
});
it("paginates beyond 100 tree entries and resumes a bounded cursor", async () => {
  const ws = workspace();
  const pages: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/commits/")) return Response.json({ id: "sha" });
      if (url.includes("/tree?")) {
        pages.push(url);
        const second = url.includes("page=2");
        return Response.json(
          Array.from({ length: second ? 1 : 100 }, (_, i) => ({
            path: `src/content/${second ? 100 : i}.md`,
            id: `blob-${second ? 100 : i}`,
            type: "blob",
          })),
          { headers: { "x-next-page": second ? "" : "2" } },
        );
      }
      return new Response("prose");
    }),
  );
  let result = await syncCorpus({
    repo,
    workspace: ws,
    token: "token",
    baseUrl: "https://gitlab.test",
    budget: 30,
  });
  expect(result.cursor).not.toBeNull();
  for (let i = 0; result.cursor && i < 30; i++)
    result = await syncCorpus({
      repo,
      workspace: ws,
      token: "token",
      baseUrl: "https://gitlab.test",
      cursor: result.cursor,
      budget: 30,
    });
  expect(result.done).toBe(true);
  expect(result.fileCount).toBe(101);
  expect(pages).toHaveLength(2);
});
it("rejects a wrong webhook token before body parsing or any GitLab call", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(
    await readPush(
      new Request("https://downy.test/api/corpus/gitlab-webhook", {
        method: "POST",
        headers: { "x-gitlab-token": "wrong" },
        body: "not JSON",
      }),
      "right",
    ),
  ).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
