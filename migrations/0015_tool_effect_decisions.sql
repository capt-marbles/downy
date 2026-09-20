CREATE TABLE tool_effect_decisions (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  context TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  state TEXT NOT NULL,
  effect TEXT,
  jev_class TEXT,
  jev_confidence REAL,
  uncertain INTEGER NOT NULL DEFAULT 0,
  jev_irreversible REAL,
  jev_model_version TEXT,
  reason TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX tool_effect_decisions_agent_created
  ON tool_effect_decisions (agent_slug, created_at);
