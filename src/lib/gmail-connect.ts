import { z } from "zod";
export const GmailConnectStatusSchema = z.object({
  state: z.enum([
    "needs_composio",
    "not_connected",
    "pending",
    "needs_selection",
    "ready",
    "failed",
    "expired",
  ]),
  email: z.string().nullable(),
  checkedAt: z.number().nullable(),
  error: z.string().nullable(),
  authorized: z.boolean().default(false),
  accounts: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
});
export type GmailConnectStatus = z.infer<typeof GmailConnectStatusSchema>;

export function isGmailConnectRequest(text: string): boolean {
  return /^(?:(?:please|can you|could you|would you)\s+)*(?:connect|reconnect|link|set up|authorize)\s+(?:(?:my|the|a)\s+)?gmail\b/i.test(
    text.trim(),
  );
}

export const GmailActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("search"),
      query: z.string().max(1000),
      limit: z.number().int().min(1).max(20).default(10),
    })
    .strict(),
  z
    .object({
      action: z.literal("read"),
      messageId: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      action: z.literal("create_draft"),
      recipientEmail: z.string().email(),
      subject: z.string().min(1).max(500),
      body: z.string().min(1).max(30000),
      threadId: z.string().max(200).optional(),
    })
    .strict(),
]);
export type GmailAction = z.infer<typeof GmailActionSchema>;
