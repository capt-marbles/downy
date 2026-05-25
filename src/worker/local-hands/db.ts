import { z } from "zod";

import {
  LocalHandsActionSchema,
  LocalHandsConnectorSchema,
  type ConfirmLocalHandsActionInput,
  type LocalHandsAction,
  type LocalHandsActionKind,
  type LocalHandsActionStatus,
  type LocalHandsClaimInput,
  type LocalHandsCompleteInput,
  type LocalHandsConnector,
  type LocalHandsHeartbeatInput,
  type RequestLocalHandsActionInput,
} from "./types";

type ActionRow = {
  id: string;
  agent_slug: string;
  kind: LocalHandsActionKind;
  status: LocalHandsActionStatus;
  risk_level:
    | "read_only"
    | "writes_local"
    | "external_side_effect"
    | "destructive";
  requires_confirmation: number;
  confirmed_at: number | null;
  requested_by: string;
  input_json: string;
  result_json: string | null;
  error: string | null;
  claimed_by: string | null;
  claimed_at: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type ConnectorRow = {
  id: string;
  agent_slug: string;
  name: string;
  capabilities_json: string;
  status: "online" | "offline";
  last_seen_at: number;
  created_at: number;
  updated_at: number;
};

const UnknownRecordSchema = z.record(z.string(), z.unknown());

function parseRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  return UnknownRecordSchema.nullable().parse(JSON.parse(value) as unknown);
}

function rowToAction(row: ActionRow): LocalHandsAction {
  return LocalHandsActionSchema.parse({
    id: row.id,
    agentSlug: row.agent_slug,
    kind: row.kind,
    status: row.status,
    riskLevel: row.risk_level,
    requiresConfirmation: row.requires_confirmation === 1,
    confirmedAt: row.confirmed_at,
    requestedBy: row.requested_by,
    input: parseRecord(row.input_json) ?? {},
    result: parseRecord(row.result_json),
    error: row.error,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  });
}

