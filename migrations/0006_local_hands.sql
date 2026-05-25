CREATE TABLE IF NOT EXISTS local_hands_actions (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  requires_confirmation INTEGER NOT NULL DEFAULT 1,
  confirmed_at INTEGER,
  requested_by TEXT NOT NULL,
  input_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  claimed_by TEXT,
  claimed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_local_hands_actions_agent_status
  ON local_hands_actions(agent_slug, status, created_at ASC);

CREATE TABLE IF NOT EXISTS local_hands_connectors (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  status TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_hands_connectors_agent_seen
  ON local_hands_connectors(agent_slug, last_seen_at DESC);
