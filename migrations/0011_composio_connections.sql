CREATE TABLE composio_connections (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  user_id TEXT NOT NULL,
  toolkit TEXT NOT NULL,
  auth_config_id TEXT NOT NULL,
  account_id TEXT,
  server_id TEXT,
  allowed_tools_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
