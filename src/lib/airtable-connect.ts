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
