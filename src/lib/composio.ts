import { z } from "zod";

// Pilot scope is enforced by the server, not just hidden in the card.
export const GMAIL_PILOT_TOOLS = [
  "GMAIL_GET_PROFILE",
  "GMAIL_FETCH_EMAILS",
  "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
] as const;
export const ComposioCardPartSchema = z.object({
  type: z.literal("data-composio-setup"),
  data: z.object({ toolkit: z.enum(["gmail", "airtable"]) }),
});
