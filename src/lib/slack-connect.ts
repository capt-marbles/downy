import { z } from "zod";
import { GmailConnectStatusSchema } from "./gmail-connect";

// Slack connects through Composio's managed OAuth like Gmail and Airtable.
// Downy installs as a bot (the `slackbot` toolkit) so digests post under the
// app's name, not the operator's. The chat tool only lists channels; posting
// happens through a staged card the operator confirms.
export const SlackConnectStatusSchema = GmailConnectStatusSchema.omit({
  email: true,
}).extend({ identity: z.string().nullable() });
export type SlackConnectStatus = z.infer<typeof SlackConnectStatusSchema>;

export function isSlackConnectRequest(text: string): boolean {
  return /^(?:(?:please|can you|could you|would you)\s+)*(?:connect|reconnect|link|set up|authorize)\s+(?:(?:my|the|a|to)\s+)?slack(?:bot)?\b/i.test(
    text.trim(),
  );
}

const channel = z
  .string()
  .min(1)
  .max(100)
  .describe("Channel ID (C…) or name with or without #");

export const SlackReadActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("list_channels"),
      limit: z.number().int().min(1).max(200).default(100),
      cursor: z.string().max(500).optional(),
    })
    .strict(),
]);
export type SlackReadAction = z.infer<typeof SlackReadActionSchema>;

export const SlackPostMessageSchema = z
  .object({
    action: z.literal("post_message"),
    channel,
    text: z.string().min(1).max(4_000),
  })
  .strict();
export type SlackPostMessage = z.infer<typeof SlackPostMessageSchema>;

export const SlackPostResultSchema = z.object({
  state: z.literal("message_posted"),
  account: z.string(),
  channel: z.string(),
  ts: z.string(),
});
export type SlackPostResult = z.infer<typeof SlackPostResultSchema>;
