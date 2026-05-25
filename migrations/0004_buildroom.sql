CREATE TABLE IF NOT EXISTS buildroom_jobs (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_band TEXT,
  trust_state TEXT,
  retention_recommendation TEXT,
  owner_role TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  workspace_path TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_buildroom_jobs_agent_updated
  ON buildroom_jobs(agent_slug, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_buildroom_jobs_agent_stage
  ON buildroom_jobs(agent_slug, stage);

CREATE TABLE IF NOT EXISTS buildroom_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  actor_slug TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT,
  artifact_name TEXT,
  message TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(job_id) REFERENCES buildroom_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_buildroom_events_job_created
  ON buildroom_events(job_id, created_at ASC);

CREATE TABLE IF NOT EXISTS buildroom_approvals (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  decision TEXT NOT NULL,
  risk_band TEXT,
  auto_approved INTEGER NOT NULL DEFAULT 0,
  force_approved INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(job_id) REFERENCES buildroom_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_buildroom_approvals_job_created
  ON buildroom_approvals(job_id, created_at ASC);
