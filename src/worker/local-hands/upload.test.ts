import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  executeFilesystemFetch,
  safeFilePath,
} from "../../../scripts/local-hands-files.mjs";
import {
  assertFetchUpload,
  inboxPath,
  readFetchBytes,
  uniqueInboxPath,
} from "./upload";
import { testDb } from "../../test/d1";
import {
  claimNextLocalHandsAction,
  confirmLocalHandsAction,
  requestLocalHandsAction,
} from "./db";
const temporary: string[] = [];
afterEach(async () => {
  for (const root of temporary)
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "downy-fetch-test-"));
  temporary.push(root);
  await mkdir(path.join(root, "allowed"));
  return root;
}
it("rejects a symlink escape", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "secret"), "private");
  await symlink(
    path.join(root, "secret"),
    path.join(root, "allowed", "escape"),
  );
  await expect(
    safeFilePath(
      path.join(root, "allowed", "escape"),
      [path.join(root, "allowed")],
      100,
    ),
  ).rejects.toThrow("outside");
});
it("rejects oversized files before upload and refuses directories", async () => {
  const root = await fixture();
  const upload = vi.fn();
  await writeFile(path.join(root, "allowed", "big"), "123456");
  await expect(
    executeFilesystemFetch(
      { input: { sourcePath: path.join(root, "allowed", "big") } },
      { allowedRoots: [root], maxBytes: 5, upload },
    ),
  ).rejects.toThrow("6 exceeds 5");
  expect(upload).not.toHaveBeenCalled();
  await expect(safeFilePath(root, [root], 100)).rejects.toThrow("regular file");
});
it("forces confirmation and rejects another connector's upload", async () => {
  const db = testDb(["0006_local_hands.sql", "0008_local_hands_routing.sql"]);
  const action = await requestLocalHandsAction(db, {
    agentSlug: "test",
    input: {
      kind: "filesystem.fetch",
      riskLevel: "read_only",
      requiresConfirmation: false,
      requestedBy: "test",
      input: { sourcePath: "/known.txt" },
    },
  });
  expect(action.status).toBe("pending_confirmation");
  await confirmLocalHandsAction(db, {
    id: action.id,
    approved: true,
    reason: "",
  });
  const claimed = await claimNextLocalHandsAction(db, {
    agentSlug: "test",
    input: {
      connectorId: "studio",
      capabilities: ["filesystem.read"],
      allowedRoots: ["/"],
    },
  });
  expect(() => assertFetchUpload(claimed!, "test", "laptop")).toThrow();
  expect(() => assertFetchUpload(claimed!, "test", "studio")).not.toThrow();
});
it("suffixes collisions and rejects path traversal", async () => {
  const existing = new Set([
    "workspace/inbox/studio/report.md",
    "workspace/inbox/studio/report-2.md",
  ]);
  expect(
    await uniqueInboxPath(
      inboxPath("studio", "report.md"),
      async (candidatePath) => existing.has(candidatePath),
    ),
  ).toBe("workspace/inbox/studio/report-3.md");
  expect(() => inboxPath("../studio", "secret")).toThrow();
});
it("bounds chunked uploads without trusting Content-Length", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(6));
      controller.close();
    },
  });
  await expect(readFetchBytes(stream, 5)).rejects.toThrow("received 6 bytes");
});
