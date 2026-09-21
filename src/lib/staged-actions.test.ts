import { expect, it } from "vitest";
import {
  cancelledStagedAction,
  confirmedStagedAction,
  finishedStagedAction,
  isStagedActionOpen,
  newStagedAction,
  stagedActionChatText,
  StagedActionPayloadSchema,
  StagedActionSchema,
} from "./staged-actions";

const ID = "11111111-1111-4111-8111-111111111111";
const REV = "22222222-2222-4222-8222-222222222222";
const OP = "33333333-3333-4333-8333-333333333333";
const proposal = () =>
  newStagedAction(
    ID,
    REV,
    "voice",
    {
      kind: "gmail_draft",
      gmailDraft: {
        recipientEmail: "lead@example.com",
        subject: "Following up",
        body: "Hi, following up on our call.",
      },
    },
    1_000,
  );

it("proposes without running and tells the reader that yes is not confirmation", () => {
  const action = proposal();
  expect(StagedActionSchema.parse(action)).toEqual(action);
  expect(action.state).toBe("proposed");
  expect(action.operationId).toBeNull();
  expect(isStagedActionOpen(action, 2_000)).toBe(true);
  const text = stagedActionChatText(action);
  expect(text).toContain("not yet run");
  expect(text).toContain("lead@example.com");
  expect(text).toMatch(/yes.*does not confirm/);
});

it("binds confirmation to the shown revision and fixes one operation id", () => {
  const confirmed = confirmedStagedAction(proposal(), REV, OP, 5_000);
  expect(confirmed.state).toBe("executing");
  expect(confirmed.operationId).toBe(OP);
  expect(confirmed.confirmedRevision).toBe(REV);
  expect(() =>
    confirmedStagedAction(proposal(), OP, OP, 5_000),
  ).toThrowErrorMatchingInlineSnapshot(
    `[Error: This proposal changed since it was shown. Review the current version and confirm again.]`,
  );
  // A repeated tap on the same revision observes the same run, never a second one.
  const again = confirmedStagedAction(
    confirmed,
    REV,
    "44444444-4444-4444-8444-444444444444",
    6_000,
  );
  expect(again).toBe(confirmed);
  const done = finishedStagedAction(
    confirmed,
    { state: "succeeded", result: { receipt: "Draft created." } },
    7_000,
  );
  expect(confirmedStagedAction(done, REV, OP, 8_000)).toBe(done);
});

it("rejects expired, cancelled and already-finished proposals", () => {
  const stale = proposal();
  expect(isStagedActionOpen(stale, stale.expiresAt)).toBe(false);
  expect(() => confirmedStagedAction(stale, REV, OP, stale.expiresAt)).toThrow(
    "expired",
  );
  const cancelled = cancelledStagedAction(proposal(), 2_000);
  expect(cancelled.state).toBe("cancelled");
  expect(cancelledStagedAction(cancelled, 3_000)).toBe(cancelled);
  expect(() => confirmedStagedAction(cancelled, REV, OP, 3_000)).toThrow(
    "cancelled",
  );
  const executing = confirmedStagedAction(proposal(), REV, OP, 2_000);
  expect(() => cancelledStagedAction(executing, 3_000)).toThrow("executing");
  expect(() =>
    finishedStagedAction(proposal(), { state: "failed", error: "nope" }, 3_000),
  ).toThrow("Only an executing proposal");
  const unknown = finishedStagedAction(
    executing,
    { state: "unknown", error: "x".repeat(3000) },
    4_000,
  );
  expect(unknown.state).toBe("unknown");
  expect(unknown.error).toHaveLength(2000);
});

it("validates payloads strictly so a smuggled field cannot widen the action", () => {
  expect(
    StagedActionPayloadSchema.safeParse({
      kind: "gmail_draft",
      gmailDraft: { recipientEmail: "x", subject: "s", body: "b" },
      send: true,
    }).success,
  ).toBe(false);
  expect(
    StagedActionPayloadSchema.safeParse({
      kind: "gmail_draft",
      gmailDraft: {
        recipientEmail: "lead@example.com",
        subject: "s",
        body: "b",
        send: true,
      },
    }).success,
  ).toBe(false);
  const task = newStagedAction(
    ID,
    REV,
    "chat",
    {
      kind: "schedule_task",
      scheduleTask: {
        title: "Pipeline digest",
        kind: "digest",
        brief: "Summarize pipeline changes since yesterday.",
        scheduleType: "daily",
        timeOfDay: "08:00",
        timezone: "Europe/Amsterdam",
      },
    },
    0,
  );
  expect(stagedActionChatText(task)).toContain(
    "daily at 08:00 Europe/Amsterdam",
  );
});

it("describes an Airtable create proposal by table and record labels, never raw field ids", () => {
  const payload = StagedActionPayloadSchema.parse({
    kind: "airtable_create_records",
    airtableCreateRecords: {
      baseId: "appZgInlaiE12FCu7",
      tableId: "tblqqYLjWgLj87m25",
      tableLabel: "Leads",
      typecast: true,
      records: [
        {
          fields: {
            fldfuqPygBrGEU9MZ: "Ironhaven Games",
            fldUT9pZN6gBORLJu: "A",
          },
        },
        {
          fields: {
            fldfuqPygBrGEU9MZ: "Driftline Studio",
            fldUT9pZN6gBORLJu: "B",
          },
        },
      ],
      recordLabels: [
        "Ironhaven Games — Tier A — ironhaven.gg",
        "Driftline Studio — Tier B",
      ],
    },
  });
  const action = newStagedAction(ID, REV, "chat", payload, 1_000);
  const text = stagedActionChatText(action);
  expect(text).toContain("Create 2 records in Airtable table Leads");
  expect(text).toContain("- Ironhaven Games — Tier A — ironhaven.gg");
  expect(text).toContain("Fields per record: 2, 2");
  expect(text).toContain("not yet run");
});

it("rejects Airtable proposals whose labels do not match the records, or that exceed ten rows", () => {
  const base = {
    baseId: "appZgInlaiE12FCu7",
    tableId: "tblqqYLjWgLj87m25",
    tableLabel: "Leads",
    records: [{ fields: { fldfuqPygBrGEU9MZ: "A" } }],
  };
  expect(
    StagedActionPayloadSchema.safeParse({
      kind: "airtable_create_records",
      airtableCreateRecords: { ...base, recordLabels: ["one", "two"] },
    }).success,
  ).toBe(false);
  expect(
    StagedActionPayloadSchema.safeParse({
      kind: "airtable_create_records",
      airtableCreateRecords: {
        ...base,
        records: Array.from({ length: 11 }, () => ({ fields: { f: "x" } })),
        recordLabels: Array.from({ length: 11 }, () => "x"),
      },
    }).success,
  ).toBe(false);
});

it("describes a Slack post by channel label and shows the exact text", () => {
  const payload = StagedActionPayloadSchema.parse({
    kind: "slack_post_message",
    slackPostMessage: {
      channel: "C0A1NHZ5QF2",
      channelLabel: "#agent-leads",
      text: "Gameye lead sourcing · batch downy-exa-2026-09-20 · 3 new leads",
    },
  });
  const text = stagedActionChatText(
    newStagedAction(ID, REV, "chat", payload, 1_000),
  );
  expect(text).toContain("Slack post to #agent-leads");
  expect(text).toContain("batch downy-exa-2026-09-20");
  expect(text).toContain("not yet run");
});
