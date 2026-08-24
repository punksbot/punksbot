CREATE TABLE IF NOT EXISTS message_projection (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('punk', 'bot')),
  actor_id TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (
    message_type IN ('stream-message', 'forum-post', 'forum-comment')
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'retracted', 'erased')),
  mentioned_punk_ids_json TEXT NOT NULL CHECK (json_valid(mentioned_punk_ids_json)),
  media_ids_json TEXT NOT NULL CHECK (json_valid(media_ids_json)),
  parent_message_id TEXT,
  thread_root_message_id TEXT NOT NULL,
  thread_depth INTEGER NOT NULL CHECK (thread_depth BETWEEN 0 AND 100),
  broadcast INTEGER NOT NULL CHECK (broadcast IN (0, 1)),
  reply_count INTEGER NOT NULL CHECK (reply_count >= 0),
  descendant_count INTEGER NOT NULL CHECK (descendant_count >= 0),
  reply_count_base INTEGER NOT NULL CHECK (reply_count_base >= 0),
  descendant_count_base INTEGER NOT NULL CHECK (descendant_count_base >= 0),
  last_reply_at TEXT,
  topic_present INTEGER NOT NULL CHECK (topic_present IN (0, 1)),
  original_content_commitment TEXT CHECK (
    original_content_commitment IS NULL
    OR (
      length(original_content_commitment) = 64
      AND original_content_commitment NOT GLOB '*[^0-9a-f]*'
    )
  ),
  current_version INTEGER CHECK (current_version IS NULL OR current_version >= 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_cursor INTEGER NOT NULL CHECK (created_cursor >= 1),
  last_cursor INTEGER NOT NULL CHECK (last_cursor >= 1),
  last_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  edited_at TEXT,
  PRIMARY KEY (workspace_id, conversation_id, message_id),
  CHECK (
    (status IN ('active', 'retracted') AND current_version IS NOT NULL)
    OR (
      status = 'erased'
      AND current_version IS NULL
      AND original_content_commitment IS NULL
    )
  ),
  CHECK (
    status = 'erased' OR original_content_commitment IS NOT NULL
  ),
  CHECK (created_cursor <= last_cursor)
) STRICT;

CREATE INDEX IF NOT EXISTS message_projection_conversation_history
  ON message_projection (
    workspace_id,
    conversation_id,
    created_cursor DESC,
    message_id ASC
  );

CREATE INDEX IF NOT EXISTS message_projection_thread_history
  ON message_projection (
    workspace_id,
    conversation_id,
    thread_root_message_id,
    created_cursor ASC,
    message_id ASC
  );

CREATE INDEX IF NOT EXISTS message_projection_author
  ON message_projection (
    workspace_id,
    actor_kind,
    actor_id,
    updated_at DESC
  );

CREATE TABLE IF NOT EXISTS message_version_projection (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  content_commitment TEXT NOT NULL CHECK (
    length(content_commitment) = 64
    AND content_commitment NOT GLOB '*[^0-9a-f]*'
  ),
  ciphertext_ref TEXT NOT NULL,
  content_key_id TEXT NOT NULL,
  topic_present INTEGER NOT NULL CHECK (topic_present IN (0, 1)),
  created_at TEXT NOT NULL,
  last_cursor INTEGER NOT NULL CHECK (last_cursor >= 1),
  last_event_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, conversation_id, message_id, version),
  FOREIGN KEY (workspace_id, conversation_id, message_id)
    REFERENCES message_projection(workspace_id, conversation_id, message_id)
    ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS message_tombstone_projection (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('retracted', 'erased')),
  retraction_kind TEXT NOT NULL CHECK (retraction_kind IN ('author', 'moderation')),
  retracted_at TEXT NOT NULL,
  erase_after TEXT,
  erased_at TEXT,
  destroyed_version_count INTEGER CHECK (
    destroyed_version_count IS NULL OR destroyed_version_count >= 1
  ),
  reason_code TEXT,
  last_cursor INTEGER NOT NULL CHECK (last_cursor >= 1),
  last_event_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, conversation_id, message_id),
  FOREIGN KEY (workspace_id, conversation_id, message_id)
    REFERENCES message_projection(workspace_id, conversation_id, message_id)
    ON DELETE CASCADE,
  CHECK (
    (
      status = 'retracted'
      AND erase_after IS NOT NULL
      AND erased_at IS NULL
      AND destroyed_version_count IS NULL
    )
    OR (
      status = 'erased'
      AND erase_after IS NULL
      AND erased_at IS NOT NULL
      AND destroyed_version_count IS NOT NULL
    )
  )
) STRICT;

