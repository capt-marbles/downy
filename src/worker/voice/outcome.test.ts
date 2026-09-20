import { expect, it } from "vitest";
import { voiceTurnOutcome, voiceOutcomeChatText } from "./outcome";

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

it("puts an existing report link in chat and keeps its path out of speech", () => {
  const path = "workspace/research/boat-pilot-2026-09-19.md";
  const result = voiceTurnOutcome([
    {
      id: "reply",
      role: "assistant",
      parts: [
        {
          type: "tool-read",
          toolCallId: "read",
          state: "output-available",
          input: { path },
          output: { path, content: "1\t# Boat pilot", totalLines: 1 },
        },
        {
          type: "text",
          text: `CUA provides computer-use tools. Open [the report](/agent/buildroom/workspace/${path}) at \`${path}\`.`,
        },
      ],
    },
  ]);
  expect(result.filePaths).toEqual([path]);
  expect(result.savedPaths).toEqual([]);
  expect(result.text).toContain("CUA provides computer-use tools");
  expect(result.text).toContain("links in chat");
  expect(result.text).not.toContain("workspace/");
  expect(result.text).not.toContain(".md");
  const chat = voiceOutcomeChatText(result, "buildroom");
  expect(chat).toContain(
    `[Open boat pilot 2026 09 19](/agent/buildroom/workspace/${path})`,
  );
});

it("does not make links from failed reads or invented or traversing paths", () => {
  const result = voiceTurnOutcome([
    {
      id: "reply",
      role: "assistant",
      parts: [
        {
          type: "tool-read",
          toolCallId: "missing",
          state: "output-available",
          input: { path: "workspace/missing.md" },
          output: { error: "File not found" },
        },
        {
          type: "tool-read",
          toolCallId: "unsafe",
          state: "output-available",
          input: {},
          output: { path: "workspace/../private.md", content: "invalid" },
        },
        { type: "text", text: "Try workspace/invented.md" },
      ],
    },
  ]);
  expect(result.filePaths).toEqual([]);
  expect(voiceOutcomeChatText(result, "buildroom")).not.toContain("](");
  expect(result.text).not.toContain("workspace/");
});

it("deduplicates read files and escapes link destinations", () => {
  const path = "/workspace/research/Boat #1.md";
  const result = voiceTurnOutcome([
    {
      id: "reply",
      role: "assistant",
      parts: [
        {
          type: "tool-read",
          toolCallId: "read1",
          state: "output-available",
          input: { path },
          output: { path, content: "1\tReport" },
        },
        {
          type: "tool-read",
          toolCallId: "read2",
          state: "output-available",
          input: { path },
          output: { path, content: "2\tReport" },
        },
        { type: "text", text: `Here is the summary at ${path}.` },
      ],
    },
  ]);
  expect(result.filePaths).toEqual(["workspace/research/Boat #1.md"]);
  expect(result.text).not.toContain("#1.md");
  expect(voiceOutcomeChatText(result, "my agent")).toContain(
    "/agent/my%20agent/workspace/workspace/research/Boat%20%231.md",
  );
});

it("rejects the observed saved-file claim when no tool wrote or read the linked file", () => {
  const result = voiceTurnOutcome([
    {
      id: "reply",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Done: [workspace/research/cua-pilot-workflow-task.md](/agent/buildroom/workspace/workspace/research/cua-pilot-workflow-task.md)",
        },
      ],
    },
  ]);
  expect(result.corrected).toBe(true);
  expect(result.text).toContain("No report save was confirmed");
  expect(result.filePaths).toEqual([]);
  expect(result.text).not.toContain("Done");
});

it("does not let a successful read validate a different invented report link", () => {
  const result = voiceTurnOutcome([
    {
      id: "reply",
      role: "assistant",
      parts: [
        {
          type: "tool-read",
          toolCallId: "read",
          state: "output-available",
          input: { path: "workspace/research/source.md" },
          output: { path: "workspace/research/source.md", content: "Source" },
        },
        {
          type: "text",
          text: "Saved [the summary](/agent/buildroom/workspace/workspace/research/invented.md)",
        },
      ],
    },
  ]);
  expect(result.unverifiedFileClaim).toBe(true);
  expect(result.filePaths).toEqual([]);
  expect(voiceOutcomeChatText(result, "buildroom")).not.toContain(
    "invented.md",
  );
});

it("speaks a dispatch receipt instead of the model's promise and records the task id", () => {
  const result = voiceTurnOutcome([
    {
      id: "reply",
      role: "assistant",
      parts: [
        { type: "text", text: "Let me dig into that." },
        {
          type: "tool-spawn_background_task",
          toolCallId: "spawn",
          state: "output-available",
          input: { brief: "Compare vendor pricing pages" },
          output: { taskId: "task-9", status: "dispatched" },
        },
        {
          type: "text",
          text: "Done! The comparison is saved at workspace/notes/vendors.md.",
        },
      ],
    },
  ]);
  expect(result.dispatchedTaskIds).toEqual(["task-9"]);
  expect(result.corrected).toBe(true);
  expect(result.text).toContain("started");
  expect(result.text).not.toContain("Done!");
  expect(result.text).not.toContain("workspace/");
  expect(result.filePaths).toEqual([]);
});

it("treats a dispatch without a task id as a failure, not a start", () => {
  const result = voiceTurnOutcome([
    {
      id: "reply",
      role: "assistant",
      parts: [
        {
          type: "tool-spawn_background_task",
          toolCallId: "spawn",
          state: "output-available",
          input: { brief: "Compare vendor pricing pages" },
          output: { status: "queued" },
        },
        { type: "text", text: "Research is underway." },
      ],
    },
  ]);
  expect(result.dispatchedTaskIds).toEqual([]);
  expect(result.text).toContain("did not start");
});
