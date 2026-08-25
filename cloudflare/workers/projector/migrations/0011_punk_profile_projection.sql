CREATE TABLE IF NOT EXISTS punk_profile_projection (
  punk_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  search_key TEXT NOT NULL,
  avatar_url TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS punk_profile_projection_search
  ON punk_profile_projection (search_key, punk_id);