CREATE TABLE IF NOT EXISTS message_event_projection (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  cursor INTEGER NOT NULL CHECK (cursor >= 1),
  kind INTEGER NOT NULL CHECK (kind BETWEEN 50200 AND 50204),
  projected_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, conversation_id, message_id, event_id),
  UNIQUE (workspace_id, conversation_id, cursor)
) STRICT;

-- Append-only idempotence ledger for counter changes carried by a different
-- Message envelope. Targets intentionally have no foreign key: a reply can be
-- delivered before its root/ancestor projection. Visible counters are always
-- recomputed from the target's latest state snapshot plus later ledger rows.
CREATE TABLE IF NOT EXISTS message_thread_delta_projection (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  target_message_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  cursor INTEGER NOT NULL CHECK (cursor >= 1),
  reply_count_delta INTEGER NOT NULL CHECK (
    reply_count_delta BETWEEN -1 AND 1
  ),
  descendant_count_delta INTEGER NOT NULL CHECK (
    descendant_count_delta BETWEEN -1 AND 1
  ),
  PRIMARY KEY (workspace_id, conversation_id, target_message_id, event_id),
  CHECK (reply_count_delta != 0 OR descendant_count_delta != 0)
) STRICT;

CREATE INDEX IF NOT EXISTS message_thread_delta_target_cursor
  ON message_thread_delta_projection (
    workspace_id,
    conversation_id,
    target_message_id,
    cursor
  );

CREATE INDEX IF NOT EXISTS message_event_projection_conversation_cursor
  ON message_event_projection (
    workspace_id,
    conversation_id,
    cursor,
    message_id
  );

-- The producer tokenizes authorized plaintext before enqueueing the projection.
-- This table and its FTS mirror contain only those opaque tokens; the projector
-- never persists the plaintext Message, topic, or signed event JSON.
CREATE TABLE IF NOT EXISTS message_search_document (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  token_algorithm TEXT NOT NULL CHECK (token_algorithm = 'hmac-sha256-v1'),
  opaque_tokens TEXT NOT NULL CHECK (length(opaque_tokens) > 0),
  last_cursor INTEGER NOT NULL CHECK (last_cursor >= 1),
  last_event_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, conversation_id, message_id),
  FOREIGN KEY (workspace_id, conversation_id, message_id)
    REFERENCES message_projection(workspace_id, conversation_id, message_id)
    ON DELETE CASCADE
) STRICT;

CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
  workspace_id UNINDEXED,
  conversation_id UNINDEXED,
  message_id UNINDEXED,
  token_algorithm UNINDEXED,
  opaque_tokens,
  tokenize = 'trigram case_sensitive 1'
);

CREATE TRIGGER IF NOT EXISTS message_search_document_insert
AFTER INSERT ON message_search_document
BEGIN
  INSERT INTO message_search (
    workspace_id,
    conversation_id,
    message_id,
    token_algorithm,
    opaque_tokens
  ) VALUES (
    new.workspace_id,
    new.conversation_id,
    new.message_id,
    new.token_algorithm,
    new.opaque_tokens
  );
END;

CREATE TRIGGER IF NOT EXISTS message_search_document_update
AFTER UPDATE OF token_algorithm, opaque_tokens ON message_search_document
BEGIN
  DELETE FROM message_search
  WHERE workspace_id = old.workspace_id
    AND conversation_id = old.conversation_id
    AND message_id = old.message_id;
  INSERT INTO message_search (
    workspace_id,
    conversation_id,
    message_id,
    token_algorithm,
    opaque_tokens
  ) VALUES (
    new.workspace_id,
    new.conversation_id,
    new.message_id,
    new.token_algorithm,
    new.opaque_tokens
  );
END;

CREATE TRIGGER IF NOT EXISTS message_search_document_delete
AFTER DELETE ON message_search_document
BEGIN
  DELETE FROM message_search
  WHERE workspace_id = old.workspace_id
    AND conversation_id = old.conversation_id
    AND message_id = old.message_id;
END;
