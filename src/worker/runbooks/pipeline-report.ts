import { z } from "zod";
import {
  PipelineReportInputSchema,
  type AirtableReadAction,
  type PipelineReportInput,
} from "../../lib/airtable-connect";

const schema = z.object({
  tables: z.array(
    z.object({
      id: z.string(),
      name: z.string().max(200),
      fields: z.array(
        z.object({
          id: z.string(),
          name: z.string().max(200),
          type: z.string(),
          options: z
            .object({
              choices: z
                .array(z.object({ name: z.string().max(200) }))
                .max(128)
                .optional(),
            })
            .optional(),
        }),
      ),
    }),
  ),
});
const page = z.object({
  records: z
    .array(
      z.object({
        id: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[a-zA-Z0-9]+$/),
        fields: z.record(z.string(), z.unknown()),
      }),
    )
    .max(100),
  offset: z.string().min(1).max(2000).optional(),
});
export type PipelineCheckpoint = {
  version: 1;
  reportId: string;
  baseId: string;
  tableId: string;
  stageFieldId: string;
  account: string;
  table: string;
  stageField: string;
  startedAt: number;
  updatedAt: number;
  counts: Record<string, number>;
  missingStage: number;
  seen: string[];
  cursors: string[];
  offset?: string;
  pages: number;
  complete: boolean;
};
type Deps = {
  read: (
    input: AirtableReadAction,
  ) => Promise<{ account: string; data: unknown }>;
  load: (id: string) => Promise<PipelineCheckpoint | undefined>;
  save: (state: PipelineCheckpoint) => Promise<void>;
  now?: () => number;
};
function result(s: PipelineCheckpoint, reason?: string) {
  const resumable =
    !s.complete &&
    !["expired", "record_limit", "repeated_cursor", "account_changed"].includes(
      reason ?? "",
    );
  return {
    reportId: s.reportId,
    state: s.complete ? "complete" : "partial",
    complete: s.complete,
    resumable,
    baseId: s.baseId,
    tableId: s.tableId,
    table: s.table,
    stageField: s.stageField,
    account: s.account,
    counts: Object.entries(s.counts).map(([stage, count]) => ({
      stage,
      count,
    })),
    missingStage: s.missingStage,
    recordsCounted: s.seen.length,
    totalRecords: s.complete ? s.seen.length : null,
    pages: s.pages,
    startedAt: s.startedAt,
    observedAt: s.updatedAt,
    reason: reason ?? null,
    caveat:
      "Paginated live read, not a point-in-time snapshot. Concurrent edits may affect counts.",
  };
}

function countStage(state: PipelineCheckpoint, value: unknown) {
  if (value == null || value === "") {
    state.missingStage++;
    return;
  }
  if (
    typeof value !== "string" ||
    value.length > 200 ||
    (!Object.hasOwn(state.counts, value) &&
      Object.keys(state.counts).length >= 128)
  )
    throw new Error("Unsupported stage value");
  // A stage named '__proto__' is an ordinary label, not an object mutation.
  Object.defineProperty(state.counts, value, {
    value: (Object.hasOwn(state.counts, value) ? state.counts[value] : 0) + 1,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

// Progress belongs to this bot's DO, never to model-supplied counters/cursors.
// Save after every validated page; a retry resumes without counting it twice.
export async function runPipelineReport(raw: PipelineReportInput, deps: Deps) {
  const input = PipelineReportInputSchema.parse(raw);
  const now = deps.now ?? Date.now;
  const deadline = now() + 20_000;
  let state: PipelineCheckpoint;
  if (input.reportId) {
    const saved = await deps.load(input.reportId);
    if (
      !saved ||
      saved.baseId !== input.baseId ||
      saved.tableId !== input.tableId ||
      saved.stageFieldId !== input.stageFieldId
    )
      throw new Error(
        "Report checkpoint does not match this request. Start a new report.",
      );
    state = saved;
    if (now() - state.startedAt > 15 * 60_000)
      return result({ ...state, complete: false }, "expired");
    // Even completed receipts must revalidate access/identity before returning.
    const verified = await deps.read({
      action: "get_schema",
      baseId: input.baseId,
    });
    if (verified.account !== state.account)
      throw new Error("Report account changed. Start a new report.");
    const table = schema
      .parse(verified.data)
      .tables.find((t) => t.id === state.tableId);
    const field = table?.fields.find((f) => f.id === state.stageFieldId);
    if (
      !field ||
      field.name !== state.stageField ||
      !["singleSelect", "singleLineText"].includes(field.type)
    )
      throw new Error("Stage schema changed. Start a new report.");
    if (state.complete) return result(state);
  } else {
    const verified = await deps.read({
      action: "get_schema",
      baseId: input.baseId,
    });
    const table = schema
      .parse(verified.data)
      .tables.find((t) => t.id === input.tableId);
    const field = table?.fields.find((f) => f.id === input.stageFieldId);
    if (
      !table ||
      !field ||
      !["singleSelect", "singleLineText"].includes(field.type)
    )
      throw new Error(
        "Choose a valid single-select or text stage field from the base schema.",
      );
    state = {
      version: 1,
      reportId: crypto.randomUUID(),
      baseId: input.baseId,
      tableId: input.tableId,
      stageFieldId: input.stageFieldId,
      account: verified.account,
      table: table.name,
      stageField: field.name,
      startedAt: now(),
      updatedAt: now(),
      counts: Object.fromEntries(
        (field.options?.choices ?? []).map((c) => [c.name, 0]),
      ),
      missingStage: 0,
      seen: [],
      cursors: [],
      pages: 0,
      complete: false,
    };
    await deps.save(state);
  }
  for (let batch = 0; batch < 5 && now() < deadline; batch++) {
    if (state.seen.length >= 50_000 || state.pages >= 500)
      return result(state, "record_limit");
    try {
      const response = await deps.read({
        action: "list_records",
        baseId: state.baseId,
        tableId: state.tableId,
        fields: [state.stageField],
        limit: 100,
        offset: state.offset,
      });
      if (response.account !== state.account)
        return result(state, "account_changed");
      const data = page.parse(response.data);
      if (data.offset && state.cursors.includes(data.offset))
        return result(state, "repeated_cursor");
      const next = structuredClone(state);
      const seen = new Set(next.seen);
      for (const record of data.records) {
        if (seen.has(record.id)) continue;
        countStage(next, record.fields[state.stageField]);
        seen.add(record.id);
      }
      next.seen = [...seen];
      next.offset = data.offset;
      if (data.offset) next.cursors.push(data.offset);
      next.pages++;
      next.complete = !data.offset;
      next.updatedAt = now();
      await deps.save(next);
      state = next;
      if (state.complete) return result(state);
    } catch {
      // Provider payloads can contain credentials; persist only bounded outcomes.
      return result(state, "read_failed");
    }
  }
  return result(state, "batch_limit");
}
