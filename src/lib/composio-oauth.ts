import { z } from "zod";
export const ComposioOAuthStatusSchema = z.object({
  state: z.enum([
    "disconnected",
    "authorizing",
    "connected",
    "expired",
    "failed",
    "needs_reconnect",
  ]),
  connectedAt: z.number().nullable(),
  checkedAt: z.number().nullable(),
  expiresAt: z.number().nullable(),
  error: z.string().nullable(),
});
export type ComposioOAuthStatus = z.infer<typeof ComposioOAuthStatusSchema>;
export const ComposioOAuthPartSchema = z.object({
  type: z.literal("data-composio-connect"),
  data: z.object({ provider: z.literal("composio") }),
});
