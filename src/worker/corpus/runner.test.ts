import { expect, it, vi } from "vitest";
import { testDb } from "../../test/d1";
import { runCorpusRepo } from "./runner";
const { sync } = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock("../lib/get-agent", () => ({
  getAgentStub: async () => ({ syncCorpusRepo: sync }),
}));
it("retains webhooks received while a sync owns the lease, including changes to the same path", async () => {
  const db = testDb(["0012_corpus_sync.sql"]);
  // Runner only exercises D1 and the mocked DO binding.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const env = { DB: db } as Cloudflare.Env;
  const repo = {
    key: "site",
    projectId: "project",
    ref: "main",
    include: ["src/**"],
    extensions: [".md"],
  };
  const path = "src/page.md";
  let calls = 0;
  sync.mockImplementation(async (_key, _cursor, paths) => {
    expect(paths).toEqual([path]);
    calls += 1;
    if (calls === 1) {
      expect(await runCorpusRepo(env, "test", repo, [path], true)).toBe(false);
    }
    return { cursor: null, done: true, fileCount: 1 };
  });
  await runCorpusRepo(env, "test", repo, [path], true);
  expect(
    (await db.prepare("SELECT * FROM corpus_pending_paths").all()).results,
  ).toHaveLength(1);
  await runCorpusRepo(env, "test", repo);
  expect(
    (await db.prepare("SELECT * FROM corpus_pending_paths").all()).results,
  ).toHaveLength(0);
  expect(sync).toHaveBeenCalledTimes(2);
});
