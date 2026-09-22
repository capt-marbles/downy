import { expect, it, vi } from "vitest";
import { prioritizeLeads } from "./prioritize-leads";

const schema = JSON.stringify({
  account: "owner",
  data: {
    tables: [
      {
        id: "tblLeads",
        name: "Leads",
        fields: [
          { name: "Lead Name", type: "singleLineText" },
          { name: "Company", type: "singleLineText" },
          { name: "Domain", type: "url" },
          { name: "Fit Score", type: "number" },
          { name: "Tier", type: "singleSelect" },
          { name: "ICP Fit", type: "singleSelect" },
          { name: "Priority", type: "singleSelect" },
          { name: "Status", type: "singleSelect" },
          { name: "Signals", type: "multilineText" },
          { name: "Last Modified", type: "lastModifiedTime" },
        ],
      },
    ],
  },
});
const lead = (
  id: string,
  fields: Record<string, unknown>,
): { id: string; fields: Record<string, unknown> } => ({ id, fields });
const page1 = {
  account: "owner",
  data: {
    records: [
      lead("rec1", {
        "Lead Name": "Won Already",
        "Fit Score": 95,
        Status: "Closed Won",
      }),
      lead("rec2", {
        "Lead Name": "Alpha",
        Company: "Alpha Games",
        "Fit Score": 82,
        Tier: "A",
        "ICP Fit": "High",
        Priority: "High",
        Status: "Qualified",
      }),
      lead("rec3", {
        "Lead Name": "Beta",
        "Fit Score": 82,
        Tier: "B",
        "ICP Fit": "Moderate",
        Status: "New",
        "Last Modified": "2026-09-20T00:00:00.000Z",
      }),
    ],
    offset: "page2",
  },
};
const page2 = {
  account: "owner",
  data: {
    records: [
      lead("rec4", {
        "Lead Name": "Gamma",
        "Fit Score": 60,
        Tier: "A",
        "ICP Fit": "High",
        Status: "Contacted",
        "Last Modified": "2026-09-22T00:00:00.000Z",
      }),
      lead("rec3", { "Lead Name": "Beta duplicate" }),
    ],
  },
};

it("pages sorted by the score field, drops closed statuses, ranks with bonuses and returns reasons", async () => {
  const readRecords = vi.fn(
    async (input: { offset?: string; fields: string[] }) =>
      input.offset ? page2 : page1,
  );
  const result = await prioritizeLeads(
    { baseId: "appX", tableId: "tblLeads", count: 3, maxRecords: 300 },
    { readSchema: async () => schema, readRecords, run: async () => ({}) },
  );
  const first = readRecords.mock.calls[0][0];
  expect(first).toMatchObject({
    sort: [{ field: "Fit Score", direction: "desc" }],
    limit: 100,
  });
  for (const name of ["Fit Score", "Lead Name", "Status"])
    expect(first.fields).toContain(name);
  expect(result.scanned).toBe(4);
  expect(result.pages).toBe(2);
  expect(result.partial).toBe(false);
  expect(result.excluded).toEqual({ "Closed Won": 1 });
  expect(result.ranked.map((r) => r.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  expect(result.ranked[0]).toMatchObject({
    id: "rec2",
    company: "Alpha Games",
    fitScore: 82,
    tier: "A",
    rank: 82 + 15 + 10 + 5,
    reasons: ["Fit Score 82", "Tier A", "ICP fit High", "Priority High"],
  });
  expect(result.note).toContain("Ranked 3 open lead(s) out of 4 scanned");
});

it("ends a scan whose cursor stops yielding, marks it partial, and criteria judgments add rank and fail open", async () => {
  const readRecords = vi.fn(async () => ({
    ...page1,
    data: { ...page1.data, offset: "more" },
  }));
  let calls = 0;
  const run = vi.fn(async () => {
    calls++;
    if (calls === 1) throw new Error("jev down");
    return {
      model: "jev",
      usage: { input_tokens: 1, output_tokens: 1 },
      answers: {
        match: {
          type: "score",
          score: 4,
          confidence: 0.9,
          probabilities: {},
          legend: {},
        },
      },
    };
  });
  const result = await prioritizeLeads(
    {
      baseId: "appX",
      tableId: "tblLeads",
      count: 2,
      maxRecords: 100,
      criteria: "studios with a high ICP fit",
    },
    { readSchema: async () => schema, readRecords, run },
  );
  // The second page repeats the first; the stuck cursor ends the scan.
  expect(readRecords).toHaveBeenCalledTimes(2);
  expect(result.partial).toBe(true);
  expect(result.scanned).toBe(3);
  expect(run).toHaveBeenCalledTimes(2);
  const judged = result.ranked.filter((r) => r.criteriaMatch !== null);
  expect(judged).toHaveLength(1);
  expect(judged[0].reasons.at(-1)).toBe(
    "criteria: Matches the criteria exactly",
  );
  expect(result.note).toContain(
    "judged for 1 finalist(s); 1 could not be judged",
  );
});
