import { expect, it, vi } from "vitest";

import { JevResponseSchema, type JevRunner } from "../jev/client";
import {
  composeVerdict,
  qualifyLeads,
  type LeadCandidate,
} from "./lead-qualify";

const candidate: LeadCandidate = {
  id: "c1",
  studio: "Ironhaven Games",
  game: "Ashfall",
  url: "https://example.com/ashfall-playtest",
  snippet:
    "Ironhaven opens the Ashfall 32-player extraction shooter playtest next month; servers in EU and NA.",
};

function response(over: {
  multiplayer?: string;
  mpConfidence?: number;
  launch?: number;
  serverPain?: number;
  funded?: number;
  isStudio?: number;
  excluded?: number;
  competitor?: string;
}) {
  const mp = over.multiplayer ?? "realtime_online";
  const comp = over.competitor ?? "none";
  return JevResponseSchema.parse({
    model: "jev-1.13.0",
    answers: {
      multiplayer_type: {
        type: "choice",
        choice: mp,
        confidence: over.mpConfidence ?? 0.95,
        probabilities: { [mp]: 0.95 },
      },
      launch_proximity: {
        type: "score",
        score: over.launch ?? 2,
        confidence: 0.9,
        probabilities: {},
        legend: {},
      },
      server_pain: { type: "noul", noul: over.serverPain ?? 0.8 },
      funded_or_backed: { type: "noul", noul: over.funded ?? 0.7 },
      is_studio_signal: { type: "noul", noul: over.isStudio ?? 0.95 },
      excluded: { type: "noul", noul: over.excluded ?? 0.05 },
      competitor: {
        type: "choice",
        choice: comp,
        confidence: 0.9,
        probabilities: { [comp]: 0.9 },
      },
    },
    usage: { input_tokens: 500, output_tokens: 60 },
  });
}

it("keeps a funded real-time studio near launch as Tier A, High, with a high Fit Score", () => {
  const v = composeVerdict(candidate, response({}), 0.6);
  expect(v).toMatchObject({
    decision: "keep",
    tier: "A",
    priority: "High",
    icpFit: "High",
    currentInfra: "Unknown",
  });
  // need 0.85 + 0.1 server pain = 0.95 -> 66.5 + 20 + 10 = 97
  expect(v.fitScore).toBe(97);
  expect(v.reasons).toContain("real-time online multiplayer");
});

it("makes unfunded small co-op Tier B and maps a named vendor to Current Infra", () => {
  const v = composeVerdict(
    candidate,
    response({
      multiplayer: "online_coop_small",
      funded: 0.1,
      serverPain: 0.2,
      launch: 1,
      competitor: "gamelift",
    }),
    0.6,
  );
  expect(v).toMatchObject({
    decision: "keep",
    tier: "B",
    priority: "Medium",
    currentInfra: "GameLift",
  });
  // need 0.6 -> 42 + 8 + 5 = 55 -> ICP Fit Medium
  expect(v.fitScore).toBe(55);
  expect(v.icpFit).toBe("Medium");
});

it.each([
  [{ excluded: 0.9 }, /exclusion/],
  [{ isStudio: 0.2 }, /not a studio/],
  [{ multiplayer: "local_or_single" }, /nothing to host/],
  [{ multiplayer: "online_low_intensity" }, /turn-based/],
])("drops %j with a reason", (over, reason) => {
  const v = composeVerdict(candidate, response(over), 0.6);
  expect(v.decision).toBe("drop");
  expect(v.tier).toBeNull();
  expect(v.fitScore).toBeLessThanOrEqual(20);
  expect(v.reasons.join(" ")).toMatch(reason);
});

it("sends an uncertain or unclear multiplayer type to review instead of deciding", () => {
  expect(
    composeVerdict(candidate, response({ mpConfidence: 0.4 }), 0.6),
  ).toMatchObject({
    decision: "needs_review",
    tier: null,
  });
  expect(
    composeVerdict(candidate, response({ multiplayer: "unclear" }), 0.6)
      .decision,
  ).toBe("needs_review");
});

it("rejects an unoffered class instead of guessing", () => {
  expect(() =>
    composeVerdict(candidate, response({ multiplayer: "banana" }), 0.6),
  ).toThrow(/Unoffered/);
});

it("evaluates candidates concurrently, isolates failures, and sums usage", async () => {
  let calls = 0;
  const run = vi.fn<JevRunner>(async () => {
    calls += 1;
    if (calls === 2) throw new Error("529 overloaded");
    return response({});
  });
  const result = await qualifyLeads({
    candidates: [
      candidate,
      { ...candidate, id: "c2" },
      { ...candidate, id: "c3" },
    ],
    run,
    config: { concurrency: 2 },
  });
  expect(result.outcomes.map((o) => o.state)).toEqual([
    "evaluated",
    "unavailable",
    "evaluated",
  ]);
  const failed = result.outcomes[1];
  expect(failed.id).toBe("c2");
  expect(failed.state === "unavailable" ? failed.error : "").toMatch(/529/);
  expect(result.inputTokens).toBe(1000);
  const [first] = run.mock.calls[0];
  expect(first.state).toMatchObject({
    studio: "Ironhaven Games",
    game: "Ashfall",
  });
  expect(Object.keys(first.questions)).toEqual([
    "multiplayer_type",
    "launch_proximity",
    "server_pain",
    "funded_or_backed",
    "is_studio_signal",
    "excluded",
    "competitor",
  ]);
});
