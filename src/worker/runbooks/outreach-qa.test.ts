import { expect, it, vi } from "vitest";
import type { JevRequest } from "../jev/client";
import {
  assembleOutreachBody,
  checkOutreachDraft,
  isOutreachTemplate,
  outreachBodyDigest,
} from "./outreach-qa";

const good = {
  leadName: "Roads & Riches",
  tier: "B" as const,
  evidence:
    "Roads & Riches: online co-op up to four players; playtest sign-ups open; demo this summer. Source: studio blog 2026-09-18.",
  variants: [
    {
      label: "A" as const,
      subject: "roads & riches co-op servers",
      body: "Roads & Riches is online co-op up to four and you've got playtest sign-ups open with a summer demo. That's the window where server cost and reliability usually surprise a small team. We host dedicated servers for indies: push your container, call the API, sessions start in about half a second. Gameye Core is $50/mo a region, flat, with real support. Want the docs before the demo? Andrew",
    },
    {
      label: "B" as const,
      subject: "skip the p2p tax on roads & riches",
      body: "Plenty of co-op indies default to peer-to-peer to dodge server bills, then eat the host-migration bugs and the support tickets. For four-player co-op with a persistent economy, dedicated servers are simpler and cheaper than they look. Push a container, we run them, $50/mo a region flat. If the playtest stays quiet you pay almost nothing. Glad to talk it through. Andrew",
    },
  ],
};

function answers(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {};
  for (const label of ["A", "B"]) {
    base[`${label}_factual_opener`] = { type: "noul", noul: 0.9 };
    base[`${label}_flattery`] = { type: "noul", noul: 0.05 };
    base[`${label}_lockin_angle`] = { type: "noul", noul: 0.05 };
    base[`${label}_tier_hook`] = { type: "noul", noul: 0.95 };
    base[`${label}_opener_support`] = {
      type: "choice",
      choice: "supported",
      confidence: 0.93,
      probabilities: { supported: 0.93 },
    };
  }
  return {
    model: "jev-1.13.0",
    usage: { input_tokens: 1, output_tokens: 1 },
    answers: { ...base, ...over },
  };
}

it("passes clean variants, assembles the exact body and digests it", async () => {
  const run = vi.fn(async (request: JevRequest) => {
    expect(Object.keys(request.questions)).toHaveLength(10);
    return answers();
  });
  const result = await checkOutreachDraft(run, good);
  expect(result.verdict).toBe("pass");
  expect(result.evaluator).toBe("jev");
  expect(result.body).toContain(
    "===== VARIANT A (blunt), subject: roads & riches co-op servers =====",
  );
  expect(result.body).toContain(
    "(keep one, delete the other and these markers, then send)",
  );
  expect(isOutreachTemplate(result.body ?? "")).toBe(true);
  expect(result.digest).toBe(await outreachBodyDigest(result.body ?? ""));
  expect(await outreachBodyDigest(`${result.body}\r\n`)).toBe(result.digest);
  expect(result.variants[0].answers).toMatchObject({
    opener_support: "supported",
  });
});

it("blocks a contradicted or invented opener, flattery, the lock-in angle, an em dash and the banned word", async () => {
  const run = vi.fn(async () =>
    answers({
      A_opener_support: {
        type: "choice",
        choice: "contradicted",
        confidence: 0.85,
        probabilities: { contradicted: 0.85 },
      },
      B_flattery: { type: "noul", noul: 0.8 },
      B_lockin_angle: { type: "noul", noul: 0.75 },
    }),
  );
  const result = await checkOutreachDraft(run, {
    ...good,
    variants: [
      {
        ...good.variants[0],
        body: good.variants[0].body.replace("Andrew", "an ace team — Andrew"),
      },
      good.variants[1],
    ],
  });
  expect(result.verdict).toBe("block");
  expect(result.body).toBeNull();
  expect(result.digest).toBeNull();
  expect(result.variants[0].blocking).toEqual(
    expect.arrayContaining([
      "contains an em dash",
      'uses the word "ace"',
      "the opening claim contradicts the evidence",
    ]),
  );
  expect(result.variants[1].blocking).toEqual(
    expect.arrayContaining([
      "flatters the reader",
      "uses the vendor lock-in angle",
    ]),
  );
  const unsupported = await checkOutreachDraft(
    vi.fn(async () =>
      answers({
        A_opener_support: {
          type: "choice",
          choice: "unsupported",
          confidence: 0.9,
          probabilities: {},
        },
        B_opener_support: {
          type: "choice",
          choice: "unsupported",
          confidence: 0.55,
          probabilities: {},
        },
      }),
    ),
    good,
  );
  expect(unsupported.verdict).toBe("block");
  expect(unsupported.variants[0].blocking).toContain(
    "the opening claim is not in the evidence",
  );
  expect(unsupported.variants[1].warnings).toContain(
    "the opening claim is only weakly tied to the evidence",
  );
});

it("asks for one revision on warnings and never treats an evaluator outage as a pass", async () => {
  const run = vi.fn(async () =>
    answers({ A_tier_hook: { type: "noul", noul: 0.2 } }),
  );
  const short = {
    ...good,
    variants: [
      {
        label: "A" as const,
        subject: "Hello There",
        body: "Short note about servers. Andrew",
      },
    ],
  };
  const result = await checkOutreachDraft(run, short);
  expect(result.verdict).toBe("revise");
  expect(result.variants[0].warnings).toEqual(
    expect.arrayContaining([
      "5 words; target is 55 to 75",
      "subject is not lowercase",
      "missing the Tier B hook ($50/mo a region, flat, real support)",
    ]),
  );
  expect(result.body).toContain("===== VARIANT A");
  const down = await checkOutreachDraft(
    vi.fn(async () => {
      throw new Error("Jev deadline exceeded");
    }),
    good,
  );
  expect(down.evaluator).toBe("unavailable");
  expect(down.verdict).toBe("revise");
  expect(down.variants[0].warnings).toContain(
    "semantic checks unavailable; review the opener and voice by hand",
  );
  expect(assembleOutreachBody(good.variants)).toContain(
    "===== VARIANT B (contrarian), subject: skip the p2p tax on roads & riches =====",
  );
});
