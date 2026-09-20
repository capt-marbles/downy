import { z } from "zod";

// Pilot scope is enforced by the server, not just hidden in the card.
export const GMAIL_PILOT_TOOLS = [
  "GMAIL_GET_PROFILE",
  "GMAIL_FETCH_EMAILS",
  "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
] as const;
export const GmailConnectionSchema = z.object({
  configured: z.boolean(),
  setupId: z.string().nullable(),
  state: z.enum([
    "not_connected",
    "pending",
    "connecting",
    "ready",
    "failed",
    "expired",
  ]),
  toolNames: z.array(z.string()),
  error: z.string().nullable(),
  redirectUrl: z.string().url().optional(),
});
export const ComposioCardPartSchema = z.object({
  type: z.literal("data-composio-setup"),
  data: z.object({ toolkit: z.literal("gmail") }),
});
