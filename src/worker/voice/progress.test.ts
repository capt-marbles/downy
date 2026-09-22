import { expect, it } from "vitest";
import {
  voiceChecklistNote,
  voiceProgressNote,
  voiceProgressNotesForStep,
} from "./progress";

it("turns tool results into plain progress notes that never claim completion", () => {
  expect(voiceProgressNote("read_skill", "…")).toBe("loaded the runbook");
  expect(
    voiceProgressNote("airtable_records", {
      state: "failed",
      error: "did not return a verified result",
    }),
  ).toBe("read Airtable: failed (did not return a verified result)");
  expect(
    voiceProgressNote("gmail_email", { state: "draft_created", url: "x" }),
  ).toBe("saved a Gmail draft (not sent)");
  expect(voiceProgressNote("gmail_email", { messages: [] })).toBe(
    "searched Gmail",
  );
  expect(
    voiceProgressNote("stage_action", {
      stagedActionId: "1",
      state: "proposed",
      title: "Update 1 record in Airtable table Leads",
    }),
  ).toBe(
    "put a card in chat awaiting your tap: Update 1 record in Airtable table Leads",
  );
  expect(
    voiceProgressNote("spawn_background_task", {
      taskId: "t",
      status: "dispatched",
    }),
  ).toBe("started a background research task");
  expect(voiceProgressNote("check_outreach_draft", { verdict: "block" })).toBe(
    "checked the draft: block",
  );
  expect(voiceProgressNote("tool_treg_call", { cost_usd: 0.004 })).toBe(
    "ran a Treg lookup",
  );
  expect(
    voiceProgressNote("web_scrape", { externalized: true, chars: 30000 }),
  ).toBe("read a web page (large result saved to a file)");
  expect(voiceProgressNote("tool_github_search", {})).toBe(
    "used github_search",
  );
});

it("builds step notes from the SDK's result items and skips malformed ones", () => {
  expect(
    voiceProgressNotesForStep([
      {
        type: "tool-result",
        toolCallId: "1",
        toolName: "read_skill",
        output: "…",
      },
      {
        type: "tool-result",
        toolCallId: "2",
        toolName: "gmail_email",
        result: { state: "draft_created" },
      },
      { nope: true },
      "junk",
    ]),
  ).toEqual(["loaded the runbook", "saved a Gmail draft (not sent)"]);
  expect(voiceChecklistNote([])).toBeNull();
  expect(
    voiceChecklistNote(["draft outreach for Studio A", "is Treg connected"]),
  ).toBe(
    "working through 2 requests: 1) draft outreach for Studio A; 2) is Treg connected",
  );
});
