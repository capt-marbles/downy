import { beforeEach, expect, it } from "vitest";
import { testDb } from "../../test/d1";
import { claimNextLocalHandsAction, requestLocalHandsAction } from "./db";

let db: D1Database;
beforeEach(() => {
  db = testDb(["0006_local_hands.sql", "0008_local_hands_routing.sql"]);
});
const laptop = {
  connectorId: "mac-laptop",
  capabilities: ["git.read" as const],
  allowedRoots: ["/Users/me/laptop"],
};
const enqueue = (extra = {}) =>
  requestLocalHandsAction(db, {
    agentSlug: "test",
    input: {
      kind: "git",
      riskLevel: "read_only",
      requiresConfirmation: false,
      requestedBy: "test",
      input: {},
      ...extra,
    },
  });
const claim = () =>
  claimNextLocalHandsAction(db, { agentSlug: "test", input: laptop });
it("laptop cannot claim a Studio-pinned action", async () => {
  await enqueue({ targetConnectorId: "mac-studio" });
  expect(await claim()).toBeNull();
});
it("checks normalized working directory boundaries", async () => {
  await enqueue({ input: { workingDirectory: "/Users/me/laptop/../studio" } });
  await enqueue({ input: { workingDirectory: "/Users/me/laptop-other" } });
  expect(await claim()).toBeNull();
  const valid = await enqueue({
    input: { workingDirectory: "/Users/me/laptop/project" },
  });
  expect((await claim())?.id).toBe(valid.id);
});
it("two simultaneous claims yield the action exactly once", async () => {
  await enqueue();
  const claims = await Promise.all([claim(), claim()]);
  expect(claims.filter(Boolean)).toHaveLength(1);
});
it("does not claim expired actions or missing capabilities", async () => {
  await enqueue({ expiresAt: Date.now() - 1 });
  await enqueue({
    kind: "browser",
    targetConnectorId: "mac-laptop",
    input: { url: "https://github.com/trycua/cua" },
  });
  expect(await claim()).toBeNull();
});
it("scheduled actions default to a 24 hour expiry", async () => {
  const action = await requestLocalHandsAction(db, {
    agentSlug: "test",
    scheduled: true,
    input: {
      kind: "git",
      riskLevel: "read_only",
      requiresConfirmation: false,
      requestedBy: "test",
      input: {},
    },
  });
  expect(action.expiresAt! - action.createdAt).toBe(86_400_000);
});
