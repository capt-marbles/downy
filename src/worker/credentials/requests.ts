import { z } from "zod";
import {
  CredentialFieldSchema,
  CredentialRequestInputSchema,
  type CredentialTarget,
  type CredentialOutcome,
} from "./types";

export async function createCredentialRequest(
  db: D1Database,
  agentSlug: string,
  input: z.input<typeof CredentialRequestInputSchema>,
  targetOverride?: Record<string, unknown>,
) {
  const parsed = CredentialRequestInputSchema.parse(input);
  const ticketId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + 15 * 60_000;
  const { fields, purpose, ...target } = parsed;
  await db
    .prepare(
      `INSERT INTO credential_requests (id, agent_slug, purpose, target_json, fields_json, status, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      ticketId,
      agentSlug,
      purpose,
      JSON.stringify(targetOverride ?? target),
      JSON.stringify(fields),
      now,
      expiresAt,
    )
    .run();
  return { ticketId, expiresAt, fields };
}

export async function resolveCredentialRequest(
  db: D1Database,
  ticketId: string,
  agentSlug: string,
  values: unknown,
  connect: (
    target: CredentialTarget,
    headers: Record<string, string>,
  ) => Promise<CredentialOutcome>,
): Promise<CredentialOutcome> {
  const row = await db
    .prepare(
      "SELECT * FROM credential_requests WHERE id = ? AND agent_slug = ?",
    )
    .bind(ticketId, agentSlug)
    .first<{
      status: string;
      expires_at: number;
      fields_json: string;
      target_json: string;
    }>();
  if (!row || row.status !== "pending" || row.expires_at <= Date.now())
    return {
      state: "failed",
      toolNames: [],
      error: "Ticket is unavailable or expired",
    };
  const fields = z
    .array(CredentialFieldSchema)
    .parse(JSON.parse(row.fields_json) as unknown);
  const submitted = z
    .record(z.string(), z.string().min(1).max(8192))
    .safeParse(values);
  if (
    !submitted.success ||
    fields.some((f) => !submitted.data[f.headerName]) ||
    Object.keys(submitted.data).length !== fields.length
  )
    return {
      state: "failed",
      toolNames: [],
      error: "Complete the requested fields",
    };
  const claimed = await db
    .prepare(
      "UPDATE credential_requests SET status = 'resolving' WHERE id = ? AND status = 'pending' AND expires_at > ?",
    )
    .bind(ticketId, Date.now())
    .run();
  if (claimed.meta.changes !== 1)
    return {
      state: "failed",
      toolNames: [],
      error: "Ticket already submitted",
    };
  let outcome: CredentialOutcome;
  try {
    const headers = Object.fromEntries(
      fields.map((field) => {
        const value = submitted.data[field.headerName];
        return [
          field.headerName,
          field.scheme === "bearer"
            ? `Bearer ${value}`
            : field.scheme === "basic"
              ? `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(value)))}`
              : value,
        ];
      }),
    );
    outcome = await connect(
      JSON.parse(row.target_json) as CredentialTarget,
      headers,
    );
    // Never forward provider error text (it may echo a submitted credential).
    const secrets = [
      ...Object.values(submitted.data),
      ...Object.values(headers),
    ];
    outcome = {
      state: outcome.state === "ready" ? "ready" : "failed",
      toolNames: outcome.toolNames.filter(
        (name) => !secrets.some((secret) => name.includes(secret)),
      ),
      error:
        outcome.state === "ready"
          ? null
          : "Connection failed; check credentials and permissions",
    };
  } catch {
    outcome = {
      state: "failed",
      toolNames: [],
      error: "Connection failed; check credentials and permissions",
    };
  }
  await db
    .prepare(
      "UPDATE credential_requests SET status = ?, resolved_at = ? WHERE id = ?",
    )
    .bind(
      outcome.state === "ready" ? "resolved" : "failed",
      Date.now(),
      ticketId,
    )
    .run();
  return outcome;
}
