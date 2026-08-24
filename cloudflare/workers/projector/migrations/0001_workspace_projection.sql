CREATE TABLE IF NOT EXISTS workspace_projection (
  workspace_id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'punks', 'public')),
  status TEXT NOT NULL CHECK (status IN ('active', 'deleting', 'deleted')),
  owner_punk_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  last_cursor INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS workspace_event_projection (
  event_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  cursor INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  projected_at TEXT NOT NULL,
  UNIQUE (workspace_id, cursor)
) STRICT;

CREATE INDEX IF NOT EXISTS workspace_event_projection_workspace_cursor
  ON workspace_event_projection (workspace_id, cursor);

CREATE VIRTUAL TABLE IF NOT EXISTS workspace_search USING fts5(
  workspace_id UNINDEXED,
  slug,
  name,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS workspace_projection_search_insert
AFTER INSERT ON workspace_projection
BEGIN
  INSERT INTO workspace_search (workspace_id, slug, name)
  VALUES (new.workspace_id, new.slug, new.name);
END;

CREATE TRIGGER IF NOT EXISTS workspace_projection_search_update
AFTER UPDATE OF slug, name ON workspace_projection
BEGIN
  DELETE FROM workspace_search WHERE workspace_id = old.workspace_id;
  INSERT INTO workspace_search (workspace_id, slug, name)
  VALUES (new.workspace_id, new.slug, new.name);
END;

CREATE TRIGGER IF NOT EXISTS workspace_projection_search_delete
AFTER DELETE ON workspace_projection
BEGIN
  DELETE FROM workspace_search WHERE workspace_id = old.workspace_id;
END;
