CREATE TABLE workflow_criteria_evaluations (
  id TEXT PRIMARY KEY,
  stage_run_id TEXT NOT NULL,
  criterion_text TEXT NOT NULL,
  question_type TEXT NOT NULL,
  probability REAL,
  confidence REAL,
  passed INTEGER,
  jev_model_version TEXT,
  truncated INTEGER NOT NULL DEFAULT 0,
  evaluated_at INTEGER NOT NULL,
  FOREIGN KEY(stage_run_id) REFERENCES buildroom_workflow_stage_runs(id)
);
CREATE INDEX workflow_criteria_stage ON workflow_criteria_evaluations(stage_run_id, evaluated_at);
