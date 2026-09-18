ALTER TABLE scheduled_tasks ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
UPDATE scheduled_tasks SET timezone = 'America/Chicago';
