import { expect, it } from "vitest";
import { appendCaption, VoiceCommandSchema, voiceChunks } from "./voice";
import {
  voiceDeadline,
  voiceReadTools,
  voiceToolSet,
} from "../worker/voice/policy";
import { tool } from "ai";
import { z } from "zod";

it("preserves repeated words and whitespace, separates speakers, and bounds caption history", () => {
  let captions = appendCaption([], {
    type: "session.input_transcript.delta",
    delta: "No,",
    start_ms: 0,
    end_ms: 100,
  });
  captions = appendCaption(captions, {
    type: "session.input_transcript.delta",
    delta: " no. The other digest.",
    start_ms: 100,
    end_ms: 400,
  });
  expect(captions[0].text).toBe("No, no. The other digest.");
  captions = appendCaption(captions, {
    type: "session.output_transcript.delta",
    delta: "Okay",
    start_ms: 400,
    end_ms: 500,
  });
  expect(captions).toHaveLength(2);
  expect(
    appendCaption(captions, {
      type: "session.output_audio.delta",
      delta: "base64-secret",
    }),
  ).toEqual(captions);
  for (let i = 0; i < 100; i++)
    captions = appendCaption(captions, {
      type: "session.input_transcript.delta",
      delta: "x".repeat(1000),
      start_ms: i * 2000,
      end_ms: i * 2000 + 10,
    });
  expect(
    captions.reduce((n, caption) => n + caption.text.length, 0),
  ).toBeLessThanOrEqual(24_000);
});

it("bounds commentary by bytes without corrupting Unicode or flooding the call", () => {
  const text = "こんにちは 🎮 ".repeat(300);
  const chunks = voiceChunks(text);
  expect(chunks.length).toBeLessThanOrEqual(8);
  expect(
    chunks.every((chunk) => new TextEncoder().encode(chunk).length <= 420),
  ).toBe(true);
  expect(chunks.join("")).not.toContain("�");
  expect(chunks.at(-1)).toContain("full answer");
});

it("does not grant voice approval, shell, MCP, credential, write, or newly added tools", () => {
  expect(
    voiceReadTools([
      "read",
      "find",
      "grep",
      "write",
      "bash",
      "shell",
      "connect_mcp_server",
      "request_credential",
      "record_buildroom_gate_decision",
      "confirm_local_hands_action",
      "tool_mail_send",
      "new_tool",
    ]),
  ).toEqual(["read", "find", "grep"]);
});

it("blocks execution even if a model calls a hidden write tool", async () => {
  let executed = false;
  const tools = voiceToolSet({
    publish: tool({
      inputSchema: z.object({}),
      execute: async () => {
        executed = true;
        return "published";
      },
    }),
  });
  await expect(
    tools.publish.execute?.({}, { toolCallId: "test", messages: [] }),
  ).rejects.toThrow("read-only");
  expect(executed).toBe(false);
});

it("expires on the earliest of heartbeat, inactivity, provider expiry, and maximum duration", () => {
  const call = {
    startedAt: 0,
    heartbeatAt: 0,
    activityAt: 0,
    expiresAt: 900_000,
  };
  expect(voiceDeadline(call)).toBe(60_000);
  expect(voiceDeadline({ ...call, heartbeatAt: 100_000 })).toBe(120_000);
  expect(
    voiceDeadline({ ...call, heartbeatAt: 900_000, activityAt: 900_000 }),
  ).toBe(900_000);
  expect(voiceDeadline({ ...call, expiresAt: 10_000 })).toBe(10_000);
});

it("rejects attempts to inject provider settings, arbitrary events, or oversized SDP", () => {
  const callId = crypto.randomUUID();
  expect(
    VoiceCommandSchema.safeParse({
      command: "start",
      callId,
      sdp: "offer",
      headers: { authorization: "secret" },
    }).success,
  ).toBe(false);
  expect(
    VoiceCommandSchema.safeParse({
      command: "start",
      callId,
      sdp: "x".repeat(64_001),
    }).success,
  ).toBe(false);
  expect(
    VoiceCommandSchema.safeParse({
      command: "session.instructions.append",
      callId,
    }).success,
  ).toBe(false);
});
