import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { UIMessage } from "ai";
import TurnReceipts, { currentTurnReceipts } from "./TurnReceipts";

const messages: UIMessage[] = [
  {
    id: "old-user",
    role: "user",
    parts: [{ type: "text", text: "count my inbox" }],
  },
  {
    id: "old-assistant",
    role: "assistant",
    parts: [
      {
        type: "tool-todo_write",
        toolCallId: "t0",
        state: "output-available",
        input: {},
        output: { todos: [{ content: "old", status: "in_progress" }] },
      },
    ],
  },
  {
    id: "user",
    role: "user",
    parts: [{ type: "text", text: "draft outreach for Studio A" }],
  },
  {
    id: "assistant",
    role: "assistant",
    parts: [
      {
        type: "tool-read_skill",
        toolCallId: "t1",
        state: "output-available",
        input: { name: "gameye-outreach" },
        output: "…",
      },
      {
        type: "tool-airtable_records",
        toolCallId: "t2",
        state: "output-available",
        input: { action: "list_records", tableId: "tblqqYLjWgLj87m25" },
        output: { state: "failed", error: "did not return a verified result" },
      },
      {
        type: "tool-gmail_email",
        toolCallId: "t3",
        state: "output-available",
        input: { action: "search", query: "in:drafts to:a@b.com" },
        output: { messages: [] },
      },
      {
        type: "tool-tool_treg_call",
        toolCallId: "t4",
        state: "output-denied",
        input: { endpoint_id: "treg.social.post" },
        approval: { id: "a1", approved: false },
      },
      {
        type: "tool-stage_action",
        toolCallId: "t5",
        state: "input-available",
        input: { kind: "airtable_update_records" },
      },
    ],
  },
];

it("lists only the current turn's tool calls with truthful states", () => {
  expect(currentTurnReceipts(messages)).toEqual([
    { name: "read_skill", detail: "gameye-outreach", state: "ok" },
    {
      name: "airtable_records",
      detail: "list_records tblqqYLjWgLj87m25",
      state: "failed",
    },
    { name: "gmail_email", detail: "search in:drafts to:a@b.com", state: "ok" },
    { name: "treg_call", detail: "treg.social.post", state: "blocked" },
    {
      name: "stage_action",
      detail: "airtable_update_records",
      state: "running",
    },
  ]);
  expect(currentTurnReceipts(messages.slice(0, 3))).toEqual([]);
});

it("renders counts and hides nothing that ran", () => {
  const html = renderToStaticMarkup(
    createElement(TurnReceipts, { messages, working: true }),
  );
  expect(html).toContain("This turn");
  expect(html).toContain("5 calls");
  expect(html).toContain("2 failed");
  expect(html).toContain("gameye-outreach");
  expect(html).toContain("blocked");
  expect(html).not.toContain("todo_write");
  const idle = renderToStaticMarkup(
    createElement(TurnReceipts, { messages, working: false }),
  );
  expect(idle).toContain("Last turn");
  expect(idle).not.toContain("gameye-outreach");
});
