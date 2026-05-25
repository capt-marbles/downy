import { z } from "zod";

export const LocalHandsActionKindSchema = z.enum([
  "shell",
  "filesystem",
  "browser",
  "xurl",
  "jcode",
  "git",
]);
export type LocalHandsActionKind = z.infer<typeof LocalHandsActionKindSchema>;

export const LocalHandsActionStatusSchema = z.enum([
  "pending_confirmation",
  "queued",
  "claimed",
  "completed",
  "failed",
  "rejected",
]);
export type LocalHandsActionStatus = z.infer<
  typeof LocalHandsActionStatusSchema
>;

export const LocalHandsRiskLevelSchema = z.enum([
  "read_only",
  "writes_local",
  "external_side_effect",
  "destructive",
]);
export type LocalHandsRiskLevel = z.infer<typeof LocalHandsRiskLevelSchema>;

export const LocalHandsActionSchema = z.object({
  id: z.string(),
  agentSlug: z.string(),
  kind: LocalHandsActionKindSchema,
  status: LocalHandsActionStatusSchema,
  riskLevel: LocalHandsRiskLevelSchema,
  requiresConfirmation: z.boolean(),
  confirmedAt: z.number().nullable(),
  requestedBy: z.string(),
  input: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  claimedBy: z.string().nullable(),
  claimedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().nullable(),
});
export type LocalHandsAction = z.infer<typeof LocalHandsActionSchema>;

export const RequestLocalHandsActionInputSchema = z.object({
  kind: LocalHandsActionKindSchema,
  riskLevel: LocalHandsRiskLevelSchema,
  requiresConfirmation: z.boolean().default(true),
  requestedBy: z.string().min(1).max(120).default("agent"),
  input: z.record(z.string(), z.unknown()),
});
export type RequestLocalHandsActionInput = z.infer<
  typeof RequestLocalHandsActionInputSchema
>;

export const ConfirmLocalHandsActionInputSchema = z.object({
  id: z.string().min(1),
  approved: z.boolean(),
  reason: z.string().max(1000).default(""),
});
export type ConfirmLocalHandsActionInput = z.infer<
  typeof ConfirmLocalHandsActionInputSchema
>;

export const LocalHandsCapabilitySchema = z.enum([
  "shell.read",
  "shell.write",
  "filesystem.read",
  "filesystem.write",
  "browser.automation",
  "xurl.research",
  "jcode.coding",
  "git.read",
  "git.write",
]);
export type LocalHandsCapability = z.infer<typeof LocalHandsCapabilitySchema>;

export const LocalHandsConnectorSchema = z.object({
  id: z.string(),
  agentSlug: z.string(),
  name: z.string(),
  capabilities: z.array(LocalHandsCapabilitySchema),
  status: z.enum(["online", "offline"]),
  lastSeenAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type LocalHandsConnector = z.infer<typeof LocalHandsConnectorSchema>;

export const LocalHandsHeartbeatInputSchema = z.object({
  connectorId: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  capabilities: z.array(LocalHandsCapabilitySchema).default([]),
});
export type LocalHandsHeartbeatInput = z.infer<
  typeof LocalHandsHeartbeatInputSchema
>;

export const LocalHandsClaimInputSchema = z.object({
  connectorId: z.string().min(1).max(120),
  capabilities: z.array(LocalHandsCapabilitySchema).default([]),
});
export type LocalHandsClaimInput = z.infer<typeof LocalHandsClaimInputSchema>;

export const LocalHandsCompleteInputSchema = z.object({
  connectorId: z.string().min(1).max(120),
  status: z.enum(["completed", "failed"]),
  result: z.record(z.string(), z.unknown()).nullable().default(null),
  error: z.string().max(4000).nullable().default(null),
});
export type LocalHandsCompleteInput = z.infer<
  typeof LocalHandsCompleteInputSchema
>;
