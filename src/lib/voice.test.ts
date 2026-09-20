import { expect, it, vi } from "vitest";
import { appendCaption, VoiceCommandSchema, voiceChunks } from "./voice";
import {
  voiceDeadline,
  voiceReadTools,
  voiceToolSet,
  voiceTurnTools,
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
  ).rejects.toThrow("This action did not run");
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

it("allows only new report writes while keeping background workers and external tools blocked", async () => {
  const saved: string[] = [];
  const baseWrite = tool({
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    execute: async (): Promise<string> => {
      throw new Error("unrestricted writer must not run");
    },
  });
  const tools = voiceToolSet(
    { write: baseWrite, spawn_background_task: baseWrite },
    async (path) => {
      saved.push(path);
    },
  );
  expect(
    voiceReadTools(
      ["read", "write", "spawn_background_task", "tool_mail_send"],
      true,
    ),
  ).toEqual(["read", "write"]);
  expect(
    await tools.write.execute?.(
      {
        path: "workspace/research/combined-research-summary.md",
        content: "# Summary",
      },
      { toolCallId: "save", messages: [] },
    ),
  ).toMatchObject({
    saved: true,
    path: "workspace/research/combined-research-summary.md",
  });
  for (const path of [
    "identity/USER.md",
    "skills/unsafe.md",
    "workspace/research/browser/capture.md",
    "workspace/research/../secret.md",
    "workspace/research/report.json",
  ]) {
    await expect(
      tools.write.execute?.(
        { path, content: "unsafe" },
        { toolCallId: "bad", messages: [] },
      ),
    ).rejects.toThrow();
  }
  await expect(
    tools.spawn_background_task.execute?.(
      { path: "workspace/research/anything.md", content: "unsafe" },
      { toolCallId: "spawn", messages: [] },
    ),
  ).rejects.toThrow("This action did not run");
  expect(saved).toEqual(["workspace/research/combined-research-summary.md"]);
});

it("never reports saved when the server rejects an existing report or verification fails", async () => {
  const original = tool({
    inputSchema: z.object({}),
    execute: async () => "unused",
  });
  const tools = voiceToolSet({ write: original }, async () => {
    throw new Error("Report already exists");
  });
  await expect(
    tools.write.execute?.(
      { path: "workspace/research/report.md", content: "# New text" },
      { toolCallId: "save", messages: [] },
    ),
  ).rejects.toThrow("already exists");
});

it("advertises and executes authorized Airtable reads from the resolved turn inventory", async () => {
  const execute = vi.fn(async (input: unknown) => ({
    account: "verified-account",
    data: input,
  }));
  const read = tool({ inputSchema: z.object({}), execute });
  const connected = tool({ inputSchema: z.unknown(), execute });
  const turn = voiceTurnTools({
    read,
    airtable_records: connected,
    gmail_email: connected,
    tool_airtable_update: connected,
    request_credential: connected,
    connect_mcp_server: connected,
  });
  expect(turn.activeTools).toEqual(["read", "airtable_records"]);
  const options = { toolCallId: "voice-airtable", messages: [] };
  for (const input of [
    { action: "list_bases" },
    { action: "get_schema", baseId: "appCRM" },
    {
      action: "pipeline_report",
      baseId: "appCRM",
      tableId: "tblLeads",
      stageFieldId: "fldStage",
    },
    {
      action: "list_records",
      baseId: "appCRM",
      tableId: "tblLeads",
      fields: ["Stage"],
      limit: 100,
      offset: "opaque/page-two",
    },
  ]) {
    expect(await turn.tools.airtable_records.execute?.(input, options)).toEqual(
      {
        account: "verified-account",
        data: input,
      },
    );
    expect(execute).toHaveBeenLastCalledWith(input, options);
  }
  expect(execute).toHaveBeenCalledTimes(4);
  for (const name of [
    "gmail_email",
    "tool_airtable_update",
    "request_credential",
    "connect_mcp_server",
  ])
    await expect(turn.tools[name].execute?.({}, options)).rejects.toThrow(
      "This action did not run",
    );
  expect(execute).toHaveBeenCalledTimes(4);
});

it("does not synthesize Airtable access when the bot has no authorized tool", () => {
  const turn = voiceTurnTools({ read: tool({ inputSchema: z.object({}) }) });
  expect(turn.activeTools).toEqual(["read"]);
  expect(turn.tools.airtable_records).toBeUndefined();
});

it("rejects Airtable mutations and credential injection even if the underlying tool is widened", async () => {
  const execute = vi.fn(async () => "must not run");
  const turn = voiceTurnTools({
    airtable_records: tool({ inputSchema: z.unknown(), execute }),
  });
  for (const input of [
    { action: "update_record", baseId: "appCRM" },
    { action: "delete_record", baseId: "appCRM" },
    { action: "list_bases", account: "another-account" },
    { action: "list_bases", headers: { authorization: "secret" } },
    {
      action: "list_records",
      baseId: "appCRM",
      tableId: "tblLeads",
      limit: 101,
    },
  ])
    await expect(
      turn.tools.airtable_records.execute?.(input, {
        toolCallId: "blocked",
        messages: [],
      }),
    ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});

it("allows portable skill reads and connection status during voice without enabling setup", () => {
  expect(
    voiceTurnTools(
      Object.fromEntries(
        [
          "read_skill",
          "list_skills",
          "list_mcp_servers",
          "find_tool_setup",
          "create_skill",
        ].map((name) => [name, tool({ inputSchema: z.object({}) })]),
      ),
    ).activeTools,
  ).toEqual(["read_skill", "list_skills", "list_mcp_servers"]);
});