function rowToConnector(row: ConnectorRow): LocalHandsConnector {
  const parsed = JSON.parse(row.capabilities_json) as unknown;
  return LocalHandsConnectorSchema.parse({
    id: row.id,
    agentSlug: row.agent_slug,
    name: row.name,
    capabilities: Array.isArray(parsed) ? parsed : [],
    status: row.status,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function requestLocalHandsAction(
  db: D1Database,
  args: { agentSlug: string; input: RequestLocalHandsActionInput },
): Promise<LocalHandsAction> {
  const now = Date.now();
  const id = `hands-${now}-${crypto.randomUUID().slice(0, 8)}`;
  const needsConfirmation =
    args.input.requiresConfirmation || args.input.riskLevel !== "read_only";
  await db
    .prepare(
      `INSERT INTO local_hands_actions (
        id, agent_slug, kind, status, risk_level, requires_confirmation,
        confirmed_at, requested_by, input_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      args.agentSlug,
      args.input.kind,
      needsConfirmation ? "pending_confirmation" : "queued",
      args.input.riskLevel,
      needsConfirmation ? 1 : 0,
      needsConfirmation ? null : now,
      args.input.requestedBy,
      JSON.stringify(args.input.input),
      now,
      now,
    )
    .run();
  return getLocalHandsActionOrThrow(db, id);
}

export async function listLocalHandsActions(
  db: D1Database,
  args: { agentSlug: string; includeCompleted?: boolean },
): Promise<LocalHandsAction[]> {
  const query = args.includeCompleted
    ? `SELECT * FROM local_hands_actions WHERE agent_slug = ? ORDER BY created_at DESC LIMIT 50`
    : `SELECT * FROM local_hands_actions
       WHERE agent_slug = ? AND status NOT IN ('completed', 'failed', 'rejected')
       ORDER BY created_at DESC LIMIT 50`;
  const result = await db.prepare(query).bind(args.agentSlug).all<ActionRow>();
  return (result.results ?? []).map(rowToAction);
}

export async function getLocalHandsActionOrThrow(
  db: D1Database,
  id: string,
): Promise<LocalHandsAction> {
  const row = await db
    .prepare("SELECT * FROM local_hands_actions WHERE id = ?")
    .bind(id)
    .first<ActionRow>();
  if (!row) throw new Error(`Unknown local hands action: ${id}`);
  return rowToAction(row);
}

export async function confirmLocalHandsAction(
  db: D1Database,
  input: ConfirmLocalHandsActionInput,
): Promise<LocalHandsAction> {
  const now = Date.now();
  await db
    .prepare(
      `UPDATE local_hands_actions
       SET status = ?, confirmed_at = ?, error = ?, updated_at = ?
       WHERE id = ? AND status = 'pending_confirmation'`,
    )
    .bind(
      input.approved ? "queued" : "rejected",
      input.approved ? now : null,
      input.approved ? null : input.reason || "Rejected by operator",
      now,
      input.id,
    )
    .run();
  return getLocalHandsActionOrThrow(db, input.id);
}

export async function heartbeatLocalHandsConnector(
  db: D1Database,
  agentSlug: string,
  input: LocalHandsHeartbeatInput,
): Promise<LocalHandsConnector> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO local_hands_connectors (
        id, agent_slug, name, capabilities_json, status,
        last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'online', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        agent_slug = excluded.agent_slug,
        name = excluded.name,
        capabilities_json = excluded.capabilities_json,
        status = 'online',
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at`,
    )
    .bind(
      input.connectorId,
      agentSlug,
      input.name,
      JSON.stringify(input.capabilities),
      now,
      now,
      now,
    )
    .run();
  const row = await db
    .prepare("SELECT * FROM local_hands_connectors WHERE id = ?")
    .bind(input.connectorId)
    .first<ConnectorRow>();
  if (!row) throw new Error("Failed to read local hands connector");
  return rowToConnector(row);
}

export async function listLocalHandsConnectors(
  db: D1Database,
  agentSlug: string,
): Promise<LocalHandsConnector[]> {
  const staleBefore = Date.now() - 120_000;
  await db
    .prepare(
      `UPDATE local_hands_connectors
       SET status = 'offline'
       WHERE agent_slug = ? AND last_seen_at < ?`,
    )
    .bind(agentSlug, staleBefore)
    .run();
  const result = await db
    .prepare(
      `SELECT * FROM local_hands_connectors
       WHERE agent_slug = ? ORDER BY last_seen_at DESC LIMIT 20`,
    )
    .bind(agentSlug)
    .all<ConnectorRow>();
  return (result.results ?? []).map(rowToConnector);
}

export async function claimNextLocalHandsAction(
  db: D1Database,
  args: { agentSlug: string; input: LocalHandsClaimInput },
): Promise<LocalHandsAction | null> {
  await heartbeatLocalHandsConnector(db, args.agentSlug, {
    connectorId: args.input.connectorId,
    name: args.input.connectorId,
    capabilities: args.input.capabilities,
  });
  const row = await db
    .prepare(
      `SELECT * FROM local_hands_actions
       WHERE agent_slug = ? AND status = 'queued'
       ORDER BY created_at ASC LIMIT 1`,
    )
    .bind(args.agentSlug)
    .first<ActionRow>();
  if (!row) return null;
  const now = Date.now();
  await db
    .prepare(
      `UPDATE local_hands_actions
       SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'queued'`,
    )
    .bind(args.input.connectorId, now, now, row.id)
    .run();
  return getLocalHandsActionOrThrow(db, row.id);
}

export async function completeLocalHandsAction(
  db: D1Database,
  args: { actionId: string; input: LocalHandsCompleteInput },
): Promise<LocalHandsAction> {
  const now = Date.now();
  await db
    .prepare(
      `UPDATE local_hands_actions
       SET status = ?, result_json = ?, error = ?, updated_at = ?, completed_at = ?
       WHERE id = ? AND claimed_by = ? AND status = 'claimed'`,
    )
    .bind(
      args.input.status,
      args.input.result ? JSON.stringify(args.input.result) : null,
      args.input.error,
      now,
      now,
      args.actionId,
      args.input.connectorId,
    )
    .run();
  return getLocalHandsActionOrThrow(db, args.actionId);
}
