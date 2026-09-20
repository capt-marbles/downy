import { expect, it, vi } from "vitest";
import {
  pipelineFailure,
  runPipelineReport,
  type PipelineCheckpoint,
} from "./pipeline-report";
import type { AirtableReadAction } from "../../lib/airtable-connect";
const input = {
  action: "pipeline_report" as const,
  baseId: "appCRM",
  tableId: "tblLeads",
  stageFieldId: "fldStage",
};
function fixture(pages: unknown[], extraFields: unknown[] = []) {
  const stored = new Map<string, PipelineCheckpoint>();
  let account = "andrew@example.com";
  let now = 1000;
  const read = vi.fn(async (action: AirtableReadAction) => ({
    account,
    data:
      action.action === "get_schema"
        ? {
            tables: [
              {
                id: "tblLeads",
                name: "Leads",
                fields: [
                  ...extraFields,
                  {
                    id: "fldStage",
                    name: "Stage",
                    type: "singleSelect",
                    options: {
                      choices: [
                        { name: "New" },
                        { name: "Won" },
                        { name: "Lost" },
                      ],
                    },
                  },
                ],
              },
            ],
          }
        : pages.shift(),
  }));
  const deps = {
    read,
    load: async (id: string) => structuredClone(stored.get(id)),
    save: async (s: PipelineCheckpoint) => {
      stored.set(s.reportId, structuredClone(s));
    },
    now: () => now,
  };
  return {
    deps,
    stored,
    read,
    switchAccount: () => {
      account = "other@example.com";
    },
    expire: () => {
      now += 900001;
    },
  };
}
const record = (id: string, stage?: string) => ({
  id,
  fields: stage === undefined ? {} : { Stage: stage },
});
it("counts all pages, missing and zero stages in code, deduplicating records", async () => {
  const f = fixture([
    { records: [record("1", "New"), record("2")], offset: "opaque/2" },
    {
      records: [
        record("1", "New"),
        record("3", "Won"),
        record("4", "__proto__"),
      ],
    },
  ]);
  const result = await runPipelineReport(input, f.deps);
  expect(result).toMatchObject({
    complete: true,
    totalRecords: 4,
    missingStage: 1,
    pages: 2,
  });
  expect(result.counts).toEqual([
    { stage: "New", count: 1 },
    { stage: "Won", count: 1 },
    { stage: "Lost", count: 0 },
    { stage: "__proto__", count: 1 },
  ]);
  expect(f.read.mock.calls.at(-1)?.[0]).toMatchObject({
    fields: ["Stage"],
    limit: 100,
    offset: "opaque/2",
  });
  expect(JSON.stringify(result)).not.toContain('"seen"');
});
it("resumes persisted batches after restart and rejects mismatched or foreign requests", async () => {
  const f = fixture(
    Array.from({ length: 6 }, (_, i) => ({
      records: [record(String(i), "New")],
      ...(i < 5 ? { offset: `page${i + 1}` } : {}),
    })),
  );
  const partial = await runPipelineReport(input, f.deps);
  expect(partial).toMatchObject({
    complete: false,
    resumable: true,
    totalRecords: null,
    recordsCounted: 5,
  });
  const completed = await runPipelineReport(
    { ...input, reportId: partial.reportId },
    { ...f.deps },
  );
  expect(completed).toMatchObject({ complete: true, totalRecords: 6 });
  await expect(
    runPipelineReport(
      { ...input, tableId: "tblOther", reportId: partial.reportId },
      f.deps,
    ),
  ).rejects.toThrow("does not match");
  f.switchAccount();
  await expect(
    runPipelineReport({ ...input, reportId: partial.reportId }, f.deps),
  ).rejects.toThrow("account changed");
});
it("does not invent a total after a failed page and safely retries the saved offset", async () => {
  const f = fixture([
    { records: [record("1", "Won")], offset: "two" },
    { error: "secret-sentinel" },
    { records: [record("2", "New")] },
  ]);
  const partial = await runPipelineReport(input, f.deps);
  expect(partial).toMatchObject({
    complete: false,
    reason: "read_failed",
    recordsCounted: 1,
    totalRecords: null,
  });
  expect(JSON.stringify(partial)).not.toContain("secret-sentinel");
  expect(
    await runPipelineReport({ ...input, reportId: partial.reportId }, f.deps),
  ).toMatchObject({ totalRecords: 2, complete: true });
});
it("rejects unknown schema fields before records and bounds cursor loops and expiry", async () => {
  const f = fixture([
    { records: [record("1", "New")], offset: "same" },
    { records: [record("2", "New")], offset: "same" },
  ]);
  await expect(
    runPipelineReport({ ...input, stageFieldId: "fldUnknown" }, f.deps),
  ).rejects.toThrow("valid single-select");
  expect(f.read).toHaveBeenCalledTimes(1);
  const result = await runPipelineReport(input, f.deps);
  expect(result).toMatchObject({
    complete: false,
    resumable: false,
    reason: "repeated_cursor",
    totalRecords: null,
  });
  f.expire();
  expect(
    await runPipelineReport({ ...input, reportId: result.reportId }, f.deps),
  ).toMatchObject({ complete: false, resumable: false, reason: "expired" });
});

it("ignores unrelated large select fields while counting and resuming the chosen stage", async () => {
  const f = fixture(
    Array.from({ length: 6 }, (_, i) => ({
      records: [record(String(i), "New")],
      ...(i < 5 ? { offset: `page${i + 1}` } : {}),
    })),
    [
      {
        id: "fldUnrelated",
        name: "Unrelated",
        type: "singleSelect",
        options: {
          choices: Array.from({ length: 553 }, (_, i) => ({
            name: `${i}${"x".repeat(255)}`,
          })),
        },
      },
    ],
  );
  const first = await runPipelineReport(input, f.deps);
  expect(first).toMatchObject({ complete: false, recordsCounted: 5 });
  const completed = await runPipelineReport(
    { ...input, reportId: first.reportId },
    f.deps,
  );
  expect(completed).toMatchObject({ complete: true, totalRecords: 6 });
  expect(completed.counts).toContainEqual({ stage: "New", count: 6 });
  await expect(
    runPipelineReport({ ...input, stageFieldId: "fldUnrelated" }, f.deps),
  ).rejects.toThrow("valid single-select");
});

it("makes record progress even when schema retrieval exceeds the page budget", async () => {
  const f = fixture([{ records: [record("1", "New")] }]);
  let now = 0;
  const read = f.deps.read;
  const result = await runPipelineReport(input, {
    ...f.deps,
    now: () => now,
    read: async (action) => {
      if (action.action === "get_schema") now += 30_000;
      return read(action);
    },
  });
  expect(result).toMatchObject({ complete: true, totalRecords: 1 });
});

it("reports the failing phase without forwarding provider credentials", async () => {
  const f = fixture([]);
  const failure = await runPipelineReport(input, {
    ...f.deps,
    read: async () => {
      throw new Error("secret-sentinel");
    },
  }).catch((error: unknown) => error);
  expect(pipelineFailure(failure)).toEqual({
    state: "failed",
    phase: "schema_read",
    code: "provider_failure",
  });
  expect(String(failure)).not.toContain("secret-sentinel");
  const storeFailure = await runPipelineReport(input, {
    ...f.deps,
    save: async () => {
      throw new Error("secret-sentinel");
    },
  }).catch((error: unknown) => error);
  expect(pipelineFailure(storeFailure)).toEqual({
    state: "failed",
    phase: "checkpoint_save",
    code: "provider_failure",
  });
});
