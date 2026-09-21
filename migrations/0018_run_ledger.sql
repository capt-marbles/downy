CREATE TABLE run_events (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  run_id TEXT NOT NULL,
  run_kind TEXT NOT NULL,
  event TEXT NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  cost_usd REAL,
  replayed INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER NOT NULL,
  summary TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX run_events_agent_created ON run_events (agent_slug, created_at);
CREATE INDEX run_events_run ON run_events (run_id);
