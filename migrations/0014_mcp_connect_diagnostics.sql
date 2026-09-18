CREATE TABLE mcp_connect_diagnostics (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  server_name TEXT NOT NULL,
  url TEXT NOT NULL,
  attempted_transport TEXT NOT NULL,
  http_status INTEGER,
  jev_class TEXT,
  jev_confidence REAL,
  jev_model_version TEXT,
  ladder_steps_json TEXT NOT NULL,
  final_state TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
