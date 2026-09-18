CREATE TABLE credential_requests (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  purpose TEXT NOT NULL,
  target_json TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX credential_requests_expiry ON credential_requests(status, expires_at);
