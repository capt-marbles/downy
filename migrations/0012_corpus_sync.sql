CREATE TABLE corpus_sync_state (
  agent_slug TEXT NOT NULL,
  repo_key TEXT NOT NULL,
  last_run_at INTEGER NOT NULL DEFAULT 0,
  last_synced_at INTEGER,
  file_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  cursor_json TEXT,
  PRIMARY KEY (agent_slug, repo_key)
);

-- Keep webhook paths durable while another batch holds the reconciliation lease.
ALTER TABLE corpus_sync_state ADD COLUMN pending_batch_json TEXT;
CREATE TABLE corpus_pending_paths (
  agent_slug TEXT NOT NULL,
  repo_key TEXT NOT NULL,
  path TEXT NOT NULL,
  revision TEXT NOT NULL,
  PRIMARY KEY (agent_slug, repo_key, path)
);
