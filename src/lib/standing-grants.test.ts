import { expect, it } from "vitest";
import {
  describeGrant,
  grantCovers,
  StandingGrantsSchema,
} from "./standing-grants";

const grants = StandingGrantsSchema.parse([
  {
    kind: "airtable_create_records",
    baseId: "appZgInlaiE12FCu7",
    tableId: "tblqqYLjWgLj87m25",
    tableLabel: "Leads",
  },
  {
    kind: "slack_post_message",
    channel: "#agent-leads",
    channelLabel: "#agent-leads",
  },
]);

it("covers only the exact base and table, or the exact channel", () => {
  const [airtable, slack] = grants;
  expect(
    grantCovers(airtable, {
      kind: "airtable_create_records",
      airtableCreateRecords: {
        baseId: "appZgInlaiE12FCu7",
        tableId: "tblqqYLjWgLj87m25",
      },
    }),
  ).toBe(true);
  expect(
    grantCovers(airtable, {
      kind: "airtable_create_records",
      airtableCreateRecords: {
        baseId: "appZgInlaiE12FCu7",
        tableId: "tblOther",
      },
    }),
  ).toBe(false);
  expect(
    grantCovers(slack, {
      kind: "slack_post_message",
      slackPostMessage: { channel: "agent-leads" },
    }),
  ).toBe(true);
  expect(
    grantCovers(slack, {
      kind: "slack_post_message",
      slackPostMessage: { channel: "#general" },
    }),
  ).toBe(false);
  expect(grantCovers(slack, { kind: "gmail_draft", gmailDraft: {} })).toBe(
    false,
  );
});

it("describes grants in the operator's words", () => {
  expect(describeGrant(grants[0])).toContain(
    "create records in Airtable table Leads",
  );
  expect(describeGrant(grants[1])).toContain("post to Slack #agent-leads");
});

it("refuses more than five grants", () => {
  expect(
    StandingGrantsSchema.safeParse(Array.from({ length: 6 }, () => grants[1]))
      .success,
  ).toBe(false);
});
