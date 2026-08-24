-- Reaction presence is a normalized, cursor-guarded projection. Removed rows
-- deliberately retain their authoritative identity so late Queue deliveries
-- cannot bind either the coordinate or reaction_entity_id to another entity.
CREATE TABLE message_reaction_presence_projection (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  reaction_entity_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('punk', 'bot')),
  actor_id TEXT NOT NULL,
  reaction TEXT NOT NULL CHECK (length(reaction) BETWEEN 1 AND 66),
  status TEXT NOT NULL CHECK (status IN ('active', 'removed')),
  reacted_at TEXT,
  last_cursor INTEGER NOT NULL CHECK (last_cursor >= 1),
  last_event_id TEXT NOT NULL,
  PRIMARY KEY (
    workspace_id,
    conversation_id,
    message_id,
    actor_kind,
    actor_id,
    reaction
  ),
  UNIQUE (workspace_id, reaction_entity_id),
  CHECK (
    (status = 'active' AND reacted_at IS NOT NULL)
    OR (status = 'removed' AND reacted_at IS NULL)
  )
) STRICT;

CREATE INDEX message_reaction_presence_count
  ON message_reaction_presence_projection (
    workspace_id,
    conversation_id,
    message_id,
    reaction,
    status
  );

-- The overlay is one bounded absolute row per Message. It is driven only by
-- message.projection@1 and a permanent tombstone is monotone.
CREATE TABLE message_reaction_visibility_projection (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (
    visibility IN ('visible', 'temporarily-hidden', 'permanently-hidden')
  ),
  last_cursor INTEGER NOT NULL CHECK (last_cursor >= 1),
  last_event_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, conversation_id, message_id)
) STRICT;

-- Counts are absolute materialized values. The signed event never carries a
-- roster and the public value stays inside an explicit 32-bit bound.
CREATE TABLE message_reaction_count_projection (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  reaction TEXT NOT NULL CHECK (length(reaction) BETWEEN 1 AND 66),
  active_count INTEGER NOT NULL CHECK (
    active_count BETWEEN 0 AND 2147483647
  ),
  visible_count INTEGER NOT NULL CHECK (
    visible_count BETWEEN 0 AND 2147483647
  ),
  last_cursor INTEGER NOT NULL CHECK (last_cursor >= 1),
  PRIMARY KEY (workspace_id, conversation_id, message_id, reaction),
  CHECK (visible_count <= active_count)
) STRICT;

CREATE TABLE message_reaction_event_projection (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  reaction_entity_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  cursor INTEGER NOT NULL CHECK (cursor >= 1),
  kind INTEGER NOT NULL CHECK (kind IN (50210, 50211)),
  projected_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, conversation_id, event_id),
  UNIQUE (workspace_id, conversation_id, cursor)
) STRICT;

CREATE INDEX message_reaction_count_message
  ON message_reaction_count_projection (
    workspace_id,
    conversation_id,
    message_id,
    visible_count
  );
