import { expect, it } from "vitest";
import { voiceTurnOutcome } from "./outcome";

it("does not speak promises after the reported task validation failure", () => {
  const result = voiceTurnOutcome([
    {
      id: "reply",
      role: "assistant",
      parts: [
        { type: "text", text: "On it — I'll pull all four captures together." },
        {
          type: "tool-spawn_background_task",
          toolCallId: "bad-task",
          state: "output-error",
          input: {
            description: "Combine captures",
            brief: "Read four files and write a report",
          },
          errorText: "Invalid input: kind missing",
        },
        { type: "text", text: "Give me a moment to compile it." },
      ],
    },
  ]);
  expect(result.corrected).toBe(true);
  expect(result.text).toContain("did not start");
  expect(result.text).not.toContain("Give me a moment");
  expect(result.text).not.toContain("On it");
});

it("reports verified saved files and does not speak the planning preamble", () => {
  const result = voiceTurnOutcome([
    {
      id: "reply",
      role: "assistant",
      parts: [
        { type: "text", text: "I'll get started." },
        {
          type: "tool-write",
          toolCallId: "save",
          state: "output-available",
          input: {},
          output: {
            saved: true,
            path: "workspace/research/combined-research-summary.md",
          },
        },
        { type: "text", text: "Your summary is saved." },
      ],
    },
  ]);
  expect(result.savedPaths).toEqual([
    "workspace/research/combined-research-summary.md",
  ]);
  expect(result.text).toContain("saved");
  expect(result.text).not.toContain("get started");
});

it("uses the final answer after a recovered read error and ignores voice captions", () => {
  const result = voiceTurnOutcome([
    {
      id: "reply",
      role: "assistant",
      parts: [
        {
          type: "tool-read",
          toolCallId: "wrong",
          state: "output-error",
          input: {},
          errorText: "wrong path",
        },
        {
          type: "tool-read",
          toolCallId: "fixed",
          state: "output-available",
          input: {},
          output: "Evidence",
        },
        { type: "text", text: "Here is the supported answer." },
      ],
    },
    {
      id: "voice-transcript:call",
      role: "assistant",
      parts: [{ type: "text", text: "Old spoken promises" }],
    },
  ]);
  expect(result.corrected).toBe(false);
  expect(result.text).toBe("Here is the supported answer.");
});

it("does not accept an unverified writer response as success", () => {
  const result = voiceTurnOutcome([
    {
      id: "reply",
      role: "assistant",
      parts: [
        {
          type: "tool-write",
          toolCallId: "save",
          state: "output-available",
          input: {},
          output: { path: "workspace/research/summary.md" },
        },
        { type: "text", text: "Done, saved!" },
      ],
    },
  ]);
  expect(result.corrected).toBe(true);
  expect(result.savedPaths).toEqual([]);
  expect(result.text).toContain("No report was saved");
});
