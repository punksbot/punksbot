CREATE TABLE IF NOT EXISTS workspace_member_projection (
  workspace_id TEXT NOT NULL,
  punk_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'moderator', 'member', 'guest')),
  last_cursor INTEGER NOT NULL CHECK (last_cursor >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, punk_id),
  FOREIGN KEY (workspace_id) REFERENCES workspace_projection(workspace_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS workspace_member_by_punk
  ON workspace_member_projection(punk_id, workspace_id);
