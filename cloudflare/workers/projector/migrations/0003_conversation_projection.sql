CREATE TABLE IF NOT EXISTS conversation_projection (
  conversation_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  conversation_type TEXT NOT NULL CHECK (conversation_type IN ('stream', 'forum', 'dm', 'workflow')),
  visibility TEXT NOT NULL CHECK (visibility IN ('open', 'private')),
  description TEXT,
  topic TEXT,
  purpose TEXT,
  topic_required INTEGER NOT NULL CHECK (topic_required IN (0, 1)),
  max_members INTEGER,
  ttl_seconds INTEGER,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'deleting', 'deleted')),
  owner_punk_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  last_cursor INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS conversation_projection_workspace
  ON conversation_projection (workspace_id, status, conversation_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS conversation_projection_workspace_visibility
  ON conversation_projection (workspace_id, visibility, status);

CREATE TABLE IF NOT EXISTS conversation_member_projection (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  punk_id TEXT NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('owner', 'manager', 'member', 'guest')),
  joined_at TEXT NOT NULL,
  invited_by_punk_id TEXT,
  last_cursor INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, punk_id)
) STRICT;

CREATE INDEX IF NOT EXISTS conversation_member_by_punk
  ON conversation_member_projection (workspace_id, punk_id, conversation_id);

CREATE TABLE IF NOT EXISTS conversation_event_projection (
  event_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  cursor INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  projected_at TEXT NOT NULL,
  UNIQUE (conversation_id, cursor)
) STRICT;

CREATE INDEX IF NOT EXISTS conversation_event_by_workspace_conversation_cursor
  ON conversation_event_projection (workspace_id, conversation_id, cursor);

CREATE VIRTUAL TABLE IF NOT EXISTS conversation_search USING fts5(
  workspace_id UNINDEXED,
  conversation_id UNINDEXED,
  name,
  description,
  topic,
  purpose,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS conversation_projection_search_insert
AFTER INSERT ON conversation_projection
BEGIN
  INSERT INTO conversation_search
    (workspace_id, conversation_id, name, description, topic, purpose)
  VALUES
    (new.workspace_id, new.conversation_id, new.name, new.description, new.topic, new.purpose);
END;

CREATE TRIGGER IF NOT EXISTS conversation_projection_search_update
AFTER UPDATE OF name, description, topic, purpose ON conversation_projection
BEGIN
  DELETE FROM conversation_search WHERE conversation_id = old.conversation_id;
  INSERT INTO conversation_search
    (workspace_id, conversation_id, name, description, topic, purpose)
  VALUES
    (new.workspace_id, new.conversation_id, new.name, new.description, new.topic, new.purpose);
END;

CREATE TRIGGER IF NOT EXISTS conversation_projection_search_delete
AFTER DELETE ON conversation_projection
BEGIN
  DELETE FROM conversation_search WHERE conversation_id = old.conversation_id;
END;
