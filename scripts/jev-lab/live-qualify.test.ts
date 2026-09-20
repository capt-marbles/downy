import { expect, it } from "vitest";

import type { JevRequest } from "../../src/worker/jev/client";
import {
  qualifyLeads,
  type LeadCandidate,
} from "../../src/worker/runbooks/lead-qualify";

// Live check of the shipped lead-qualification rubric against the real model
// through the scratch proxy. Skipped unless JEV_PROXY_LIVE=1.
const live = process.env.JEV_PROXY_LIVE === "1";
const proxy = process.env.JEV_PROXY ?? "http://localhost:8799";

async function run(request: JevRequest): Promise<unknown> {
  const res = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const body: unknown = await res.json();
  if (!body || typeof body !== "object" || !("raw" in body))
    throw new Error(`proxy: ${JSON.stringify(body)}`);
  const raw = body.raw;
  if (raw && typeof raw === "object" && "result" in raw) return raw.result;
  return raw;
}

const c = (
  id: string,
  studio: string,
  snippet: string,
  expect: "keep" | "drop" | "needs_review",
  tier?: "A" | "B",
): LeadCandidate & { expect: string; tier?: string } => ({
  id,
  studio,
  url: `https://example.com/${id}`,
  snippet,
  expect,
  tier,
});

const CASES = [
  c(
    "ironhaven",
    "Ironhaven Games",
    "Ironhaven Games, fresh off a $4M seed round, opens the Ashfall playtest next month: a 32-player extraction shooter on Steam with dedicated servers in EU and NA. 'Our last playtest fell over at 800 concurrent, so we're rebuilding the server layer,' the CTO said.",
    "keep",
    "A",
  ),
  c(
    "driftline",
    "Driftline Studio",
    "Driftline Studio, founded by ex-Rocket League engineers, is prototyping a 6v6 vehicle sports game and posted on LinkedIn that they are looking for a hosting partner that handles bursty scaling for their closed beta this winter.",
    "keep",
    "A",
  ),
  c(
    "moss",
    "Moss & Fern",
    "Two-person studio Moss & Fern announced Lanternfall, a cosy 4-player online co-op gardening game, coming to Steam Early Access in November.",
    "keep",
    "B",
  ),
  c(
    "puzzlecraft",
    "Puzzlecraft Ltd",
    "Puzzlecraft Ltd releases its third match-3 title with cloud saves and daily challenges. The studio, 40 people and profitable, says single-player puzzle games remain its focus.",
    "drop",
  ),
  c(
    "cardhold",
    "Cardhold Interactive",
    "Cardhold Interactive's competitive deck-builder Gambit Row enters open beta with async online matches and ranked seasons.",
    "drop",
  ),
  c(
    "megacorp",
    "Coalition-owned studio",
    "The Xbox Game Studios team behind the 200-player battle royale confirmed the next season will run on its own global fleet managed by an internal orchestration team of thirty.",
    "drop",
  ),
  c(
    "web3",
    "Chainrealm",
    "Chainrealm launches its play-to-earn PvP arena where every sword is an NFT and the $CHAIN token powers server rentals; whitelist opens Friday.",
    "drop",
  ),
  c(
    "complaint",
    "unknown",
    "Is anyone else getting kicked from Ashfall servers every ten minutes? Third night in a row, EU region, unplayable. Devs please fix.",
    "drop",
  ),
  c(
    "vendor",
    "Edgegap",
    "Edgegap's new blog post explains how its orchestration layer scales dedicated servers across 500 locations and why studios are leaving GameLift over egress costs.",
    "drop",
  ),
  c(
    "vague",
    "Northwind Interactive",
    "Northwind Interactive teased its next project with a short cinematic and the words 'together, at last'. More details at the showcase in March.",
    "needs_review",
  ),
];

it.skipIf(!live)(
  "shipped qualification rubric sorts realistic candidates as intended",
  async () => {
    const result = await qualifyLeads({
      candidates: CASES.map(({ expect: _e, tier: _t, ...cand }) => cand),
      run,
    });
    const rows: Array<Record<string, unknown>> = [];
    let hits = 0;
    result.outcomes.forEach((o, i) => {
      const want = CASES[i];
      if (o.state !== "evaluated") {
        rows.push({
          ok: "✗",
          id: o.id,
          got: "unavailable",
          err: o.error.slice(0, 60),
        });
        return;
      }
      const v = o.verdict;
      const ok =
        v.decision === want.expect && (!want.tier || v.tier === want.tier);
      hits += ok ? 1 : 0;
      rows.push({
        ok: ok ? "✓" : "✗",
        id: o.id,
        want: `${want.expect}${want.tier ? "/" + want.tier : ""}`,
        got: `${v.decision}${v.tier ? "/" + v.tier : ""}`,
        prio: v.priority,
        fit: v.fitScore,
        mp: `${v.multiplayerType}(${v.multiplayerConfidence.toFixed(2)})`,
        launch: v.launchProximity.toFixed(1),
        pain: v.serverPain.toFixed(2),
        funded: v.fundedOrBacked.toFixed(2),
        studio: v.isStudioSignal.toFixed(2),
        excl: v.excluded.toFixed(2),
        infra: v.currentInfra,
      });
    });
    console.table(rows);
    console.log(
      `${hits}/${CASES.length} as intended, ${result.inputTokens} input tokens, ${result.elapsedMs} ms total`,
    );
    expect(
      result.outcomes.filter((o) => o.state === "unavailable"),
    ).toHaveLength(0);
  },
  120_000,
);
