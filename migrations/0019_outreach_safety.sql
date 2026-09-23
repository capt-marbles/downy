-- Outreach safety, adapted from Village's send rules. Suppressions are hard,
-- operator-owned blocks on drafting to an address or a whole domain. Every
-- draft attempt is recorded before the Gmail call; an attempt whose outcome is
-- not known blocks further drafts to that recipient until it is reconciled
-- from Gmail evidence or the operator abandons it on a confirmed card.
CREATE TABLE outreach_suppressions (
  address TEXT PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason IN ('opt_out', 'do_not_contact', 'bounced', 'manual')),
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE outreach_draft_attempts (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  thread_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('cold', 'follow_up', 'reply')),
  state TEXT NOT NULL CHECK (state IN ('intent', 'drafted', 'unknown', 'failed', 'abandoned')),
  draft_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- At most one unresolved attempt per recipient, enforced by the database.
CREATE UNIQUE INDEX outreach_draft_attempts_open
  ON outreach_draft_attempts (recipient) WHERE state IN ('intent', 'unknown');
CREATE INDEX outreach_draft_attempts_recipient ON outreach_draft_attempts (recipient, created_at);
