import { z } from "zod";
import { normalizeWorkspacePath } from "../agent/child-workspace-rpc";
import { corpusRepos, CursorSchema, type CorpusRepo } from "./types";
import { getAgentStub } from "../lib/get-agent";
import { listAgents } from "../db/profile";
export async function runCorpusRepo(
  env: Cloudflare.Env,
  agentSlug: string,
  repo: CorpusRepo,
  changedPaths?: string[],
  force = false,
) {
  const now = Date.now();
  if (changedPaths?.length) {
    const revision = crypto.randomUUID();
    // Queue before acquiring the lease, so overlapping webhook deliveries
    // survive an active sync. Revision guards retain later changes to a path.
    for (const path of changedPaths) normalizeWorkspacePath(path);
    await env.DB.batch(
      changedPaths.map((path) =>
        env.DB.prepare(
          "INSERT INTO corpus_pending_paths (agent_slug, repo_key, path, revision) VALUES (?, ?, ?, ?) ON CONFLICT(agent_slug, repo_key, path) DO UPDATE SET revision = excluded.revision",
        ).bind(agentSlug, repo.key, path, revision),
      ),
    );
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO corpus_sync_state (agent_slug, repo_key) VALUES (?, ?)",
  )
    .bind(agentSlug, repo.key)
    .run();
  const claim = await env.DB.prepare(
    `UPDATE corpus_sync_state SET lease_until = ? WHERE agent_slug = ? AND repo_key = ? AND lease_until < ? AND (? = 1 OR cursor_json IS NOT NULL OR EXISTS (SELECT 1 FROM corpus_pending_paths p WHERE p.agent_slug = corpus_sync_state.agent_slug AND p.repo_key = corpus_sync_state.repo_key) OR last_run_at <= ?)`,
  )
    .bind(
      now + 240_000,
      agentSlug,
      repo.key,
      now,
      force ? 1 : 0,
      now - 3_600_000,
    )
    .run();
  if (claim.meta.changes !== 1) return false;
  try {
    const row = await env.DB.prepare(
      "SELECT cursor_json, pending_batch_json FROM corpus_sync_state WHERE agent_slug = ? AND repo_key = ?",
    )
      .bind(agentSlug, repo.key)
      .first<{
        cursor_json: string | null;
        pending_batch_json: string | null;
      }>();
    const cursor = row?.cursor_json
      ? CursorSchema.parse(JSON.parse(row.cursor_json) as unknown)
      : null;
    const pending =
      cursor && row?.pending_batch_json
        ? PendingBatchSchema.parse(JSON.parse(row.pending_batch_json))
        : (
            await env.DB.prepare(
              "SELECT path, revision FROM corpus_pending_paths WHERE agent_slug = ? AND repo_key = ? ORDER BY path LIMIT 500",
            )
              .bind(agentSlug, repo.key)
              .all<{ path: string; revision: string }>()
          ).results;
    // A pre-existing full cursor is completed before queued paths are consumed.
    const batch = cursor && !row?.pending_batch_json ? [] : pending;
    const agent = await getAgentStub(env, agentSlug);
    const result = await agent.syncCorpusRepo(
      repo.key,
      cursor,
      cursor || !batch.length ? undefined : batch.map((entry) => entry.path),
    );
    const updates = [
      env.DB.prepare(
        `UPDATE corpus_sync_state SET cursor_json = ?, pending_batch_json = ?, lease_until = 0, last_run_at = ?, last_synced_at = CASE WHEN ? = 1 THEN ? ELSE last_synced_at END, file_count = ?, last_error = NULL WHERE agent_slug = ? AND repo_key = ?`,
      ).bind(
        result.cursor ? JSON.stringify(result.cursor) : null,
        result.cursor && batch.length ? JSON.stringify(batch) : null,
        now,
        result.done ? 1 : 0,
        now,
        result.fileCount,
        agentSlug,
        repo.key,
      ),
    ];
    if (result.done && batch.length)
      updates.push(
        env.DB.prepare(
          `DELETE FROM corpus_pending_paths WHERE agent_slug = ? AND repo_key = ? AND EXISTS (SELECT 1 FROM json_each(?) item WHERE json_extract(item.value, '$.path') = corpus_pending_paths.path AND json_extract(item.value, '$.revision') = corpus_pending_paths.revision)`,
        ).bind(agentSlug, repo.key, JSON.stringify(batch)),
      );
    await env.DB.batch(updates);
  } catch {
    await env.DB.prepare(
      "UPDATE corpus_sync_state SET lease_until = 0, last_error = 'Corpus reconciliation failed; check GitLab config and access', last_run_at = ? WHERE agent_slug = ? AND repo_key = ?",
    )
      .bind(now, agentSlug, repo.key)
      .run();
  }
  return true;
}
export async function reconcileCorpus(env: Cloudflare.Env) {
  const repos = corpusRepos(env.CORPUS_REPOS);
  if (!repos.length) return;
  for (const agent of await listAgents(env.DB)) {
    for (const repo of repos) {
      if (await runCorpusRepo(env, agent.slug, repo)) return; // One bounded batch per cron invocation.
    }
  }
}

const PendingBatchSchema = z.array(
  z.object({ path: z.string(), revision: z.string() }),
);
