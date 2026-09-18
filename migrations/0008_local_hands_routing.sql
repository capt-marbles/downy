ALTER TABLE local_hands_connectors ADD COLUMN allowed_roots_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE local_hands_actions ADD COLUMN target_connector_id TEXT;
ALTER TABLE local_hands_actions ADD COLUMN required_capability TEXT;
ALTER TABLE local_hands_actions ADD COLUMN expires_at INTEGER;
