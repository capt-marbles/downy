import { expect, it, vi } from "vitest";
import {
  runServiceSetup,
  type SetupCheckpoint,
  type SetupVerification,
} from "./service-setup";
function fixture() {
  const storage = new Map<string, SetupCheckpoint>();
  let verification: SetupVerification | null = null;
  const deps = {
    load: async (service: string) => structuredClone(storage.get(service)),
    save: async (s: SetupCheckpoint) => {
      storage.set(s.service, structuredClone(s));
    },
    verify: vi.fn(async () => verification),
    discover: vi.fn(async () => ({
      candidates: [
        {
          name: "Airtable",
          toolkit: "airtable",
          path: "composio" as const,
          confidence: "confirmed" as const,
        },
      ],
      warnings: [] as string[],
    })),
    showCard: vi.fn(async () => {}),
  };
  return {
    deps,
    storage,
    setVerification: (v: SetupVerification) => {
      verification = v;
    },
  };
}
const ready: SetupVerification = {
  state: "ready",
  authorized: true,
  identity: "verified-account",
  readVerified: true,
  operations: ["list_records"],
  channels: ["chat", "voice"],
  checkedAt: 1234,
};
it("checks existing access before discovery and never restarts a verified connection", async () => {
  const f = fixture();
  f.setVerification(ready);
  expect(
    await runServiceSetup("Connect Airtable", false, f.deps),
  ).toMatchObject({ runbook: { step: "verified", verification: ready } });
  expect(f.deps.discover).not.toHaveBeenCalled();
  expect(f.deps.showCard).not.toHaveBeenCalled();
});
it("resumes authorization after restart without rediscovering, then verifies a read", async () => {
  const f = fixture();
  expect(await runServiceSetup("Airtable", false, f.deps)).toMatchObject({
    runbook: { step: "awaiting_authorization", attempts: 1 },
  });
  f.setVerification({ ...ready, state: "pending", readVerified: false });
  expect(
    await runServiceSetup("Connect Airtable", false, { ...f.deps }),
  ).toMatchObject({ runbook: { step: "awaiting_authorization" } });
  f.setVerification(ready);
  expect(await runServiceSetup("Airtable", false, { ...f.deps })).toMatchObject(
    { runbook: { step: "verified" } },
  );
  expect(f.deps.discover).toHaveBeenCalledTimes(1);
});
it("distinguishes outage from absence, persists attempts and stops at the retry budget", async () => {
  const f = fixture();
  f.deps.discover.mockResolvedValue({
    candidates: [],
    warnings: ["Catalog unavailable"],
  });
  expect(await runServiceSetup("Example", false, f.deps)).toMatchObject({
    runbook: { step: "discovery_unavailable" },
  });
  await runServiceSetup("Example", false, f.deps);
  expect(f.deps.discover).toHaveBeenCalledTimes(1);
  await runServiceSetup("Example", true, f.deps);
  await runServiceSetup("Example", true, f.deps);
  expect(await runServiceSetup("Example", true, f.deps)).toMatchObject({
    runbook: { step: "needs_instructions", attempts: 3 },
  });
  expect(f.deps.discover).toHaveBeenCalledTimes(3);
});
it("does not approve failed reads or expose provider errors", async () => {
  const f = fixture();
  f.setVerification({
    ...ready,
    state: "verification_failed",
    readVerified: false,
  });
  expect(await runServiceSetup("Airtable", false, f.deps)).toMatchObject({
    runbook: { step: "verification_failed" },
  });
  f.deps.verify.mockRejectedValue(new Error("secret-sentinel"));
  const failed = await runServiceSetup("Airtable", false, f.deps);
  expect(JSON.stringify(failed)).not.toContain("secret-sentinel");
  expect(f.deps.showCard).not.toHaveBeenCalled();
  expect(f.deps.discover).not.toHaveBeenCalled();
});
it("keeps an attached generic MCP unverified until an intended read is tested", async () => {
  const f = fixture();
  f.setVerification({
    ...ready,
    state: "attached",
    authorized: false,
    readVerified: false,
  });
  expect(await runServiceSetup("GitHub", false, f.deps)).toMatchObject({
    runbook: { step: "awaiting_read_verification" },
  });
  expect(f.deps.discover).not.toHaveBeenCalled();
});

it("allows an explicitly requested new discovery window after cooldown", async () => {
  const f = fixture();
  let now = 1000;
  f.deps.discover.mockResolvedValue({
    candidates: [],
    warnings: ["Unavailable"],
  });
  const deps = { ...f.deps, now: () => now };
  for (let i = 0; i < 3; i++) await runServiceSetup("Example", true, deps);
  now += 15 * 60_000;
  expect(await runServiceSetup("Example", true, deps)).toMatchObject({
    runbook: { attempts: 1, step: "discovery_unavailable" },
  });
  expect(f.deps.discover).toHaveBeenCalledTimes(4);
});

it("says plainly that a planned or CLI-only service cannot be connected, without discovery or a card", async () => {
  for (const [query, label] of [
    ["can you connect to Slack?", "Slack"],
    ["connect TaskFuel", "TaskFuel"],
  ]) {
    const f = fixture();
    const result = await runServiceSetup(query, false, f.deps);
    expect(result.runbook.step).toBe("not_available");
    expect(result.nextAction).toContain(
      `${label} cannot be connected from Downy yet`,
    );
    expect(result.nextAction).toContain("do not call find_tool_setup again");
    expect(f.deps.discover).not.toHaveBeenCalled();
    expect(f.deps.showCard).not.toHaveBeenCalled();
  }
});

it("routes an MCP-flow service to connect_mcp_server instead of discovery", async () => {
  const f = fixture();
  const result = await runServiceSetup("hook up Treg", false, f.deps);
  expect(result.runbook).toMatchObject({
    service: "treg",
    step: "connect_mcp",
  });
  expect(result.nextAction).toContain("https://treg.to/mcp/");
  expect(result.nextAction).toContain("catalog_search");
  expect(f.deps.discover).not.toHaveBeenCalled();
  // Once attached, the existing read-verification path takes over.
  f.setVerification({
    state: "attached",
    authorized: false,
    readVerified: false,
    operations: ["catalog_search", "call"],
    channels: ["chat"],
    checkedAt: 1,
  });
  expect(await runServiceSetup("treg", false, f.deps)).toMatchObject({
    runbook: { step: "awaiting_read_verification" },
  });
});

it("tells the truth about unknown services instead of asking the user to pick a candidate", async () => {
  const f = fixture();
  f.deps.discover.mockResolvedValueOnce({
    candidates: [
      {
        name: "HubSpot",
        toolkit: "hubspot",
        path: "composio",
        confidence: "confirmed",
      },
    ],
    warnings: [],
  });
  const result = await runServiceSetup("connect HubSpot", false, f.deps);
  expect(result.runbook.step).toBe("candidate_found");
  expect(result.nextAction).toContain(
    "no connection flow for this service yet",
  );
  expect(result.nextAction).not.toContain("Ask the user to select");
  expect(f.deps.showCard).not.toHaveBeenCalled();
});
