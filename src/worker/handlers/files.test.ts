/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- mock only the bindings used by the handler */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  deleteWorkspaceFile,
  listWorkspaceFiles,
  readCoreFile,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../../lib/api-client";
import { handleFilesRequest } from "./files";

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  stub: vi.fn(),
  listWorkspaceFiles: vi.fn(),
  readWorkspaceFile: vi.fn(),
  readCoreFile: vi.fn(),
  writeWorkspaceFile: vi.fn(),
  deleteWorkspaceFile: vi.fn(),
}));
vi.mock("agents", () => ({ getAgentByName: mocks.stub }));
vi.mock("../db/profile", () => ({ getAgent: mocks.getAgent }));
const env = { DB: {}, DownyAgent: {} } as unknown as Cloudflare.Env;
const base = "https://downy.test";
const report = "workspace/research/combined-research-summary.md";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAgent.mockImplementation((_db, slug: string) =>
    slug === "buildroom" || slug === "default"
      ? { slug, archivedAt: slug === "default" ? 1 : null }
      : null,
  );
  mocks.stub.mockResolvedValue(mocks);
  mocks.listWorkspaceFiles.mockResolvedValue([]);
  mocks.readWorkspaceFile.mockResolvedValue({
    content: "Saved report",
    stat: null,
  });
  mocks.readCoreFile.mockResolvedValue({
    path: "SOUL.md",
    label: "Soul",
    description: "",
    content: "Identity",
    updatedAt: null,
    isDefault: true,
  });
});
afterEach(() => vi.unstubAllGlobals());

it("reads and edits the selected workspace even if custom headers are dropped", async () => {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.delete("X-Agent-Slug");
    return handleFilesRequest(
      new Request(new URL(url, base), { ...init, headers }),
      env,
    );
  });
  expect(await listWorkspaceFiles("buildroom")).toEqual([]);
  expect(await readWorkspaceFile("buildroom", report)).toEqual({
    content: "Saved report",
    stat: null,
  });
  expect((await readCoreFile("buildroom", "SOUL.md")).content).toBe("Identity");
  await writeWorkspaceFile("buildroom", report, "Updated report");
  await deleteWorkspaceFile("buildroom", report);
  expect(mocks.getAgent).toHaveBeenCalledTimes(5);
  for (const call of mocks.getAgent.mock.calls) {
    expect(call[1]).toBe("buildroom");
  }
  expect(mocks.readWorkspaceFile).toHaveBeenCalledWith(report);
  expect(mocks.writeWorkspaceFile).toHaveBeenCalledWith(
    report,
    "Updated report",
  );
  expect(mocks.deleteWorkspaceFile).toHaveBeenCalledWith(report);
});

it("keeps header-only clients working and prevents caching between agents", async () => {
  const response = await handleFilesRequest(
    new Request(`${base}/api/files/workspace`, {
      headers: { "X-Agent-Slug": "buildroom" },
    }),
    env,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("X-Agent-Slug");
});

it.each([
  "",
  "?agentSlug=",
  "?agentSlug=../bad",
  "?agentSlug=buildroom&agentSlug=default",
])("rejects missing or ambiguous workspace selection: %s", async (query) => {
  const response = await handleFilesRequest(
    new Request(`${base}/api/files/workspace${query}`),
    env,
  );
  expect(response.status).toBe(400);
  expect(mocks.stub).not.toHaveBeenCalled();
});

it("rejects conflicting scope instead of writing to another agent", async () => {
  const response = await handleFilesRequest(
    new Request(`${base}/api/files/workspace/${report}?agentSlug=buildroom`, {
      method: "DELETE",
      headers: { "X-Agent-Slug": "default" },
    }),
    env,
  );
  expect(response.status).toBe(400);
  expect(mocks.stub).not.toHaveBeenCalled();
});

it.each([
  ["default", 410],
  ["unknown", 404],
] as const)(
  "preserves the archived and missing agent guards for %s",
  async (slug, status) => {
    const response = await handleFilesRequest(
      new Request(`${base}/api/files/workspace?agentSlug=${slug}`),
      env,
    );
    expect(response.status).toBe(status);
    expect(mocks.stub).not.toHaveBeenCalled();
  },
);
