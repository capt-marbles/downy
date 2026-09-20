import { BrowserResearchSchema } from "../../lib/browser-research";
import type {
  ComparisonRun,
  ComparisonSource,
} from "../../lib/research-comparison";
import { getLocalHandsActionOrThrow } from "../local-hands/db";
export async function comparisonCaptures(
  db: D1Database,
  agentSlug: string,
  run: ComparisonRun,
): Promise<ComparisonSource[] | null> {
  // IDs are persisted before insertion. Reconciliation can repeat this batch
  // after a restart without enqueueing another browser read.
  await db.batch(
    run.urls.map((url, i) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO local_hands_actions
    (id, agent_slug, kind, status, risk_level, requires_confirmation, confirmed_at, requested_by, input_json, created_at, updated_at, target_connector_id, required_capability, expires_at)
    VALUES (?, ?, 'browser', 'queued', 'read_only', 0, ?, 'research-comparison', ?, ?, ?, 'mac-studio', 'browser.automation', ?)`,
        )
        .bind(
          run.actionIds[i],
          agentSlug,
          run.createdAt,
          JSON.stringify({ url }),
          run.createdAt,
          run.createdAt,
          run.createdAt + 86400000,
        ),
    ),
  );
  const actions = await Promise.all(
    run.actionIds.map((id) => getLocalHandsActionOrThrow(db, id)),
  );
  for (const [i, action] of actions.entries()) {
    if (
      action.agentSlug !== agentSlug ||
      action.kind !== "browser" ||
      action.targetConnectorId !== "mac-studio" ||
      action.input.url !== run.urls[i]
    )
      throw new Error("Capture ownership mismatch");
    if (["failed", "rejected"].includes(action.status))
      throw new Error(
        "A Studio capture failed. Check Local hands for its diagnostic before retrying.",
      );
  }
  if (actions.some((action) => action.status !== "completed")) return null;
  return actions.map((action, i) => {
    const capture = BrowserResearchSchema.parse(action.result);
    const source = capture.sources[0];
    if (capture.operation !== "read_page" || !source?.text.trim())
      throw new Error("Source capture has no usable page text");
    const requested = new URL(run.urls[i]);
    if (new URL(source.url).origin !== requested.origin)
      throw new Error("Captured source does not match the requested origin");
    return {
      id: (["s1", "s2", "s3"] as const)[i],
      url: run.urls[i],
      capturedUrl: source.url,
      observedAt: capture.observedAt,
      text: new TextDecoder().decode(
        new TextEncoder().encode(source.text).slice(0, 8000),
      ),
      truncated:
        source.truncated || new TextEncoder().encode(source.text).length > 8000,
      actionId: action.id,
    };
  });
}
