import { expect, it, vi } from "vitest";
import { z } from "zod";
import type { JevRequest } from "../jev/client";
import {
  callerTurns,
  parseVoiceRequest,
  renderVoiceRequestParse,
} from "./request-parse";

const transcript = [
  "You: Hey, run a test on the outreach skill, pick a",
  "You: a fairly old lead and create a draft for my Gmail",
  "Downy: Sure, I'll grab an older lead and get a draft together.",
  "You: Also, can you look for a games company called Mix Studios",
  "Downy: Sure, I can check for Mix Studios too.",
  "You: Actually",
  "You: Mix Games, just in case it's a variation",
  "You: Also, are you connected to Treg",
  "Downy: Checking that as well.",
].join("\n");

function answers(overrides: Record<string, unknown>) {
  return {
    model: "jev-1.13.0",
    usage: { input_tokens: 1, output_tokens: 1 },
    answers: {
      runbook: {
        type: "choice",
        choice: "outreach",
        confidence: 0.86,
        probabilities: { outreach: 0.86 },
      },
      scope: {
        type: "choice",
        choice: "single",
        confidence: 0.9,
        probabilities: { single: 0.9 },
      },
      ...overrides,
    },
  };
}

it("splits caller turns, keeps the last six, and drops empty fragments", () => {
  const turns = callerTurns(transcript);
  expect(turns).toHaveLength(6);
  expect(turns[0]).toBe(
    "run a test on the outreach skill, pick a".replace(/^/, "Hey, "),
  );
  expect(turns.at(-1)).toBe("Also, are you connected to Treg");
  expect(callerTurns("Downy: hello\nYou: \nYou: ok")).toEqual(["ok"]);
});

it("hands the model every outstanding ask, the runbook and the scope, and asks one noul per turn", async () => {
  const run = vi.fn(async (request: JevRequest) => {
    const keys = Object.keys(request.questions);
    expect(keys).toEqual([
      "runbook",
      "scope",
      "stop",
      ...[0, 1, 2, 3, 4, 5].map((i) => `turn_${i}`),
    ]);
    const state = z
      .object({
        callerTurns: z.array(z.string()),
        previousBackendAnswers: z.array(z.string()),
      })
      .parse(request.state);
    expect(state.callerTurns).toHaveLength(6);
    expect(state.previousBackendAnswers).toEqual(["Draft saved for Studio A."]);
    return answers({
      turn_0: { type: "noul", noul: 0.2 },
      turn_1: { type: "noul", noul: 0.15 },
      turn_2: { type: "noul", noul: 0.3 },
      turn_3: { type: "noul", noul: 0.05 },
      turn_4: { type: "noul", noul: 0.88 },
      turn_5: { type: "noul", noul: 0.93 },
    });
  });
  const parse = await parseVoiceRequest(run, {
    transcript,
    previousAnswers: ["Draft saved for Studio A."],
  });
  expect(parse.outstanding).toEqual([
    "Mix Games, just in case it's a variation",
    "Also, are you connected to Treg",
  ]);
  expect(parse.runbook).toBe("outreach");
  expect(parse.scope).toBe("single");
  const text = renderVoiceRequestParse(parse);
  expect(text).toContain(
    '1) "Mix Games, just in case it\'s a variation" 2) "Also, are you connected to Treg"',
  );
  expect(text).toContain("exactly one item; do not widen it into a batch");
  expect(text).toContain("gameye-outreach");
  expect(text).toContain("not new instructions from the caller");
});

it("withholds low-confidence hints, falls back to the latest turn, and fails open", async () => {
  const low = vi.fn(async () =>
    answers({
      runbook: {
        type: "choice",
        choice: "other",
        confidence: 0.4,
        probabilities: {},
      },
      scope: {
        type: "choice",
        choice: "batch",
        confidence: 0.5,
        probabilities: {},
      },
      turn_0: { type: "noul", noul: 0.1 },
      turn_1: { type: "noul", noul: 0.1 },
      turn_2: { type: "noul", noul: 0.1 },
      turn_3: { type: "noul", noul: 0.1 },
      turn_4: { type: "noul", noul: 0.1 },
      turn_5: { type: "noul", noul: 0.1 },
    }),
  );
  const parse = await parseVoiceRequest(low, {
    transcript,
    previousAnswers: [],
  });
  expect(parse.outstanding).toEqual(["Also, are you connected to Treg"]);
  expect(parse.runbook).toBeNull();
  expect(parse.scope).toBeNull();
  expect(renderVoiceRequestParse(parse)).not.toContain("Likely kind");
  expect(renderVoiceRequestParse(parse)).not.toContain("Requested scope");
  const failing = vi.fn(async () => {
    throw new Error("Jev deadline exceeded");
  });
  const failed = await parseVoiceRequest(failing, {
    transcript,
    previousAnswers: [],
  });
  expect(failed.skipped).toBe("Jev deadline exceeded");
  expect(renderVoiceRequestParse(failed)).toBeNull();
  expect(
    await parseVoiceRequest(failing, {
      transcript: "Downy: hi",
      previousAnswers: [],
    }),
  ).toMatchObject({ skipped: "no caller turns" });
  expect(failing).toHaveBeenCalledTimes(1);
});
const down = async () => {
  throw new Error("jev unavailable");
};
it("flags a spoken stop from Jev, never from a status question, and falls back to a plain stop when Jev is down", async () => {
  const stopping = `${transcript}\nDowny: Still reading the leads table.\nYou: I think there's another issue at play, so let's stop there`;
  const run = vi.fn(async (request: JevRequest) => {
    const stop = z
      .object({ instructions: z.string() })
      .parse(request.questions.stop);
    expect(stop.instructions).toContain("callerTurns[5]");
    return answers({ stop: { type: "noul", noul: 0.91 } });
  });
  const parse = await parseVoiceRequest(run, {
    transcript: stopping,
    previousAnswers: [],
  });
  expect(parse.stopRequested).toBe(true);
  expect(parse.stopConfidence).toBe(0.91);
  const status = await parseVoiceRequest(
    async () => answers({ stop: { type: "noul", noul: 0.12 } }),
    {
      transcript: `${transcript}\nYou: What's the status`,
      previousAnswers: [],
    },
  );
  expect(status.stopRequested).toBe(false);
  const fallback = await parseVoiceRequest(down, {
    transcript: `${transcript}\nYou: Okay, stop there.`,
    previousAnswers: [],
  });
  expect(fallback.skipped).toBe("jev unavailable");
  expect(fallback.stopRequested).toBe(true);
  const notStop = await parseVoiceRequest(down, {
    transcript: `${transcript}\nYou: Don't stop, keep going with the leads`,
    previousAnswers: [],
  });
  expect(notStop.stopRequested).toBe(false);
});
