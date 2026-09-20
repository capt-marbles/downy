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
