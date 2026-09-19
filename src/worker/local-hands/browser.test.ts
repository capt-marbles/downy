import { expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import {
  browserRequest,
  executeBrowserResearch,
} from "../../../scripts/local-hands-browser.mjs";
import {
  BrowserResearchSchema,
  browserResearchPath,
} from "../../lib/browser-research";
import { testDb } from "../../test/d1";
import {
  requestLocalHandsAction,
  claimNextLocalHandsAction,
  getLocalHandsActionOrThrow,
} from "./db";

const saveBrowserResearch = vi.hoisted(() =>
  vi.fn(async () => "workspace/report.md"),
);
vi.mock("../lib/get-agent", () => ({
  AgentSlugError: class extends Error {},
  slugFromRequest: (request: Request) =>
    request.headers.get("x-agent-slug") ?? "buildroom",
  getAgentStub: async () => ({ saveBrowserResearch }),
}));
import { handleLocalHandsRequest } from "../handlers/local-hands";

const action = {
  kind: "x.research",
  riskLevel: "read_only",
  input: { query: "from:trycua CUA-S1" },
};
const result = BrowserResearchSchema.parse({
  provider: "aside",
  operation: "x_search",
  query: "CUA-S1",
  observedAt: "2026-09-18T12:00:00Z",
  account: "@gogameye",
  pageUrl: "https://x.com/search?q=CUA-S1",
  title: "Search",
  summary: "One source",
  researchLimits: "Bounded capture",
  sources: [
    {
      url: "https://x.com/trycua/status/123",
      text: "Announcement",
      links: [],
      truncated: false,
    },
  ],
});

it("accepts only bounded read requests and operator-approved destinations", () => {
  expect(browserRequest(action).url).toContain("from%3Atrycua");
  expect(() =>
    browserRequest({ ...action, riskLevel: "external_side_effect" }),
  ).toThrow("READ_ONLY");
  expect(() =>
    browserRequest({ ...action, input: { query: "x", script: "post()" } }),
  ).toThrow();
  expect(() =>
    browserRequest(
      { ...action, targetConnectorId: "mac-studio" },
      { connectorId: "mac-laptop" },
    ),
  ).toThrow("WRONG_CONNECTOR");
  for (const url of [
    "http://github.com/x",
    "https://localhost/",
    "https://github.com.evil.test/",
    "https://secret@github.com/x",
    "https://x.com/compose/post",
    "https://github.com/logout",
  ]) {
    expect(() =>
      browserRequest({
        kind: "browser",
        riskLevel: "read_only",
        input: { url },
      }),
    ).toThrow();
  }
  expect(
    browserRequest({
      kind: "browser",
      riskLevel: "read_only",
      input: { url: "https://github.com/trycua/cua" },
    }).operation,
  ).toBe("read_page");
});

// Execute the actual generated program against the Aside contract. This catches
// escaping, missing top-level await and unsupported locator-chaining regressions.
function asideFixture(
  options: {
    account?: string;
    empty?: boolean;
    noResults?: boolean;
    pageUrl?: string;
    publicText?: string;
  } = {},
) {
  const closed = vi.fn();
  const run = vi.fn(async (_bin: string, args: string[]) => {
    const lines: string[] = [];
    const page = {
      url: () => options.pageUrl ?? "https://x.com/search?q=CUA-S1&f=live",
      title: async () => "X search",
      getByRole: (role: string) => {
        if (role !== "button") throw new Error("Unsupported locator API");
        return {
          count: async () => 1,
          innerText: async () => options.account ?? "Gameye @gogameye",
        };
      },
      evaluate: async () =>
        options.empty
          ? []
          : [
              {
                text: options.publicText ?? "An observed announcement",
                links: [
                  "https://x.com/trycua/status/123",
                  "https://x.com/trycua/status/123",
                  "javascript:bad()",
                ],
              },
            ],
    };
    // vm.Script lacks top-level await; an async wrapper retains the real program's await.
    await runInNewContext(`(async()=>{${args[3]}})()`, {
      URL,
      console: { log: (line: string) => lines.push(line) },
      openTab: async () => page,
      closeTab: closed,
      snapshot: async () => ({
        tree: options.noResults ? "No results for" : "article Announcement",
        diff: "",
      }),
    });
    return { stdout: lines.join("\n") };
  });
  return { run, closed };
}

it("captures canonical links, bounds execution and closes its own tab", async () => {
  const fixture = asideFixture();
  const read = await executeBrowserResearch(action, fixture);
  expect(read.sources).toHaveLength(1);
  expect(read.sources[0].url).toBe("https://x.com/trycua/status/123");
  expect(read.sources[0].links).toEqual(["https://x.com/trycua/status/123"]);
  expect(fixture.closed).toHaveBeenCalledOnce();
  expect(fixture.run).toHaveBeenCalledWith(
    "aside",
    expect.any(Array),
    expect.objectContaining({ timeout: 60_000 }),
  );
});

it("does not report a broken page as a successful empty scan or use another X identity", async () => {
  await expect(
    executeBrowserResearch(action, asideFixture({ empty: true })),
  ).rejects.toThrow("BROWSER_INCOMPLETE");
  const fixture = asideFixture({ account: "@someoneelse" });
  await expect(executeBrowserResearch(action, fixture)).rejects.toThrow(
    "ACCOUNT_MISMATCH",
  );
  expect(fixture.closed).toHaveBeenCalledOnce();
  expect(
    (
      await executeBrowserResearch(
        action,
        asideFixture({ empty: true, noResults: true }),
      )
    ).sources,
  ).toEqual([]);
});

it("does not expose child stderr, argv or credentials on a failed read", async () => {
  await expect(
    executeBrowserResearch(action, {
      run: async () => {
        throw new Error("TOKEN=private stdout=private");
      },
    }),
  ).rejects.toThrow(/^BROWSER_UNAVAILABLE:/);
  expect(() => browserResearchPath("../../escape")).toThrow();
});

async function databaseFixture() {
  const db = testDb(["0006_local_hands.sql", "0008_local_hands_routing.sql"]);
  const created = await requestLocalHandsAction(db, {
    agentSlug: "buildroom",
    input: {
      kind: "x.research",
      riskLevel: "read_only",
      requiresConfirmation: false,
      requestedBy: "test",
      input: action.input,
    },
  });
  expect(created.targetConnectorId).toBe("mac-studio");
  expect(created.expiresAt).toBe(created.createdAt + 86_400_000);
  await claimNextLocalHandsAction(db, {
    agentSlug: "buildroom",
    input: {
      connectorId: "mac-studio",
      capabilities: ["x.research"],
      allowedRoots: [],
    },
  });
  return { db, created };
}
function completeRequest(
  id: string,
  connectorId = "mac-studio",
  slug = "buildroom",
  value: unknown = result,
) {
  return new Request(`https://downy.test/api/local-hands/${id}/complete`, {
    method: "POST",
    headers: { "x-agent-slug": slug, "content-type": "application/json" },
    body: JSON.stringify({ connectorId, status: "completed", result: value }),
  });
}

it("rejects another connector or agent and rejects skeleton browser completions", async () => {
  const { db, created } = await databaseFixture();
  // Only DB is used before an authenticated completion reaches the stub mock.
  // Stubbed getAgentStub above only needs the test database.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const env = { DB: db } as Cloudflare.Env;
  expect(
    (
      await handleLocalHandsRequest(
        completeRequest(created.id, "mac-laptop"),
        env,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleLocalHandsRequest(
        completeRequest(created.id, "mac-studio", "other"),
        env,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleLocalHandsRequest(
        completeRequest(created.id, "mac-studio", "buildroom", {
          mode: "skeleton",
        }),
        env,
      )
    ).status,
  ).toBe(400);
  expect((await getLocalHandsActionOrThrow(db, created.id)).status).toBe(
    "claimed",
  );
});

it("retries workspace delivery after D1 completion using the original result", async () => {
  const { db, created } = await databaseFixture();
  // Stubbed getAgentStub above only needs the test database.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const env = { DB: db } as Cloudflare.Env;
  saveBrowserResearch.mockRejectedValueOnce(
    new Error("R2 temporarily unavailable"),
  );
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(
    (await handleLocalHandsRequest(completeRequest(created.id), env)).status,
  ).toBe(500);
  expect((await getLocalHandsActionOrThrow(db, created.id)).status).toBe(
    "completed",
  );
  expect(
    (
      await handleLocalHandsRequest(
        completeRequest(created.id, "mac-studio", "buildroom", {
          injected: "replacement",
        }),
        env,
      )
    ).status,
  ).toBe(200);
  expect(saveBrowserResearch).toHaveBeenLastCalledWith(created.id, result);
  log.mockRestore();
});

it("persists a receipt and retries delivery after restart without repeating the browser read", async () => {
  const { createServer } = await import("node:http");
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const directory = await mkdtemp(`${tmpdir()}/downy-browser-retry-`);
  const calls = `${directory}/calls`;
  const executable = `${directory}/aside`;
  await writeFile(
    executable,
    `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nappendFileSync(${JSON.stringify(calls)}, 'read\\n');\nconsole.log(${JSON.stringify(`DOWNY_BROWSER_RESULT=${JSON.stringify(result)}`)});\n`,
    { mode: 0o700 },
  );
  let claimed = false;
  let completions = 0;
  const receipts: unknown[] = [];
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url?.endsWith("/claim")) {
      response.end(
        JSON.stringify({
          action: claimed
            ? null
            : {
                ...action,
                id: "hands-123-abcd",
                targetConnectorId: "mac-studio",
              },
        }),
      );
      claimed = true;
    } else if (request.url?.endsWith("/complete")) {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      receipts.push(JSON.parse(body));
      response.statusCode = ++completions === 1 ? 503 : 200;
      response.end("{}");
    } else response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test server");
  const env = {
    PATH: process.env.PATH,
    DOWNY_URL: `http://127.0.0.1:${address.port}`,
    DOWNY_HANDS_CONNECTOR_ID: "mac-studio",
    DOWNY_HANDS_ASIDE_ENABLED: "1",
    DOWNY_HANDS_BROWSER_ONLY: "1",
    DOWNY_HANDS_ASIDE_BIN: executable,
    DOWNY_HANDS_STATE_DIR: directory,
    DOWNY_HANDS_ONCE: "1",
  };
  try {
    await promisify(execFile)(process.execPath, ["scripts/downy-hands.mjs"], {
      env,
      timeout: 10_000,
    });
    expect(
      JSON.parse(await readFile(`${directory}/pending.json`, "utf8")),
    ).toMatchObject({ status: "completed" });
    await promisify(execFile)(process.execPath, ["scripts/downy-hands.mjs"], {
      env,
      timeout: 10_000,
    });
    expect(await readFile(calls, "utf8")).toBe("read\n");
    expect(receipts).toHaveLength(2);
    expect(receipts[0]).toEqual(receipts[1]);
    await expect(readFile(`${directory}/pending.json`)).rejects.toThrow();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

it("browser-only claims leave legacy actions with no capability untouched", async () => {
  const db = testDb(["0006_local_hands.sql", "0008_local_hands_routing.sql"]);
  const old = await requestLocalHandsAction(db, {
    agentSlug: "buildroom",
    input: {
      kind: "grok.research",
      riskLevel: "read_only",
      requiresConfirmation: false,
      requestedBy: "legacy",
      input: { query: "old" },
    },
  });
  await db
    .prepare(
      "UPDATE local_hands_actions SET required_capability = NULL WHERE id = ?",
    )
    .bind(old.id)
    .run();
  expect(
    await claimNextLocalHandsAction(db, {
      agentSlug: "buildroom",
      input: {
        connectorId: "mac-studio",
        capabilities: ["x.research", "browser.automation"],
        allowedRoots: [],
        kinds: ["x.research", "browser"],
      },
    }),
  ).toBeNull();
  expect((await getLocalHandsActionOrThrow(db, old.id)).status).toBe("queued");
});

it("reads native main content when Aside has no matching role locator", async () => {
  const input = {
    kind: "browser",
    riskLevel: "read_only",
    input: { url: "https://github.com/trycua/cua" },
  };
  const fixture = asideFixture({
    pageUrl: input.input.url,
    publicText: "Repository public README content. ".repeat(10),
  });
  const read = await executeBrowserResearch(input, fixture);
  expect(read.sources[0].url).toBe(input.input.url);
  expect(read.sources[0].text).toContain("Repository public README");
  expect(fixture.closed).toHaveBeenCalledOnce();
  await expect(
    executeBrowserResearch(
      input,
      asideFixture({ pageUrl: input.input.url, publicText: "Just a moment" }),
    ),
  ).rejects.toThrow("BROWSER_BLOCKED");
});
