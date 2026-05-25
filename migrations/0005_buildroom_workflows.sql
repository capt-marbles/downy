CREATE TABLE IF NOT EXISTS buildroom_workflow_templates (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  stages_json TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_buildroom_workflow_templates_agent
  ON buildroom_workflow_templates(agent_slug, is_archived, updated_at DESC);

CREATE TABLE IF NOT EXISTS buildroom_workflow_runs (
  job_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  current_stage_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY(job_id) REFERENCES buildroom_jobs(id),
  FOREIGN KEY(template_id) REFERENCES buildroom_workflow_templates(id)
);

CREATE INDEX IF NOT EXISTS idx_buildroom_workflow_runs_agent_updated
  ON buildroom_workflow_runs(agent_slug, updated_at DESC);

CREATE TABLE IF NOT EXISTS buildroom_workflow_stage_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  output_artifact_name TEXT,
  notes TEXT,
  FOREIGN KEY(job_id) REFERENCES buildroom_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_buildroom_workflow_stage_runs_job
  ON buildroom_workflow_stage_runs(job_id, started_at ASC);

CREATE TABLE IF NOT EXISTS buildroom_workflow_gate_decisions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  gate_type TEXT NOT NULL,
  decision TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(job_id) REFERENCES buildroom_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_buildroom_workflow_gate_decisions_job
  ON buildroom_workflow_gate_decisions(job_id, created_at ASC);
