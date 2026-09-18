import { z } from "zod";
export const CredentialFieldSchema = z.object({
  headerName: z.string().regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/),
  label: z.string().min(1).max(100),
  scheme: z.enum(["bearer", "basic", "raw"]),
  hint: z.string().max(200).optional(),
});
export const CredentialRequestInputSchema = z.object({
  purpose: z.string().min(1).max(300),
  serverName: z.string().min(1).max(100),
  url: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === "https:", "HTTPS required"),
  transport: z.enum(["auto", "streamable-http", "sse"]).default("auto"),
  fields: z
    .array(CredentialFieldSchema)
    .min(1)
    .max(10)
    .refine(
      (fields) =>
        new Set(fields.map((f) => f.headerName.toLowerCase())).size ===
        fields.length,
      "Duplicate header names",
    ),
  docsUrl: z.string().url().optional(),
});
export const CredentialTicketSchema = z.object({
  ticketId: z.string(),
  expiresAt: z.number(),
  fields: z.array(CredentialFieldSchema),
});
export type CredentialTarget = {
  serverName: string;
  url: string;
  transport: "auto" | "streamable-http" | "sse";
  docsUrl?: string;
};
export type CredentialOutcome = {
  state: string;
  toolNames: string[];
  error: string | null;
};
