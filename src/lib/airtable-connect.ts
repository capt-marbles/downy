import { z } from "zod";
import { GmailConnectStatusSchema } from "./gmail-connect";

export const AirtableConnectStatusSchema = GmailConnectStatusSchema.omit({
  email: true,
}).extend({ identity: z.string().nullable() });
export type AirtableConnectStatus = z.infer<typeof AirtableConnectStatusSchema>;
const baseId = z
  .string()
  .regex(/^app[a-zA-Z0-9]+$/)
  .max(100);
const cursor = z.string().max(2000).optional();
export const AirtableReadActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_bases"), offset: cursor }).strict(),
  z.object({ action: z.literal("get_schema"), baseId }).strict(),
  z
    .object({
      action: z.literal("list_records"),
      baseId,
      tableId: z
        .string()
        .regex(/^tbl[a-zA-Z0-9]+$/)
        .max(100),
      filterByFormula: z.string().max(4000).optional(),
      fields: z.array(z.string().min(1).max(200)).max(30).optional(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe(
          "Records per page, 1–100; use returned offset for subsequent pages.",
        ),
      offset: cursor,
    })
    .strict(),
]);
export const PipelineReportInputSchema = z
  .object({
    action: z.literal("pipeline_report"),
    baseId,
    tableId: z
      .string()
      .regex(/^tbl[a-zA-Z0-9]+$/)
      .max(100),
    stageFieldId: z
      .string()
      .regex(/^fld[a-zA-Z0-9]+$/)
      .max(100),
    reportId: z.string().uuid().optional(),
  })
  .strict();
// Writes never travel through the chat tool. They are proposed as a staged
// action card and executed only after the operator taps Confirm.
const fieldValue = z.union([
  z.string().max(30_000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(2_000)).max(100),
]);
export const AirtableCreateRecordsSchema = z
  .object({
    action: z.literal("create_records"),
    baseId,
    tableId: z
      .string()
      .regex(/^tbl[a-zA-Z0-9]+$/)
      .max(100),
    records: z
      .array(
        z
          .object({
            fields: z.record(z.string().min(1).max(200), fieldValue),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    typecast: z.boolean().default(true),
  })
  .strict();
export const AirtableCreateRecordsResultSchema = z.object({
  state: z.literal("records_created"),
  account: z.string(),
  recordIds: z.array(z.string()),
});
// Updates patch only the listed fields of existing records; `null` clears a
// field. Record ids come from list_records, never from memory.
export const AirtableUpdateRecordsSchema = z
  .object({
    action: z.literal("update_records"),
    baseId,
    tableId: z
      .string()
      .regex(/^tbl[a-zA-Z0-9]+$/)
      .max(100),
    records: z
      .array(
        z
          .object({
            id: z.string().regex(/^rec[a-zA-Z0-9]{14}$/),
            fields: z.record(
              z.string().min(1).max(200),
              z.union([fieldValue, z.null()]),
            ),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    typecast: z.boolean().default(true),
  })
  .strict();
export const AirtableUpdateRecordsResultSchema = z.object({
  state: z.literal("records_updated"),
  account: z.string(),
  recordIds: z.array(z.string()),
});
export const AirtableWriteSchema = z.discriminatedUnion("action", [
  AirtableCreateRecordsSchema,
  AirtableUpdateRecordsSchema,
]);
export type AirtableWrite = z.infer<typeof AirtableWriteSchema>;
export const AirtableWriteResultSchema = z.discriminatedUnion("state", [
  AirtableCreateRecordsResultSchema,
  AirtableUpdateRecordsResultSchema,
]);
export type AirtableWriteResult = z.infer<typeof AirtableWriteResultSchema>;
export const AirtableActionSchema = z.union([
  AirtableReadActionSchema,
  PipelineReportInputSchema,
]);
export type AirtableReadAction = z.infer<typeof AirtableReadActionSchema>;
export type PipelineReportInput = z.infer<typeof PipelineReportInputSchema>;

export function isAirtableConnectRequest(text: string) {
  return /^(?:(?:please|can you|could you|would you)\s+)*(?:connect|reconnect|link|set up|authorize)\s+(?:(?:to|my|the|a)\s+)?airtable\b/i.test(
    text.trim(),
  );
}
