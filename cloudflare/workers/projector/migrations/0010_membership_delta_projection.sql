-- Membership collections become cursor-guarded coordinates. Historical rows
-- are live; removals retain their last authoritative attributes as tombstones.
ALTER TABLE workspace_member_projection
ADD COLUMN present INTEGER NOT NULL DEFAULT 1 CHECK (present IN (0, 1));

ALTER TABLE conversation_member_projection
ADD COLUMN present INTEGER NOT NULL DEFAULT 1 CHECK (present IN (0, 1));

-- member_count is the bounded aggregate value signed by the winning parent
-- event. roster_floor_cursor is advanced only by a complete legacy snapshot;
-- it blocks a late snapshot member that did not yet have a coordinate row.
ALTER TABLE workspace_projection
ADD COLUMN member_count INTEGER NOT NULL DEFAULT 0
CHECK (member_count BETWEEN 0 AND 2147483647);

ALTER TABLE workspace_projection
ADD COLUMN roster_floor_cursor INTEGER NOT NULL DEFAULT 0
CHECK (roster_floor_cursor >= 0);

ALTER TABLE conversation_projection
ADD COLUMN member_count INTEGER NOT NULL DEFAULT 0
CHECK (member_count BETWEEN 0 AND 100000);

ALTER TABLE conversation_projection
ADD COLUMN roster_floor_cursor INTEGER NOT NULL DEFAULT 0
CHECK (roster_floor_cursor >= 0);

UPDATE workspace_projection
SET member_count = (
  SELECT COUNT(*)
  FROM workspace_member_projection AS member
  WHERE member.workspace_id = workspace_projection.workspace_id
);

UPDATE conversation_projection
SET member_count = (
  SELECT COUNT(*)
  FROM conversation_member_projection AS member
  WHERE member.conversation_id = conversation_projection.conversation_id
    AND member.workspace_id = conversation_projection.workspace_id
);

CREATE INDEX workspace_member_present_by_punk
ON workspace_member_projection (punk_id, workspace_id)
WHERE present = 1;

CREATE INDEX conversation_member_present_by_punk
ON conversation_member_projection (workspace_id, punk_id, conversation_id)
WHERE present = 1;

-- Chunks are private Queue material transitively bound by one signed event.
-- An incomplete batch is never visible in the aggregate/member projections.
CREATE TABLE membership_delta_batch (
  projection_type TEXT NOT NULL
    CHECK (projection_type IN ('workspace', 'conversation')),
  aggregate_id TEXT NOT NULL,
  cursor INTEGER NOT NULL CHECK (cursor >= 1),
  workspace_id TEXT NOT NULL,
  conversation_id TEXT,
  event_id TEXT NOT NULL CHECK (
    length(event_id) = 64 AND event_id NOT GLOB '*[^0-9a-f]*'
  ),
  event_json TEXT NOT NULL CHECK (
    json_valid(event_json)
    AND length(CAST(event_json AS BLOB)) BETWEEN 1 AND 126000
  ),
  delta_digest TEXT NOT NULL CHECK (
    length(delta_digest) = 64
    AND delta_digest NOT GLOB '*[^0-9a-f]*'
  ),
  delta_count INTEGER NOT NULL CHECK (delta_count BETWEEN 0 AND 1000),
  chunk_count INTEGER NOT NULL CHECK (chunk_count BETWEEN 1 AND 64),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (projection_type, aggregate_id, cursor),
  UNIQUE (event_id),
  CHECK (
    (projection_type = 'workspace'
      AND conversation_id IS NULL
      AND aggregate_id = workspace_id)
    OR
    (projection_type = 'conversation'
      AND conversation_id IS NOT NULL
      AND aggregate_id = conversation_id)
  )
) STRICT;

CREATE TABLE membership_delta_chunk (
  projection_type TEXT NOT NULL
    CHECK (projection_type IN ('workspace', 'conversation')),
  aggregate_id TEXT NOT NULL,
  cursor INTEGER NOT NULL CHECK (cursor >= 1),
  chunk_index INTEGER NOT NULL CHECK (chunk_index BETWEEN 0 AND 63),
  chunk_digest TEXT NOT NULL CHECK (
    length(chunk_digest) = 64
    AND chunk_digest NOT GLOB '*[^0-9a-f]*'
  ),
  chunk_json TEXT NOT NULL CHECK (
    json_valid(chunk_json)
    AND json_type(chunk_json) = 'array'
    AND json_array_length(chunk_json) BETWEEN 0 AND 100
    AND length(CAST(chunk_json AS BLOB)) <= 50000
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY (projection_type, aggregate_id, cursor, chunk_index),
  FOREIGN KEY (projection_type, aggregate_id, cursor)
    REFERENCES membership_delta_batch(projection_type, aggregate_id, cursor)
    ON DELETE CASCADE
) STRICT;

CREATE INDEX membership_delta_batch_expiry
ON membership_delta_batch (expires_at, projection_type, aggregate_id, cursor);
