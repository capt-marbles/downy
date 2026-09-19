import { z } from "zod";

export const ComputerStatusSchema = z.object({
  configured: z.boolean(),
  state: z.enum([
    "sleeping",
    "starting",
    "ready",
    "running",
    "interrupted",
    "error",
  ]),
  authenticated: z.boolean(),
  updatedAt: z.number(),
  error: z.string().nullable(),
  model: z.string(),
});
export const StepInputSchema = z.object({
  id: z.string().uuid(),
  model: z.string().min(1).max(100),
  system: z.string().max(200_000),
  transcript: z.string().max(1_000_000),
  tools: z
    .array(
      z.object({
        name: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
        description: z.string().max(30_000),
        inputSchema: z.record(z.string(), z.unknown()),
      }),
    )
    .max(150),
});
export const StepResultSchema = z.object({
  text: z.string().max(80_000),
  toolCalls: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        arguments: z.string().max(80_000),
      }),
    )
    .max(1),
});
export const LoginSchema = z.object({
  verificationUrl: z
    .string()
    .url()
    .refine((url) => {
      const u = new URL(url);
      return (
        u.protocol === "https:" &&
        ["auth.openai.com", "chatgpt.com"].includes(u.hostname)
      );
    }),
  userCode: z.string().max(100),
});
