CREATE TABLE scheduled_tasks (
  id               TEXT PRIMARY KEY,
  agent_slug       TEXT NOT NULL REFERENCES agents(slug) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  kind             TEXT NOT NULL,
  brief            TEXT NOT NULL,
  schedule_type    TEXT NOT NULL CHECK (schedule_type IN ('interval', 'daily', 'weekly')),
  interval_minutes INTEGER,
  time_of_day      TEXT,
  day_of_week      INTEGER,
  next_due_at      INTEGER NOT NULL,
  last_run_at      INTEGER,
  last_task_id     TEXT,
  run_count        INTEGER NOT NULL DEFAULT 0,
  enabled          INTEGER NOT NULL DEFAULT 1,
  last_error       TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX idx_scheduled_tasks_due ON scheduled_tasks (enabled, next_due_at);
CREATE INDEX idx_scheduled_tasks_agent ON scheduled_tasks (agent_slug, enabled, next_due_at);
